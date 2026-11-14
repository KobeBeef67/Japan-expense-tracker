import type { Tag, Transaction } from './model';
import { tagNames } from './tags';
export function csvText(items: Transaction[], tags: Tag[]) {
  const cols = [
    'id',
    'reporting_month',
    'date',
    'description',
    'type',
    'amount_yen',
    'category',
    'tag_ids_json',
    'tag_names_json',
    'notes',
    'flags',
    'entry_expression',
    'source_file',
    'source_sheet',
    'source_amount_cell',
    'source_date_cell',
    'original_description',
    'original_date',
    'original_value',
    'original_formula',
    'original_notes',
    'receipt_origin',
    'receipt_input',
    'receipt_reviewed_at',
  ];
  const quote = (value: unknown) => {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    cols,
    ...items.map((t) => [
      t.id,
      t.month,
      t.date,
      t.description,
      t.type,
      t.amount,
      t.category,
      JSON.stringify(t.tagIds),
      JSON.stringify(tagNames(tags, t.tagIds)),
      t.notes,
      t.flags.join('; '),
      t.expression,
      t.source?.file,
      t.source?.sheet,
      t.source?.cell,
      t.source?.date.address,
      t.source?.description.value,
      t.source?.date.value,
      t.source?.originalValue,
      t.source?.amount.formula,
      t.source?.notes.value,
      t.receipt?.origin,
      t.receipt?.input,
      t.receipt?.reviewedAt,
    ]),
  ]
    .map((row) => row.map(quote).join(','))
    .join('\r\n');
}
