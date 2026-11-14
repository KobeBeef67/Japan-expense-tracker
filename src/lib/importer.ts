import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { calculate, Decimal, yen } from './arithmetic';
import type { Cell, Transaction, ImportReport, Ledger, Reconciliation } from './model';
import { totals } from './model';

// The workbook's position identifies a record. File hashes identify revisions, not identities.
const FAMILY = 'japan-expenses-sheet1-v1';
const asArray = (x: any): any[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
function extractText(x: any): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (x['#text'] !== undefined) return String(x['#text']);
  if (x.t !== undefined) return extractText(x.t);
  if (x.r !== undefined) return asArray(x.r).map(extractText).join('');
  return '';
}
/** Convert a one-based column number to an Excel label (1 -> A, 27 -> AA). */
export function col(n: number) {
  let s = '';
  while (n) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
function columnNumber(s: string) {
  return [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}
export async function sha256(bytes: Uint8Array) {
  return [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function inspectWorkbook(
  bytes: Uint8Array,
  file: string,
): Promise<{ transactions: Transaction[]; report: ImportReport }> {
  // Phase 1: decode only the workbook parts needed for source-cell provenance.
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Workbook exceeds 20 MB');
  const zip = unzipSync(bytes, {
    filter: (e) =>
      e.originalSize < 30 * 1024 * 1024 &&
      /^xl\/(sharedStrings.xml|workbook.xml|_rels\/workbook.xml.rels|worksheets\/sheet\d+.xml)$/.test(
        e.name,
      ),
  });
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: true,
  });
  const readWorkbookPart = (path: string) => {
    if (!zip[path]) throw new Error(`Missing workbook part: ${path}`);
    return parser.parse(strFromU8(zip[path]));
  };
  const sheets = asArray(readWorkbookPart('xl/workbook.xml').workbook.sheets.sheet),
    sheet = sheets.find((s) => s['@_name'] === 'Sheet1');
  if (!sheet || sheets.length !== 1)
    throw new Error('Expected the Japan expenses workbook with one worksheet, Sheet1');
  const rel = asArray(
    readWorkbookPart('xl/_rels/workbook.xml.rels').Relationships.Relationship,
  ).find((r) => r['@_Id'] === sheet['@_r:id']);
  const target = String(rel?.['@_Target'] || '');
  const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
  const strings = zip['xl/sharedStrings.xml']
    ? asArray(readWorkbookPart('xl/sharedStrings.xml').sst.si).map(extractText)
    : [];
  const cells: Record<string, Cell> = {};
  for (const row of asArray(readWorkbookPart(path).worksheet.sheetData.row))
    for (const c of asArray(row.c)) {
      const raw = c.v === undefined ? null : String(c.v);
      const type = c['@_t'] || 'n';
      const value =
        type === 's' ? strings[Number(raw)] : type === 'inlineStr' ? extractText(c.is) : raw;
      if (value !== null || c.f !== undefined)
        cells[c['@_r']] = {
          address: c['@_r'],
          value: value ?? null,
          formula:
            c.f === undefined ? null : typeof c.f === 'object' ? extractText(c.f) : String(c.f),
          type,
        };
    }
  const getCell = (a: string): Cell =>
    cells[a] || { address: a, value: null, formula: null, type: 'n' };
  const hash = await sha256(bytes);
  const transactions: Transaction[] = [];
  const months: Reconciliation[] = [];
  const counts = { amounts: 0, missing: 0, undated: 0, yearErrors: 0, crossMonth: 0 };
  // Phase 2: validate the fixed layout before interpreting any cells as transactions.
  const columns = Object.values(cells)
    .filter((c) => /^[A-Z]+4$/.test(c.address) && /^sum\(/i.test(c.formula || ''))
    .sort(
      (a, b) =>
        columnNumber(a.address.replace(/\d/g, '')) - columnNumber(b.address.replace(/\d/g, '')),
    );
  if (columns.length !== 28 || columns[0].address !== 'B4' || columns[27].address !== 'DF4')
    throw new Error(
      'Unsupported workbook layout. Expected 28 monthly blocks from B4 through DF4; no data imported.',
    );
  function readAmount(c: Cell): Decimal {
    if (c.formula) {
      try {
        return calculate(c.formula);
      } catch {
        throw new Error(`Unsupported transaction calculation at ${c.address}: ${c.formula}`);
      }
    }
    if (c.value === null || c.type !== 'n') throw new Error(`Non-numeric amount at ${c.address}`);
    return calculate(c.value);
  }
  function readDate(c: Cell): string | null {
    if (c.value === null) return null;
    if (c.type === 'n' && /^\d+(\.\d+)?$/.test(c.value)) {
      const d = new Date(Date.UTC(1899, 11, 30) + Number(c.value) * 86400000);
      if (!Number.isFinite(d.getTime())) throw new Error(`Invalid date ${c.address}`);
      return d.toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(c.value)) return c.value.slice(0, 10);
    throw new Error(`Unrecognized date at ${c.address}. Original workbook preserved.`);
  }
  // Phase 3: normalize one source row while retaining the unmodified source cells.
  async function buildTransaction(
    month: string,
    description: Cell,
    amount: Cell,
    dateCell: Cell,
    notes: Cell,
    salary = false,
  ): Promise<Transaction> {
    const originalAmount =
        amount.value === null && amount.formula === null ? null : readAmount(amount),
      flags: string[] = [];
    const transactionDate = salary ? null : readDate(dateCell);
    if (!salary) {
      if (originalAmount === null) {
        counts.missing++;
        flags.push('Missing amount');
      } else {
        counts.amounts++;
        if (!transactionDate) counts.undated++;
      }
      if (!transactionDate) flags.push('Undated');
      if (transactionDate && transactionDate.slice(0, 7) !== month) {
        counts.crossMonth++;
        flags.push('Date outside reporting month');
        if (
          transactionDate.slice(5, 7) === month.slice(5) &&
          transactionDate.slice(0, 4) !== month.slice(0, 4)
        ) {
          counts.yearErrors++;
          flags.push('Likely year error');
        }
      }
    }
    if (originalAmount && !originalAmount.isInteger()) flags.push('Rounded to whole yen');
    const original = originalAmount?.toString() ?? null;
    const roundedSignedAmount = originalAmount ? yen(amount.formula || amount.value!) : null;
    const transactionType = salary
      ? 'salary'
      : originalAmount?.isNegative()
        ? /refund|reimburs|transport|payback/i.test(description.value || '')
          ? 'refund'
          : 'income'
        : 'expense';
    if (originalAmount?.isNegative() && !salary) flags.push('Review income / refund type');
    const source = {
      family: FAMILY,
      sheet: 'Sheet1',
      cell: amount.address,
      file,
      hash,
      // Keep the historical "dc" fingerprint key so readability changes do not create import conflicts.
      fingerprint: await sha256(
        new TextEncoder().encode(JSON.stringify({ description, amount, dc: dateCell, notes })),
      ),
      description,
      amount,
      date: dateCell,
      notes,
      originalValue: original,
    };
    return {
      id: `${FAMILY}:${amount.address}`,
      month,
      date: transactionDate,
      description: description.value || 'Salary',
      amount: roundedSignedAmount === null ? null : Math.abs(roundedSignedAmount),
      type: transactionType,
      category: '',
      tagIds: [],
      notes: notes.value || '',
      flags,
      source,
    };
  }
  // Phase 4: build transactions and reconcile each reporting block independently.
  for (let monthIndex = 0; monthIndex < columns.length; monthIndex++) {
    const subtotalCell = columns[monthIndex],
      descriptionColumnIndex = columnNumber(subtotalCell.address.replace(/\d/g, '')),
      amountColumn = col(descriptionColumnIndex + 1),
      dateColumn = col(descriptionColumnIndex - 1),
      notesColumn = col(descriptionColumnIndex + 2);
    const month = new Date(Date.UTC(2024, 7 + monthIndex, 1)).toISOString().slice(0, 7);
    const salary = await buildTransaction(
      month,
      { address: dateColumn + '3', value: 'Salary', formula: null, type: 's' },
      getCell(dateColumn + '4'),
      getCell(dateColumn + '4'),
      getCell(notesColumn + '4'),
      true,
    );
    salary.notes = '';
    transactions.push(salary);
    const exactValues: Decimal[] = [];
    const monthItems: Transaction[] = [];
    for (let row = 5; row <= 1020; row++) {
      const descriptionCell = getCell(col(descriptionColumnIndex) + row),
        amount = getCell(amountColumn + row);
      if (descriptionCell.value === null && amount.value === null && amount.formula === null)
        continue;
      if (amount.formula && /[A-Za-z:]/.test(amount.formula))
        throw new Error(
          `Summary formula in amount column ${amount.address}; review layout before importing.`,
        );
      const t = await buildTransaction(
        month,
        descriptionCell,
        amount,
        getCell(dateColumn + row),
        getCell(notesColumn + row),
      );
      transactions.push(t);
      monthItems.push(t);
      if (t.source?.originalValue !== null) exactValues.push(new Decimal(t.source!.originalValue!));
    }
    const exact = exactValues.reduce((s, v) => s.add(v), new Decimal(0));
    const rawSubtotal = new Decimal(subtotalCell.value!);
    // Only Sept 2025 has a subtotal that excludes income rows; retain them as transactions.
    const adjustment =
      month === '2025-09'
        ? Array.from({ length: 7 }, (_, j) => getCell('BC' + (75 + j))).reduce(
            (s, c) => s.add(readAmount(c)),
            new Decimal(0),
          )
        : new Decimal(0);
    const salaryValue = new Decimal(salary.amount!);
    const exactNet = salaryValue.sub(exact);
    const workbookNet = salaryValue.sub(rawSubtotal.add(adjustment));
    const t = totals([salary, ...monthItems]);
    // Locate the workbook's month balance formula above this block; monthly and cumulative are separate.
    const balance = Object.values(cells).find(
      (c) =>
        c.address.endsWith('2') &&
        c.formula &&
        new RegExp(`(?:^|[^A-Z])${dateColumn}4(?:[^0-9]|$)`).test(c.formula),
    );
    const sourceNet = balance?.value ? new Decimal(balance.value).neg() : null;
    months.push({
      month,
      count: monthItems.length,
      unresolved: t.unresolved,
      salary: t.salary,
      expenses: t.expenses,
      income: t.income + t.refunds,
      savings: t.savings,
      workbookSubtotal: rawSubtotal.toString(),
      workbookNet: workbookNet.toString(),
      exactNet: exactNet.toString(),
      roundingDelta: new Decimal(t.savings).sub(exactNet).toString(),
      subtotalAdjustment: adjustment.toString(),
      unexplained: exactNet.sub(workbookNet).toString(),
      subtotalCell: subtotalCell.address,
      subtotalFormula: subtotalCell.formula!,
      balanceCell: balance?.address ?? null,
      balanceFormula: balance?.formula ?? null,
      balanceDifference: sourceNet ? exactNet.sub(sourceNet).toString() : null,
    });
  }
  return {
    transactions,
    report: { file, hash, generatedAt: new Date().toISOString(), counts, months },
  };
}
/** Plan without mutation. Existing IDs and deletion tombstones always win over reimport. */
export function planImport(ledger: Ledger, incoming: Transaction[]) {
  const existing = new Map(ledger.transactions.map((t) => [t.id, t]));
  return {
    fresh: incoming.filter((t) => !existing.has(t.id) && !ledger.deletedSourceIds.includes(t.id)),
    skipped: incoming.filter((t) => existing.has(t.id) || ledger.deletedSourceIds.includes(t.id)),
    conflicts: incoming.filter(
      (t) =>
        existing.has(t.id) && existing.get(t.id)?.source?.fingerprint !== t.source?.fingerprint,
    ),
  };
}
