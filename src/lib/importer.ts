import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { calculate, Decimal, yen } from './arithmetic';
import type { Cell, Transaction, ImportReport, Ledger, Reconciliation } from './model';
import { totals } from './model';
const FAMILY='japan-expenses-sheet1-v1';
const array=(x:any):any[]=>x==null?[]:Array.isArray(x)?x:[x];
function textValue(x:any):string {if(x==null)return '';if(typeof x==='string')return x;if(x['#text']!==undefined)return String(x['#text']);if(x.t!==undefined)return textValue(x.t);if(x.r!==undefined)return array(x.r).map(textValue).join('');return '';}
export function col(n:number){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function colNum(s:string){return [...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);}
export async function sha256(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function inspectWorkbook(bytes:Uint8Array,file:string):Promise<{transactions:Transaction[];report:ImportReport}> {
 if(bytes.length>20*1024*1024)throw new Error('Workbook exceeds 20 MB');
 const zip=unzipSync(bytes,{filter:e=>e.originalSize<30*1024*1024&&/^xl\/(sharedStrings.xml|workbook.xml|_rels\/workbook.xml.rels|worksheets\/sheet\d+.xml)$/.test(e.name)});
 const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true});
 const read=(path:string)=>{if(!zip[path])throw new Error(`Missing workbook part: ${path}`);return parser.parse(strFromU8(zip[path]));};
 const sheets=array(read('xl/workbook.xml').workbook.sheets.sheet), sheet=sheets.find(s=>s['@_name']==='Sheet1');
 if(!sheet||sheets.length!==1)throw new Error('Expected the Japan expenses workbook with one worksheet, Sheet1');
 const rel=array(read('xl/_rels/workbook.xml.rels').Relationships.Relationship).find(r=>r['@_Id']===sheet['@_r:id']);
 const target=String(rel?.['@_Target']||'');const path=target.startsWith('/')?target.slice(1):'xl/'+target;
 const strings=zip['xl/sharedStrings.xml']?array(read('xl/sharedStrings.xml').sst.si).map(textValue):[];
 const cells:Record<string,Cell>={};
 for(const row of array(read(path).worksheet.sheetData.row))for(const c of array(row.c)){
  const raw=c.v===undefined?null:String(c.v);const type=c['@_t']||'n';const value=type==='s'?strings[Number(raw)]:type==='inlineStr'?textValue(c.is):raw;
  if(value!==null||c.f!==undefined)cells[c['@_r']]={address:c['@_r'],value:value??null,formula:c.f===undefined?null:typeof c.f==='object'?textValue(c.f):String(c.f),type};
 }
 const get=(a:string):Cell=>cells[a]||{address:a,value:null,formula:null,type:'n'};
 const hash=await sha256(bytes);const transactions:Transaction[]=[];const months:Reconciliation[]=[];
 const counts={amounts:0,missing:0,undated:0,yearErrors:0,crossMonth:0};
 const columns=Object.values(cells).filter(c=>/^[A-Z]+4$/.test(c.address)&&/^sum\(/i.test(c.formula||'')).sort((a,b)=>colNum(a.address.replace(/\d/g,''))-colNum(b.address.replace(/\d/g,'')));
 if(columns.length!==28||columns[0].address!=='B4'||columns[27].address!=='DF4')throw new Error('Unsupported workbook layout. Expected 28 monthly blocks from B4 through DF4; no data imported.');
 function number(c:Cell):Decimal {if(c.formula){try{return calculate(c.formula);}catch{throw new Error(`Unsupported transaction calculation at ${c.address}: ${c.formula}`);}}if(c.value===null||c.type!=='n')throw new Error(`Non-numeric amount at ${c.address}`);return calculate(c.value);}
 function date(c:Cell):string|null {if(c.value===null)return null;if(c.type==='n'&&/^\d+(\.\d+)?$/.test(c.value)){const d=new Date(Date.UTC(1899,11,30)+Number(c.value)*86400000);if(!Number.isFinite(d.getTime()))throw new Error(`Invalid date ${c.address}`);return d.toISOString().slice(0,10);}if(/^\d{4}-\d{2}-\d{2}/.test(c.value))return c.value.slice(0,10);throw new Error(`Unrecognized date at ${c.address}. Original workbook preserved.`);}
 async function make(month:string,description:Cell,amount:Cell,dc:Cell,notes:Cell,salary=false):Promise<Transaction>{
  const v=amount.value===null&&amount.formula===null?null:number(amount),flags:string[]=[];const dt=salary?null:date(dc);
  if(!salary){if(v===null){counts.missing++;flags.push('Missing amount');}else{counts.amounts++;if(!dt)counts.undated++;}if(!dt)flags.push('Undated');if(dt&&dt.slice(0,7)!==month){counts.crossMonth++;flags.push('Date outside reporting month');if(dt.slice(5,7)===month.slice(5)&&dt.slice(0,4)!==month.slice(0,4)){counts.yearErrors++;flags.push('Likely year error');}}}
  if(v&&!v.isInteger())flags.push('Rounded to whole yen');
  const original=v?.toString()??null;const signed=v?yen(amount.formula||amount.value!):null;
  const kind=salary?'salary':v?.isNegative()?(/refund|reimburs|transport|payback/i.test(description.value||'')?'refund':'income'):'expense';
  if(v?.isNegative()&&!salary)flags.push('Review income / refund type');
  const source={family:FAMILY,sheet:'Sheet1',cell:amount.address,file,hash,fingerprint:await sha256(new TextEncoder().encode(JSON.stringify({description,amount,dc,notes}))),description,amount,date:dc,notes,originalValue:original};
  return {id:`${FAMILY}:${amount.address}`,month,date:dt,description:description.value||'Salary',amount:signed===null?null:Math.abs(signed),type:kind,category:'',tagIds:[],notes:notes.value||'',flags,source};
 }
 for(let i=0;i<columns.length;i++){
  const summary=columns[i],n=colNum(summary.address.replace(/\d/g,'')),ac=col(n+1),dc=col(n-1),nc=col(n+2);
  const month=new Date(Date.UTC(2024,7+i,1)).toISOString().slice(0,7);
  const salary=await make(month,{address:dc+'3',value:'Salary',formula:null,type:'s'},get(dc+'4'),get(dc+'4'),get(nc+'4'),true);salary.notes='';transactions.push(salary);
  const exactValues:Decimal[]=[];const monthItems:Transaction[]=[];
  for(let row=5;row<=1020;row++){
   const desc=get(col(n)+row),amount=get(ac+row);if(desc.value===null&&amount.value===null&&amount.formula===null)continue;
   if(amount.formula&&/[A-Za-z:]/.test(amount.formula))throw new Error(`Summary formula in amount column ${amount.address}; review layout before importing.`);
   const t=await make(month,desc,amount,get(dc+row),get(nc+row));transactions.push(t);monthItems.push(t);if(t.source?.originalValue!==null)exactValues.push(new Decimal(t.source!.originalValue!));
  }
  const exact=exactValues.reduce((s,v)=>s.add(v),new Decimal(0));const rawSubtotal=new Decimal(summary.value!);
  // Only Sept 2025 has a subtotal that excludes income rows; retain them as transactions.
  const adjustment=month==='2025-09'?Array.from({length:7},(_,j)=>get('BC'+(75+j))).reduce((s,c)=>s.add(number(c)),new Decimal(0)):new Decimal(0);
  const salaryValue=new Decimal(salary.amount!);const exactNet=salaryValue.sub(exact);const workbookNet=salaryValue.sub(rawSubtotal.add(adjustment));const t=totals([salary,...monthItems]);
  // Locate the workbook's month balance formula above this block; monthly and cumulative are separate.
  const balance=Object.values(cells).find(c=>c.address.endsWith('2')&&c.formula&&new RegExp(`(?:^|[^A-Z])${dc}4(?:[^0-9]|$)`).test(c.formula));
  const sourceNet=balance?.value?new Decimal(balance.value).neg():null;
  months.push({month,count:monthItems.length,unresolved:t.unresolved,salary:t.salary,expenses:t.expenses,income:t.income+t.refunds,savings:t.savings,workbookSubtotal:rawSubtotal.toString(),workbookNet:workbookNet.toString(),exactNet:exactNet.toString(),roundingDelta:new Decimal(t.savings).sub(exactNet).toString(),subtotalAdjustment:adjustment.toString(),unexplained:exactNet.sub(workbookNet).toString(),subtotalCell:summary.address,subtotalFormula:summary.formula!,balanceCell:balance?.address??null,balanceFormula:balance?.formula??null,balanceDifference:sourceNet?exactNet.sub(sourceNet).toString():null});
 }
 return {transactions,report:{file,hash,generatedAt:new Date().toISOString(),counts,months}};
}
export function planImport(ledger:Ledger,incoming:Transaction[]){const existing=new Map(ledger.transactions.map(t=>[t.id,t]));return {fresh:incoming.filter(t=>!existing.has(t.id)&&!ledger.deletedSourceIds.includes(t.id)),skipped:incoming.filter(t=>existing.has(t.id)||ledger.deletedSourceIds.includes(t.id)),conflicts:incoming.filter(t=>existing.has(t.id)&&existing.get(t.id)?.source?.fingerprint!==t.source?.fingerprint)};}
