import Decimal from 'decimal.js';
Decimal.set({precision:40,rounding:Decimal.ROUND_HALF_UP});
export { Decimal };
/** Grammar: expression := term ((+|-) term)*; no functions, identifiers or eval. */
type Fraction={n:bigint;d:bigint};
function fraction(n:bigint,d=1n):Fraction {if(d===0n)throw new Error('Cannot divide by zero');if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){[a,b]=[b,a%b];}return {n:n/(a||1n),d:d/(a||1n)};}
function parse(input:string):Fraction {
 if(input.length>500)throw new Error('Expression is too long');
 const tokens=input.match(/\d+(?:\.\d*)?|\.\d+|[()+\-*/]|\S/g)||[]; let i=0,depth=0;
 function atom():Fraction {if(++depth>64)throw new Error('Expression nesting is too deep');let v:Fraction;const t=tokens[i++];if(t==='+'||t==='-'){v=atom();if(t==='-')v={n:-v.n,d:v.d};}else if(t==='('){v=expr();if(tokens[i++]!==')')throw new Error('Missing closing parenthesis');}else if(t&&/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(t)){const parts=t.split('.');v=fraction(BigInt(t.replace('.','')),10n**BigInt(parts[1]?.length||0));}else throw new Error('Use numbers, parentheses and + − * / only');depth--;return v;}
 function term():Fraction{let v=atom();while(tokens[i]==='*'||tokens[i]==='/'){const op=tokens[i++],r=atom();v=op==='*'?fraction(v.n*r.n,v.d*r.d):fraction(v.n*r.d,v.d*r.n);}return v;}
 function expr():Fraction{let v=term();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++],r=term();v=fraction(v.n*r.d+(op==='+'?1n:-1n)*r.n*v.d,v.d*r.d);}return v;}
 const v=expr();if(i!==tokens.length||(v.n<0n?-v.n:v.n)>9000000000n*v.d)throw new Error('Invalid expression or amount exceeds ¥9 billion');return v;
}
export function calculate(input:string):Decimal {const v=parse(input);return new Decimal(v.n.toString()).div(v.d.toString());}
export function yen(s:string):number {const v=parse(s),n=v.n<0n?-v.n:v.n;const whole=n/v.d+(n%v.d*2n>=v.d?1n:0n);return Number(v.n<0n?-whole:whole);}
