use serde_json::{Value,json};
use sha2::{Sha256,Digest};
use unicode_normalization::UnicodeNormalization;
use std::collections::{HashMap,HashSet};

pub const SCHEMA:u64=2;
pub fn clean_name(s:&str)->String{s.split_whitespace().collect::<Vec<_>>().join(" ")}
pub fn tag_key(s:&str)->String{clean_name(&s.nfkc().collect::<String>()).to_lowercase()}
pub fn validate_tags_and_receipts(v:&Value)->Result<(),String>{
 let tags=v["tags"].as_array().ok_or("Missing tag registry")?;if tags.len()>20000{return Err("Too many tags".into());}
 let mut ids=HashSet::new();let mut names=HashSet::new();
 for t in tags{
  let id=t["id"].as_str().filter(|s|!s.is_empty()&&s.len()<=200).ok_or("Invalid tag ID")?;let name=t["name"].as_str().ok_or("Invalid tag name")?;
  if name.is_empty()||clean_name(name)!=name||name.encode_utf16().count()>120{return Err("Tag names must be trimmed, nonempty, and no longer than 120 characters".into());}
  if !ids.insert(id)||!names.insert(tag_key(name)){return Err("Duplicate tag identity or case-insensitive name".into());}
 }
 for t in v["transactions"].as_array().ok_or("Missing transactions")?{
  if t.get("trip").is_some(){return Err("Schema 2 uses tag IDs instead of the legacy trip field".into());}
  let members=t["tagIds"].as_array().ok_or("Missing transaction tag membership")?;let mut seen=HashSet::new();
  for member in members {let id=member.as_str().ok_or("Invalid tag reference")?;if !ids.contains(id)||!seen.insert(id){return Err("Unknown or duplicate transaction tag reference".into());}}
  if let Some(receipt)=t.get("receipt"){
   let fields=receipt.as_object().ok_or("Invalid receipt metadata")?;
   if fields.len()!=4||!fields.keys().all(|s|["origin","input","engine","reviewedAt"].contains(&s.as_str())){return Err("Receipt metadata may contain only origin, input, engine, and reviewedAt; no images or OCR text".into());}
   if receipt["origin"]!="receipt-scan"||!["camera","file","synthetic"].contains(&receipt["input"].as_str().unwrap_or("")){return Err("Invalid receipt origin".into());}
   if receipt["engine"].as_str().filter(|s|!s.is_empty()&&s.len()<=80).is_none()||chrono::DateTime::parse_from_rfc3339(receipt["reviewedAt"].as_str().unwrap_or("")).is_err(){return Err("Invalid receipt review metadata".into());}
  }
 }
 Ok(())
}
/// Pure, deterministic migration. Files and revisions are managed by Store, never here.
pub fn upgrade(v:&Value)->Result<Value,String>{
 crate::storage::validate(v)?;if v["schemaVersion"]==SCHEMA{return Ok(v.clone());}
 let mut next=v.clone();let mut registry:Vec<Value>=Vec::new();let mut known:HashMap<String,String>=HashMap::new();
 for t in next["transactions"].as_array_mut().ok_or("Missing transactions")?{
  let name=clean_name(t["trip"].as_str().unwrap_or(""));let mut members=Vec::new();
  if !name.is_empty(){let key=tag_key(&name);let id=known.entry(key.clone()).or_insert_with(||{
   let digest=Sha256::digest(key.as_bytes());let id=format!("trip-v1-{:x}",digest);registry.push(json!({"id":id,"name":name}));id
  }).clone();members.push(json!(id));}
  t.as_object_mut().ok_or("Invalid transaction")?.remove("trip");t["tagIds"]=json!(members);
 }
 next["tags"]=json!(registry);next["schemaVersion"]=json!(SCHEMA);crate::storage::validate(&next)?;Ok(next)
}

#[cfg(test)] mod tests{
 use super::*;
 fn legacy()->Value{json!({"schemaVersion":1,"revision":8,"deletedSourceIds":["old-id"],"imports":[],"transactions":[{"id":"one","date":null,"month":"2026-11","description":"food","amount":1280,"type":"expense","category":"Food","trip":" Sample  trip A ","notes":"keep","flags":["Undated"]},{"id":"two","date":"2026-11-14","month":"2026-11","description":"train","amount":null,"type":"expense","category":"Transport","trip":"sample trip a","notes":"","flags":["Missing amount"]}]})}
 #[test]fn deterministic_trip_migration_preserves_fields(){let old=legacy();let a=upgrade(&old).unwrap();let b=upgrade(&old).unwrap();assert_eq!(a,b);assert_eq!(upgrade(&a).unwrap(),a);assert_eq!(a["revision"],8);assert_eq!(a["tags"].as_array().unwrap().len(),1);assert_eq!(a["transactions"][0]["tagIds"],a["transactions"][1]["tagIds"]);for i in 0..2{let mut before=old["transactions"][i].clone();before.as_object_mut().unwrap().remove("trip");let mut after=a["transactions"][i].clone();after.as_object_mut().unwrap().remove("tagIds");assert_eq!(before,after);}assert_eq!(a["deletedSourceIds"],old["deletedSourceIds"]);}
 #[test]fn invalid_membership_names_and_receipt_payload_rejected(){let base=upgrade(&legacy()).unwrap();let mut v=base.clone();v["transactions"][0]["tagIds"]=json!(["unknown"]);assert!(crate::storage::validate(&v).is_err());let mut v=base.clone();v["tags"].as_array_mut().unwrap().push(json!({"id":"different","name":"SAMPLE TRIP A"}));assert!(crate::storage::validate(&v).is_err());let mut v=base;v["transactions"][0]["receipt"]=json!({"origin":"receipt-scan","input":"camera","engine":"test","reviewedAt":"2026-11-14T00:00:00Z","image":"base64"});assert!(crate::storage::validate(&v).is_err());}
}
