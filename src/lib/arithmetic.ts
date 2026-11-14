import Decimal from 'decimal.js';

// Decimal values are for display/reconciliation. Actual yen rounding uses exact fractions below.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export { Decimal };

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

/** Keep denominators positive and reduce fractions to limit intermediate integer growth. */
function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (denominator === 0n) throw new Error('Cannot divide by zero');
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }

  // Euclid's algorithm finds the greatest common divisor, including a zero numerator.
  let dividend = numerator < 0n ? -numerator : numerator;
  let divisor = denominator;
  while (divisor) {
    [dividend, divisor] = [divisor, dividend % divisor];
  }

  const commonDivisor = dividend || 1n;
  return {
    numerator: numerator / commonDivisor,
    denominator: denominator / commonDivisor,
  };
}

/**
 * Recursive-descent grammar, from lowest to highest precedence:
 *   expression = term ((+ | -) term)*
 *   term       = atom ((* | /) atom)*
 *   atom       = number | (+ | -) atom | '(' expression ')'
 *
 * Input is never passed to eval/Function. Identifiers and functions are not part of the grammar.
 */
function parse(input: string): Fraction {
  if (input.length > 500) throw new Error('Expression is too long');

  const tokens = input.match(/\d+(?:\.\d*)?|\.\d+|[()+\-*/]|\S/g) || [];
  let position = 0;
  let depth = 0;

  function parseAtom(): Fraction {
    if (++depth > 64) throw new Error('Expression nesting is too deep');

    let value: Fraction;
    const token = tokens[position++];

    if (token === '+' || token === '-') {
      value = parseAtom();
      if (token === '-') value = { ...value, numerator: -value.numerator };
    } else if (token === '(') {
      value = parseExpression();
      if (tokens[position++] !== ')') throw new Error('Missing closing parenthesis');
    } else if (token && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      // Convert a decimal literal to an integer ratio without going through Number.
      const decimalParts = token.split('.');
      value = fraction(BigInt(token.replace('.', '')), 10n ** BigInt(decimalParts[1]?.length || 0));
    } else {
      throw new Error('Use numbers, parentheses and + − * / only');
    }

    depth--;
    return value;
  }

  function parseTerm(): Fraction {
    let value = parseAtom();

    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++];
      const right = parseAtom();

      value =
        operator === '*'
          ? fraction(value.numerator * right.numerator, value.denominator * right.denominator)
          : fraction(value.numerator * right.denominator, value.denominator * right.numerator);
    }

    return value;
  }

  function parseExpression(): Fraction {
    let value = parseTerm();

    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const right = parseTerm();
      const sign = operator === '+' ? 1n : -1n;

      value = fraction(
        value.numerator * right.denominator + sign * right.numerator * value.denominator,
        value.denominator * right.denominator,
      );
    }

    return value;
  }

  const result = parseExpression();
  const magnitude = result.numerator < 0n ? -result.numerator : result.numerator;
  if (position !== tokens.length || magnitude > 9_000_000_000n * result.denominator) {
    throw new Error('Invalid expression or amount exceeds ¥9 billion');
  }
  return result;
}

/** High-precision decimal representation for previews and import metadata. */
export function calculate(input: string): Decimal {
  const value = parse(input);
  return new Decimal(value.numerator.toString()).div(value.denominator.toString());
}

/** Round the exact fraction to whole yen, with exact halves away from zero. */
export function yen(input: string): number {
  const value = parse(input);
  const magnitude = value.numerator < 0n ? -value.numerator : value.numerator;
  const wholeYen = magnitude / value.denominator;
  const remainder = magnitude % value.denominator;
  const roundingAdjustment = remainder * 2n >= value.denominator ? 1n : 0n;
  const roundedMagnitude = wholeYen + roundingAdjustment;

  return Number(value.numerator < 0n ? -roundedMagnitude : roundedMagnitude);
}
