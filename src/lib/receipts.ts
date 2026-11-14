import type { Kind } from './model';
export interface ReceiptDraft {
  date: string | null;
  month: string;
  description: string;
  amount: number | null;
  expression: string;
  category: string;
  type: Kind;
  tagNames: string[];
  via: 'camera' | 'file' | 'synthetic' | 'mixed';
}
