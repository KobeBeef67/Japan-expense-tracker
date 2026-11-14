import type { ReceiptExtraction } from './receipt-parser';
import { selectReceiptAmount } from './receipt-parser';

/** Photos are alternative views of ONE receipt, never amounts to add together. */
export function mergeReceiptPages(pages: ReceiptExtraction[]): ReceiptExtraction {
  const dateCandidates = [...new Set(pages.flatMap((page) => page.dateCandidates))];
  const candidates = pages.flatMap((page, index) =>
    page.candidates.map((candidate) => ({
      ...candidate,
      context: `Photo ${index + 1}: ${candidate.context}`,
    })),
  );
  const totals = [...new Set(candidates.filter((c) => c.explicit).map((c) => c.amount))];
  const amount = selectReceiptAmount(candidates);
  const warnings: string[] = [];
  if (!dateCandidates.length) warnings.push('Date not detected in any photo');
  if (dateCandidates.length > 1)
    warnings.push('Photos contain conflicting dates; choose the purchase date');
  if (!totals.length)
    warnings.push(
      amount === null
        ? 'Final total not detected; select or enter it'
        : 'Amount has no total label; check it against the receipt',
    );
  if (totals.length > 1) warnings.push('Photos contain conflicting totals; choose the final total');
  return {
    date: dateCandidates.length === 1 ? dateCandidates[0] : null,
    dateCandidates,
    amount,
    candidates,
    warnings,
  };
}
