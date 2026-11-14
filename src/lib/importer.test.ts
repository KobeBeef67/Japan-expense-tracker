import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { inspectWorkbook, planImport, col } from './importer';
import { calculate, yen } from './arithmetic';
import { emptyLedger, totals } from './model';

describe('Restricted decimal arithmetic', () => {
  it('rounds halves away from zero with exact expressions', () => {
    expect(yen('7/2')).toBe(4);
    expect(yen('-7/2')).toBe(-4);
    expect(yen('(20-10)/3')).toBe(3);
    expect(calculate('0.1+0.2').toString()).toBe('0.3');
  });
  it('keeps exact rational halves before rounding', () => {
    expect(yen('(1/3)*3/2')).toBe(1);
    expect(yen('-(1/3)*3/2')).toBe(-1);
    expect(yen('0.4999999999999999999999999999999999999999999')).toBe(0);
  });
  it('rejects executable/invalid expressions', () => {
    for (const s of [
      'alert(1)',
      '1/0',
      'NaN',
      '2**3',
      '3;4',
      'SUM(A1:A3)',
      '1e8',
      '()',
      '1 2',
      '('.repeat(100) + '1' + ')'.repeat(100),
    ])
      expect(() => calculate(s), s).toThrow();
  });
});

/** Fictional values only; no source workbook or personal financial records. */
function syntheticWorkbook() {
  const rows = new Map<number, string[]>();
  const put = (row: number, cell: string) => rows.set(row, [...(rows.get(row) || []), cell]);
  const numeric = (address: string, value: number, formula?: string) =>
    `<c r="${address}">${formula ? `<f>${formula}</f>` : ''}<v>${value}</v></c>`;
  const label = (address: string, value: string) =>
    `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
  for (let i = 0; i < 28; i++) {
    const n = 2 + i * 4,
      desc = col(n),
      amount = col(n + 1),
      dc = col(n - 1),
      value = i === 0 ? 3.5 : 100;
    put(4, numeric(dc + '4', i < 25 ? -5000 : 5000));
    put(
      4,
      numeric(
        desc + '4',
        value,
        i === 13
          ? `sum(${amount}5:${amount}74,${amount}82:${amount}1020)`
          : `sum(${amount}5:${amount}1020)`,
      ),
    );
    put(5, label(desc + '5', 'Synthetic purchase'));
    put(5, numeric(amount + '5', value, i === 0 ? '7/2' : undefined));
    const month = new Date(Date.UTC(2024, 7 + i, 5)).toISOString().slice(0, 10);
    if (i !== 0) put(5, `<c r="${dc}5" t="d"><v>${i === 4 ? '2025-12-05' : month}</v></c>`);
    if (i === 1) put(6, label(desc + '6', 'Synthetic unresolved entry'));
    if (i === 13)
      for (let row = 75; row <= 81; row++) {
        put(row, label(desc + row, 'Synthetic reimbursement'));
        put(row, numeric(amount + row, -10));
        put(row, `<c r="${dc}${row}" t="d"><v>2025-08-05</v></c>`);
      }
  }
  put(61, numeric('AF61', 123, 'sum(AE60:AE70)'));
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return zipSync({
    'xl/workbook.xml': strToU8(
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<worksheet xmlns="${ns}"><sheetData>${[...rows.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([r, c]) => `<row r="${r}">${c.join('')}</row>`)
        .join('')}</sheetData></worksheet>`,
    ),
  });
}
describe('Synthetic legacy workbook import', () => {
  it('preserves uncertainty/provenance, reconciles, and repeats without duplicate records', async () => {
    const { transactions, report } = await inspectWorkbook(
      syntheticWorkbook(),
      'synthetic-expenses.xlsx',
    );
    expect(report.months).toHaveLength(28);
    expect(report.counts).toMatchObject({ amounts: 35, missing: 1, undated: 1, yearErrors: 1 });
    expect(transactions).toHaveLength(64);
    expect(new Set(transactions.map((t) => t.id)).size).toBe(64);
    expect(transactions.find((t) => t.source?.cell === 'C5')).toMatchObject({
      amount: 4,
      date: null,
      month: '2024-08',
    });
    expect(transactions.find((t) => t.amount === null)?.description).toBe(
      'Synthetic unresolved entry',
    );
    expect(transactions.some((t) => t.source?.cell === 'AF61')).toBe(false);
    expect(report.months.find((m) => m.month === '2025-09')?.subtotalAdjustment).toBe('-70');
    expect(report.months.every((m) => Number(m.unexplained) === 0)).toBe(true);
    const ledger = { ...emptyLedger(), transactions, imports: [report] };
    expect(planImport(ledger, transactions).fresh).toHaveLength(0);
    const removed = transactions[0];
    ledger.transactions = transactions.slice(1);
    ledger.deletedSourceIds = [removed.id];
    expect(planImport(ledger, transactions).fresh).toHaveLength(0);
    const repeated = { ...transactions[1], id: 'independent-repeat' };
    expect(totals([transactions[1], repeated]).expenses).toBe(transactions[1].amount! * 2);
  });
});
