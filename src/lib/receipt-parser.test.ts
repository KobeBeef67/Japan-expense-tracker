import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractReceipt,receiptCategorySuggestions } from './receipt-parser';
import { imageDimensions } from './receipt-images';

describe('Receipt extraction without OCR',()=>{
 it.each([
  ['合計 ¥1,280\n現金 ¥2,000\nお釣り ¥720',1280],
  ['TOTAL 1280\nCASH 2000\nCHANGE 720',1280],
  ['SUBTOTAL 1185\nTAX 95\nTOTAL 1280',1280],
  ['小計 ¥1,185\n内消費税 ¥95\n合 計 ¥1,280',1280],
  ['合計 ¥1,280 (内税 ¥95)',1280],
  ['GRAND TOTAL 1280\nPOINTS 3000',1280],
  ['AMOUNT DUE 1280\nCREDIT CARD 1280',1280],
  ['合計\n¥1,280\n預り\n¥2,000',1280],
 ])('distinguishes final total from tax/tender/change: %s',(text,total)=>expect(extractReceipt(text).amount).toBe(total));
 it('never chooses the largest amount without a final-total label',()=>{const r=extractReceipt('商品 ¥500\n商品 ¥780\n現金 ¥2000\nお釣り ¥720');expect(r.amount).toBeNull();expect(r.candidates.map(c=>c.amount)).toEqual([500,780]);});
 it('keeps differing final totals ambiguous and collapses matching repeats',()=>{expect(extractReceipt('TOTAL 1280\n合計 ¥1380').amount).toBeNull();expect(extractReceipt('TOTAL 1280\n合計 ¥1280').amount).toBe(1280);});
 it('does not treat subtotal or total tax as final total',()=>{expect(extractReceipt('SUBTOTAL 1280\nTOTAL TAX 95\nCASH 2000\nCHANGE 625').amount).toBeNull();});
 it.each([['2026年11月14日','2026-11-14'],['2026/11/14','2026-11-14'],['2026-11-14','2026-11-14'],['令和8年11月14日','2026-11-14'],['11/14/2026','2026-11-14']])('recognizes dates without substituting today: %s',(text,date)=>expect(extractReceipt(text).date).toBe(date));
 it('leaves absent, invalid, or ambiguous dates unresolved',()=>{expect(extractReceipt('TOTAL 1280').date).toBeNull();expect(extractReceipt('2026/02/31').date).toBeNull();const r=extractReceipt('03/04/2026');expect(r.date).toBeNull();expect(r.dateCandidates).toHaveLength(2);});
 it('suggests only existing broad categories; ambiguous store-only text is insufficient',()=>{expect(receiptCategorySuggestions('食品 野菜', ['Food','Bills'])).toEqual(['Food']);expect(receiptCategorySuggestions('amazon', ['Food','Shopping'])).toEqual([]);});
 it('extracts expected fields from actual local synthetic OCR output when benchmark exists',()=>{let report:any;try{report=JSON.parse(readFileSync('test-results/ocr-benchmark.json','utf8'));}catch{return;}for(const r of report.results){expect(extractReceipt(r.text).amount,r.fixture).toBe(1280);expect(extractReceipt(r.text).date,r.fixture).toBe('2026-11-14');}});
});
describe('Image preflight',()=>{
 it('reads image dimensions before decoding',()=>{expect(imageDimensions(new Uint8Array(readFileSync('public/receipt-fixtures/japanese.png')))).toEqual({width:900,height:1100,mime:'image/png'});});
 it('rejects arbitrary files and oversized encoded dimensions',()=>{expect(()=>imageDimensions(new TextEncoder().encode('<svg/>'))).toThrow();const bytes=new Uint8Array(readFileSync('public/receipt-fixtures/japanese.png'));new DataView(bytes.buffer).setUint32(16,20000);expect(()=>imageDimensions(bytes)).toThrow('24 megapixels');});
});
