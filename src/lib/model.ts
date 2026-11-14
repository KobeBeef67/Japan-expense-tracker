import type { Tag } from './tag-names';
export type { Tag } from './tag-names';

/** Shared JSON contracts. Keep persisted field names in sync with Rust validation/migration. */
export type Kind = 'expense' | 'salary' | 'income' | 'refund';

/** Only review metadata is retained: never an image, merchant database, or full OCR transcript. */
export interface ReceiptOrigin {
  origin: 'receipt-scan';
  input: 'camera' | 'file' | 'synthetic' | 'mixed';
  engine: 'tesseract.js-6.0.1';
  reviewedAt: string;
}
export interface Cell {
  address: string;
  value: string | null;
  formula: string | null;
  type: string;
}
export interface Provenance {
  family: string;
  sheet: string;
  cell: string;
  file: string;
  hash: string;
  fingerprint: string;
  description: Cell;
  amount: Cell;
  date: Cell;
  notes: Cell;
  originalValue: string | null;
}
export interface Transaction {
  id: string;
  /** Actual purchase date; unknown dates stay null. */
  date: string | null;
  /** Reporting period is independent of the purchase date. */
  month: string;
  description: string;
  /** Nonnegative, rounded whole yen. Null is unresolved, not an accounting zero. */
  amount: number | null;
  type: Kind;
  category: string;
  tagIds: string[];
  notes: string;
  flags: string[];
  /** Historical workbook cells remain attached even after editable fields change. */
  source?: Provenance;
  expression?: string;
  receipt?: ReceiptOrigin;
}
export interface Reconciliation {
  month: string;
  count: number;
  unresolved: number;
  salary: number;
  expenses: number;
  income: number;
  savings: number;
  workbookSubtotal: string;
  workbookNet: string;
  exactNet: string;
  roundingDelta: string;
  subtotalAdjustment: string;
  unexplained: string;
  subtotalCell: string;
  subtotalFormula: string;
  balanceCell: string | null;
  balanceFormula: string | null;
  balanceDifference: string | null;
}
export interface ImportReport {
  file: string;
  hash: string;
  generatedAt: string;
  counts: {
    amounts: number;
    missing: number;
    undated: number;
    yearErrors: number;
    crossMonth: number;
  };
  months: Reconciliation[];
}
export interface Ledger {
  schemaVersion: 2;
  /** The native save command checks and advances this optimistic concurrency token. */
  revision: number;
  tags: Tag[];
  transactions: Transaction[];
  deletedSourceIds: string[];
  /** Historical reconciliation snapshots, never the source of current financial totals. */
  imports: ImportReport[];
}
export const emptyLedger = (): Ledger => ({
  schemaVersion: 2,
  revision: 0,
  tags: [],
  transactions: [],
  deletedSourceIds: [],
  imports: [],
});
/** Derive current totals from transaction types, keeping missing amounts visibly incomplete. */
export function totals(transactions: Transaction[]) {
  const result = { salary: 0, expenses: 0, income: 0, refunds: 0, savings: 0, unresolved: 0 };
  for (const transaction of transactions) {
    if (transaction.amount === null) {
      result.unresolved++;
      continue;
    }
    if (transaction.type === 'expense') result.expenses += transaction.amount;
    else if (transaction.type === 'salary') result.salary += transaction.amount;
    else if (transaction.type === 'refund') result.refunds += transaction.amount;
    else result.income += transaction.amount;
  }
  result.savings = result.salary + result.income + result.refunds - result.expenses;
  return result;
}

/** Suggestions require acceptance in the UI; ambiguous descriptions stay uncategorized. */
export function categorySuggestion(description: string): string {
  const normalized = description.toLowerCase();
  if (/amazon|skeb/.test(normalized)) return '';
  if (/\brent\b/.test(normalized)) return 'Housing';
  if (/icoca|train|shinkansen|\bbus\b/.test(normalized)) return 'Transport';
  if (/grocer|lunch|dinner|breakfast|conbini|coffee/.test(normalized)) return 'Food';
  if (/water bill|electric|gas bill|fiber|internet/.test(normalized)) return 'Bills';
  return '';
}

/** Offer a form draft after three historical months; never post a recurring entry automatically. */
export function recurringSuggestions(items: Transaction[], month: string) {
  const groups = new Map<string, Transaction[]>();
  for (const t of items)
    if (
      t.month < month &&
      t.amount !== null &&
      /rent|water|electric|gas bill|fiber|internet/i.test(t.description)
    ) {
      const key = t.description.toLowerCase().trim();
      groups.set(key, [...(groups.get(key) || []), t]);
    }
  return [...groups.values()]
    .filter(
      (g) =>
        new Set(g.map((t) => t.month)).size >= 3 &&
        !items.some(
          (t) =>
            t.month === month &&
            t.description.toLowerCase().trim() === g[0].description.toLowerCase().trim(),
        ),
    )
    .map((g) => g.sort((a, b) => b.month.localeCompare(a.month))[0]);
}
