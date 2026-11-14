import { yen } from './arithmetic';

export interface TotalCandidate { amount:number; context:string; explicit:boolean }
export interface ReceiptExtraction { date:string|null; dateCandidates:string[]; amount:number|null; candidates:TotalCandidate[]; warnings:string[] }
const normalized=(s:string)=>s.normalize('NFKC').replace(/[￥]/g,'¥').replace(/[−–—]/g,'-');
function validDate(year:number,month:number,day:number){const s=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;return year>=1900&&year<=2199&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s?s:null;}
export function extractReceipt(raw:string):ReceiptExtraction {
 const text=normalized(raw.slice(0,100000)), dates=new Set<string>();
 function add(y:number,m:number,d:number){try{const value=validDate(y,m,d);if(value)dates.add(value);}catch{/* Invalid date stays unrecognized. */}}
 for(const m of text.matchAll(/\b(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/g))add(+m[1],+m[2],+m[3]);
 for(const m of text.matchAll(/(?:令和|Reiwa|\bR)\s*(\d{1,2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/gi))add(2018+(+m[1]),+m[2],+m[3]);
 for(const m of text.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(20\d{2})\b/g)){
  if(+m[1]<=12)add(+m[3],+m[1],+m[2]);if(+m[2]<=12)add(+m[3],+m[2],+m[1]);
 }
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),candidates:TotalCandidate[]=[];
 const totals=/(?:総合計|お買上(?:げ)?合計|お支払(?:い)?(?:合計|金額|額)|ご請求(?:金額|額)|合計|総計|(?:grand|final)\s*total|amount\s*(?:due|paid)|balance\s*due|\btotal\b)/i;
 const excluded=/(?:小計|内税|外税|消費税|税額|お?釣|お?預[かり]*|預り|現金|ポイント|獲得|subtotal|sub\s*total|tax|cash|tender|change|points|credit\s*card|visa|mastercard)/i;
 function amounts(s:string){return [...s.matchAll(/(?:¥\s*)?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(?:円)?/g)].map(m=>({amount:yen(m[1].replaceAll(',','')),index:m.index!})).filter(x=>x.amount>=0);}
 for(let i=0;i<lines.length;i++){
  const line=lines[i],compact=line.replace(/([一-龠ぁ-ゔァ-ヴ])\s+(?=[一-龠ぁ-ゔァ-ヴ])/g,'$1'),match=totals.exec(compact);
  if(match){
   // Ignore subtotal/tax/tender labels before the total. Included-tax suffixes never add another amount.
   const before=compact.slice(0,match.index);if(excluded.test(before)||/subtotal|sub\s*total|小計/i.test(compact))continue;
   let suffix=compact.slice(match.index+match[0].length);const excludeAt=suffix.search(excluded);if(excludeAt>=0)suffix=suffix.slice(0,excludeAt);
   let values=amounts(suffix).filter(x=>!/%/.test(suffix.slice(x.index)));
   if(!values.length&&i+1<lines.length&&/^(?:[¥\s]*[\d,]+(?:\.\d+)?\s*円?)$/.test(lines[i+1]))values=amounts(lines[i+1]);
   if(values.length)candidates.push({amount:values[0].amount,context:line.slice(0,180),explicit:true});
  }else if(!excluded.test(line)&&/¥|円/.test(line)&&!/[年/月]|\b\d{4}[-.]\d/.test(line)){
   const values=amounts(line);if(values.length===1)candidates.push({amount:values[0].amount,context:line.slice(0,180),explicit:false});
  }
 }
 const unique=[...new Map(candidates.map(c=>[`${c.amount}:${c.explicit}`,c])).values()],explicit=[...new Set(unique.filter(c=>c.explicit).map(c=>c.amount))];
 const warnings:string[]=[];if(dates.size===0)warnings.push('Date not detected');if(dates.size>1)warnings.push('Several dates are plausible; select or enter the purchase date');
 if(explicit.length===0)warnings.push('Final total not detected; enter it or select a candidate');if(explicit.length>1)warnings.push('Several final totals are plausible; review the candidates');
 return {date:dates.size===1?[...dates][0]:null,dateCandidates:[...dates],amount:explicit.length===1?explicit[0]:null,candidates:unique,warnings};
}
/** Suggestions only use categories the user already has, and require explicit acceptance. */
export function receiptCategorySuggestions(text:string,categories:string[]):string[]{
 const t=normalized(text).toLowerCase();const rules:[RegExp,RegExp][]=[[/食品|食料|野菜|牛乳|弁当|パン|grocer|vegetable|milk|bread/,/food|grocer|食品|食料/i],[/レストラン|カフェ|飲食|restaurant|coffee|cafe/,/food|dining|食品|飲食/i],[/乗車|鉄道|運賃|icoca|train|rail|transport/,/transport|交通/i],[/薬局|医薬|pharmacy|medicine/,/health|医療/i]];
 return [...new Set(rules.filter(([r])=>r.test(t)).flatMap(([,category])=>categories.filter(c=>category.test(c))))];
}
