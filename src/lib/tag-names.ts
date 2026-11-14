export interface Tag { id:string; name:string }
export function cleanTagName(value:string){const name=value.trim().replace(/\s+/gu,' ');if(!name)throw new Error('Enter a tag name');if(name.length>120)throw new Error('Tag names are limited to 120 characters');return name;}
export function tagKey(value:string){return value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();}
