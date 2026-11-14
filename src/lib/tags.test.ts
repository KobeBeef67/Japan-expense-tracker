import { describe, it, expect } from 'vitest';
import { emptyLedger, totals } from './model';
import type { Transaction } from './model';
import { resolveTagNames, matchesTags, bulkTags, renameTag, removeTag, tagSpending } from './tags';
import { csvText } from './csv';
import { withCancellation } from './cancellation';
const row = (
  id: string,
  type: Transaction['type'] = 'expense',
  amount: number | null = 100,
): Transaction => ({
  id,
  type,
  amount,
  date: null,
  month: '2026-11',
  description: 'food',
  category: 'Food',
  tagIds: [],
  flags: ['Undated'],
  notes: 'keep',
});
describe('User tags', () => {
  it('normalizes membership without duplicate names and preserves display spelling', () => {
    const start = emptyLedger();
    const r = resolveTagNames(start, [' Sample  trip A ', 'SAMPLE TRIP A', 'Travel']);
    expect(r.ledger.tags.map((t) => t.name)).toEqual(['Sample trip A', 'Travel']);
    expect(r.ids).toHaveLength(2);
    expect(() => resolveTagNames(start, ['   '])).toThrow();
  });
  it('filters multiple tags once and keeps spending separate from income/salary', () => {
    const tagged = row('expense');
    tagged.tagIds = ['a', 'b'];
    const refund = { ...row('refund', 'refund', 25), tagIds: ['a'] };
    const items = [
      tagged,
      refund,
      { ...row('income', 'income', 500), tagIds: ['b'] },
      { ...row('salary', 'salary', 1000), tagIds: ['b'] },
      { ...row('unknown', 'expense', null), tagIds: ['a'] },
    ];
    const selected = items.filter((t) => matchesTags(t, ['a', 'b']));
    expect(selected).toHaveLength(5);
    expect(items.filter((t) => matchesTags(t, ['a', 'b'], 'all'))).toHaveLength(1);
    expect(tagSpending(selected)).toMatchObject({
      expenses: 100,
      refunds: 25,
      netSpending: 75,
      income: 500,
      salary: 1000,
      unresolved: 1,
    });
  });
  it('bulk changes only selected membership, then merges/renames/removes without changing accounting', () => {
    let ledger = { ...emptyLedger(), transactions: [row('one'), row('two')] };
    const r = resolveTagNames(ledger, ['Trip Alpha', 'Trip Beta']);
    ledger = r.ledger;
    const before = totals(ledger.transactions);
    ledger = bulkTags(ledger, ['one'], r.ids, 'add');
    expect(ledger.transactions[0].tagIds).toEqual(r.ids);
    expect(ledger.transactions[1].tagIds).toEqual([]);
    expect(ledger.transactions[0].notes).toBe('keep');
    expect(ledger.transactions[0].flags).toEqual(['Undated']);
    expect(() => renameTag(ledger, r.ids[0], 'TRIP BETA')).toThrow('already exists');
    ledger = renameTag(ledger, r.ids[0], 'TRIP BETA', true);
    expect(ledger.tags).toHaveLength(1);
    expect(ledger.transactions[0].tagIds).toEqual([r.ids[1]]);
    ledger = bulkTags(ledger, ['one'], r.ids.slice(1), 'remove');
    expect(ledger.transactions[0].tagIds).toEqual([]);
    ledger = removeTag(ledger, r.ids[1]);
    expect(ledger.transactions).toHaveLength(2);
    expect(totals(ledger.transactions)).toEqual(before);
  });
  it('exports unambiguous JSON tag arrays inside correctly escaped CSV cells', () => {
    const r = resolveTagNames(emptyLedger(), ['Trip, A', 'Quote "B"']);
    const t = { ...row('one'), tagIds: r.ids, description: '=unsafe' };
    const csv = csvText([t], r.ledger.tags);
    expect(csv).toContain('tag_ids_json');
    expect(csv).toContain('tag_names_json');
    expect(csv).toContain("'=unsafe");
    expect(csv).toContain('Trip, A');
    expect(csv).toContain('Quote');
    expect(t.flags).toEqual(['Undated']);
  });
});
describe('OCR cancellation boundary', () => {
  it('settles cancellation even if a terminated worker never replies, and ignores a late result', async () => {
    const controller = new AbortController();
    let finish: (s: string) => void = () => {};
    const pending = new Promise<string>((resolve) => (finish = resolve));
    const job = withCancellation(pending, controller.signal);
    controller.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    finish('stale OCR');
  });
});
