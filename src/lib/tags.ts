import type { Ledger,Tag,Transaction } from './model';
import { cleanTagName,tagKey } from './tag-names';
import { totals } from './model';
export function tagNames(items:Tag[],ids:string[]){const selected=new Set(ids);return items.filter(t=>selected.has(t.id)).map(t=>t.name);}
export function ensureTag(ledger:Ledger,input:string):{ledger:Ledger;tag:Tag}{
 const name=cleanTagName(input),existing=ledger.tags.find(t=>tagKey(t.name)===tagKey(name));if(existing)return {ledger,tag:existing};
 const tag={id:crypto.randomUUID(),name};return {ledger:{...ledger,tags:[...ledger.tags,tag]},tag};
}
export function resolveTagNames(ledger:Ledger,names:string[]){let next=ledger;const ids:string[]=[];for(const name of names){const result=ensureTag(next,name);next=result.ledger;if(!ids.includes(result.tag.id))ids.push(result.tag.id);}return {ledger:next,ids};}
export function matchesTags(t:Transaction,ids:string[],mode:'any'|'all'='any'){return !ids.length||(mode==='any'?ids.some(id=>t.tagIds.includes(id)):ids.every(id=>t.tagIds.includes(id)));}
export function tagSpending(items:Transaction[]){const t=totals(items);return {...t,netSpending:t.expenses-t.refunds};}
export function bulkTags(ledger:Ledger,transactionIds:string[],tagIds:string[],operation:'add'|'remove'):Ledger{
 const selected=new Set(transactionIds),targets=new Set(tagIds);if(tagIds.some(id=>!ledger.tags.some(t=>t.id===id)))throw new Error('Unknown tag');
 return {...ledger,transactions:ledger.transactions.map(t=>selected.has(t.id)?{...t,tagIds:operation==='add'?[...new Set([...t.tagIds,...tagIds])]:t.tagIds.filter(id=>!targets.has(id))}:t)};
}
export function renameTag(ledger:Ledger,id:string,input:string,merge=false):Ledger{
 if(!ledger.tags.some(t=>t.id===id))throw new Error('Tag no longer exists');const name=cleanTagName(input),collision=ledger.tags.find(t=>t.id!==id&&tagKey(t.name)===tagKey(name));
 if(collision){if(!merge)throw new Error(`A tag named “${collision.name}” already exists. Choose Merge to combine membership.`);return {...ledger,tags:ledger.tags.filter(t=>t.id!==id),transactions:ledger.transactions.map(t=>({...t,tagIds:[...new Set(t.tagIds.map(old=>old===id?collision.id:old))]}))};}
 return {...ledger,tags:ledger.tags.map(t=>t.id===id?{...t,name}:t)};
}
export function removeTag(ledger:Ledger,id:string):Ledger{return {...ledger,tags:ledger.tags.filter(t=>t.id!==id),transactions:ledger.transactions.map(t=>t.tagIds.includes(id)?{...t,tagIds:t.tagIds.filter(old=>old!==id)}:t)};}
