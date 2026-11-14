use std::{fs::{self, File, OpenOptions}, io::Write, path::{Path, PathBuf}, collections::HashSet};
use serde_json::{Value,json};
use fs2::FileExt;
use chrono::Utc;

pub struct Store { pub dir:PathBuf, pub ledger:Value, pub recovery:String, _lock:File }
pub fn validate(v:&Value)->Result<(),String>{
 if v["schemaVersion"]!=1&&v["schemaVersion"]!=crate::migration::SCHEMA {return Err("Unsupported data schema. No files were changed.".into());}
 if v["revision"].as_u64().is_none(){return Err("Missing data revision".into());}
 let rows=v["transactions"].as_array().ok_or("Missing transactions")?;
 if rows.len()>200000{return Err("Too many transactions".into());}
 let mut ids=HashSet::new();
 for t in rows {
  let id=t["id"].as_str().filter(|s|!s.is_empty()).ok_or("Invalid transaction ID")?;
  if !ids.insert(id){return Err("Duplicate transaction ID".into());}
  let m=t["month"].as_str().ok_or("Invalid reporting month")?;
  if m.len()!=7||chrono::NaiveDate::parse_from_str(&format!("{m}-01"),"%Y-%m-%d").is_err(){return Err("Invalid reporting month".into());}
  if !t["date"].is_null()&&chrono::NaiveDate::parse_from_str(t["date"].as_str().ok_or("Invalid date")?,"%Y-%m-%d").is_err(){return Err("Invalid transaction date".into());}
  if !t["amount"].is_null(){let a=t["amount"].as_f64().ok_or("Invalid amount")?;if !a.is_finite()||a<0.0||a>9_000_000_000.0||a.fract()!=0.0{return Err("Amounts must be whole nonnegative yen; type determines direction".into());}}
  if !["expense","salary","income","refund"].contains(&t["type"].as_str().unwrap_or("")){return Err("Invalid transaction type".into());}
  for k in ["description","category","notes"] {if t[k].as_str().filter(|s|s.len()<100000).is_none(){return Err(format!("Invalid {k}"));}}
  if v["schemaVersion"]==1&&t["trip"].as_str().is_none(){return Err("Invalid legacy trip value".into());}
  if t["flags"].as_array().filter(|a|a.iter().all(|s|s.as_str().is_some())).is_none(){return Err("Invalid review flags".into());}
 }
 if v["deletedSourceIds"].as_array().filter(|a|a.iter().all(|s|s.as_str().is_some())).is_none()||v["imports"].as_array().is_none(){return Err("Invalid import history".into());}
 if v["schemaVersion"]==crate::migration::SCHEMA{crate::migration::validate_tags_and_receipts(v)?;}Ok(())
}
fn read_ledger(p:&Path)->Result<Value,String>{let bytes=fs::read(p).map_err(|e|e.to_string())?;if bytes.len()>100_000_000{return Err("Data file exceeds 100 MB".into());}let v=serde_json::from_slice(&bytes).map_err(|e|format!("{}: {e}",p.display()))?;validate(&v)?;Ok(v)}
pub fn atomic(path:&Path,bytes:&[u8])->Result<(),String>{
 let temp=path.with_extension("json.pending");let mut f=File::create(&temp).map_err(|e|e.to_string())?;f.write_all(bytes).map_err(|e|e.to_string())?;f.sync_all().map_err(|e|e.to_string())?;drop(f);
 #[cfg(windows)] {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::{MoveFileExW,MOVEFILE_REPLACE_EXISTING,MOVEFILE_WRITE_THROUGH};
  let from:Vec<u16>=temp.as_os_str().encode_wide().chain(Some(0)).collect();let to:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
  if unsafe{MoveFileExW(from.as_ptr(),to.as_ptr(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)}==0{return Err(std::io::Error::last_os_error().to_string());}
 }
 #[cfg(not(windows))] fs::rename(&temp,path).map_err(|e|e.to_string())?;
 Ok(())
}
impl Store {
 pub fn open(dir:PathBuf)->Result<Self,String>{
  fs::create_dir_all(dir.join("backups")).map_err(|e|format!("Choose a writable portable folder outside Program Files. {e}"))?;
  let lock=OpenOptions::new().read(true).write(true).create(true).truncate(false).open(dir.join(".lock")).map_err(|e|e.to_string())?;
  lock.try_lock_exclusive().map_err(|_|"This data folder is already open in another app instance".to_string())?;
  let path=dir.join("transactions.json");let pending=dir.join("transactions.json.pending");let mut recovery=String::new();
  let ledger=if path.exists(){match read_ledger(&path){Ok(v)=>{if pending.exists(){recovery="An interrupted save was discarded. The last committed save is intact.".into();}v},Err(e)=>{
   // Preserve unsupported future schemas. Never downgrade or overwrite them.
   if let Ok(v)=fs::read(&path).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok()).ok_or(()) {if v["schemaVersion"].as_u64().unwrap_or(1)>crate::migration::SCHEMA{return Err(e);}}
   let mut candidates:Vec<PathBuf>=fs::read_dir(dir.join("backups")).map_err(|e|e.to_string())?.filter_map(|e|e.ok().map(|e|e.path())).filter(|p|p.extension().is_some_and(|e|e=="json")).collect();candidates.sort();candidates.reverse();
   let v=candidates.iter().find_map(|p|read_ledger(p).ok()).ok_or(format!("Data is damaged and no valid backup is available: {e}. Preserve the files and restore manually."))?;
   fs::copy(&path,dir.join("backups").join(format!("damaged-{}.json",Utc::now().timestamp_millis()))).map_err(|e|e.to_string())?;
   atomic(&path,&serde_json::to_vec_pretty(&v).unwrap())?;recovery="Recovered the latest valid backup. The damaged file was preserved in backups.".into();v
  }}}else if pending.exists(){let v=read_ledger(&pending)?;atomic(&path,&serde_json::to_vec_pretty(&v).unwrap())?;recovery="Recovered an interrupted first save.".into();v}else{let v=json!({"schemaVersion":2,"revision":0,"tags":[],"transactions":[],"deletedSourceIds":[],"imports":[]});atomic(&path,&serde_json::to_vec_pretty(&v).unwrap())?;v};
  let settings=dir.join("settings.json");if !settings.exists(){atomic(&settings,br#"{"schemaVersion":1,"currency":"JPY","rounding":"half-away-from-zero","categories":["Food","Housing","Transport","Bills","Shopping","Entertainment","Travel","Health"]}"#)?;}
  let mut store=Self{dir,ledger,recovery,_lock:lock};
  if store.ledger["schemaVersion"]==1{let upgraded=crate::migration::upgrade(&store.ledger)?;let revision=store.ledger["revision"].as_u64().unwrap();store.save(upgraded,revision)?;store.recovery.push_str(" Migrated schema 1 to 2. A pre-migration backup was saved; legacy trip groups are now tags.");}
  Ok(store)
 }
 pub fn backup(&self)->Result<String,String>{let name=format!("transactions-{}-r{}.json",Utc::now().format("%Y-%m-%dT%H-%M-%S%.9fZ"),self.ledger["revision"]);let path=self.dir.join("backups").join(&name);let mut f=OpenOptions::new().write(true).create_new(true).open(path).map_err(|e|e.to_string())?;f.write_all(&serde_json::to_vec_pretty(&self.ledger).unwrap()).map_err(|e|e.to_string())?;f.sync_all().map_err(|e|e.to_string())?;Ok(name)}
 pub fn save(&mut self,mut next:Value,expected:u64)->Result<Value,String>{
  validate(&next)?;if next["schemaVersion"]!=crate::migration::SCHEMA{return Err("Only the current schema may be saved. Older backups must pass through migration.".into());}if self.ledger["revision"].as_u64()!=Some(expected){return Err("Data changed since this view was loaded. Restart before saving.".into());}
  // Detect external edits as well as concurrent commands.
  let disk=read_ledger(&self.dir.join("transactions.json"))?;if disk!=self.ledger{return Err("The JSON file was changed outside the app. Restart before saving.".into());}
  next["revision"]=json!(expected+1);self.backup()?;atomic(&self.dir.join("transactions.json"),&serde_json::to_vec_pretty(&next).map_err(|e|e.to_string())?)?;self.ledger=next.clone();Ok(next)
 }
 pub fn restore(&mut self,name:&str)->Result<Value,String>{if !name.starts_with("transactions-")||name.contains(['/', '\\'])||!name.ends_with(".json"){return Err("Invalid backup name".into());}let v=read_ledger(&self.dir.join("backups").join(name))?;let migrated=crate::migration::upgrade(&v)?;self.save(migrated,self.ledger["revision"].as_u64().unwrap())}
}

#[cfg(test)] mod tests {
 use super::*;
 fn dir(label:&str)->PathBuf{let d=std::env::current_dir().unwrap().join("target").join(format!("test-{label}-{}",Utc::now().timestamp_nanos_opt().unwrap()));fs::create_dir_all(&d).unwrap();d}
 fn history_fixture()->Value{
  let path=Path::new(env!("CARGO_MANIFEST_DIR")).join("../test-results/imported-ledger.json");
  if path.exists(){return serde_json::from_slice(&fs::read(path).unwrap()).unwrap();}
  json!({"schemaVersion":2,"revision":0,"tags":[],"deletedSourceIds":[],"imports":[],"transactions":[
   {"id":"synthetic-salary","date":null,"month":"2020-01","description":"Synthetic salary","amount":5000,"type":"salary","category":"","tagIds":[],"notes":"","flags":[]},
   {"id":"synthetic-expense","date":"2020-01-05","month":"2020-01","description":"Synthetic expense","amount":100,"type":"expense","category":"Food","tagIds":[],"notes":"","flags":[]}
  ]})
 }
 #[test] fn persistence_lock_and_cas(){let d=dir("persist");let mut s=Store::open(d.clone()).unwrap();assert!(Store::open(d.clone()).is_err());let mut next=s.ledger.clone();next["imports"]=json!([{ "test":"persist"}]);s.save(next,0).unwrap();assert!(s.save(s.ledger.clone(),0).is_err());drop(s);let s=Store::open(d).unwrap();assert_eq!(s.ledger["imports"][0]["test"],"persist");assert_eq!(s.ledger["revision"],1);}
 #[test] fn interrupted_save_and_backup_restore(){let d=dir("recovery");let mut s=Store::open(d.clone()).unwrap();s.save(s.ledger.clone(),0).unwrap();drop(s);fs::write(d.join("transactions.json.pending"),b"{broken").unwrap();let s=Store::open(d.clone()).unwrap();assert!(s.recovery.contains("interrupted"));drop(s);fs::write(d.join("transactions.json"),b"{broken").unwrap();let s=Store::open(d).unwrap();assert!(s.recovery.contains("Recovered"));assert_eq!(s.ledger["schemaVersion"],2);}
 #[test] fn first_save_recovery_and_future_schema(){let d=dir("first");let s=Store::open(d.clone()).unwrap();let v=s.ledger.clone();drop(s);fs::remove_file(d.join("transactions.json")).unwrap();fs::write(d.join("transactions.json.pending"),serde_json::to_vec(&v).unwrap()).unwrap();let s=Store::open(d.clone()).unwrap();assert!(s.recovery.contains("first"));drop(s);let mut future=v;future["schemaVersion"]=json!(3);fs::write(d.join("transactions.json"),serde_json::to_vec(&future).unwrap()).unwrap();assert!(Store::open(d).is_err());}
 #[test] fn imported_history_restart_and_explicit_restore(){let d=dir("imported");let v=history_fixture();validate(&v).unwrap();let mut s=Store::open(d.clone()).unwrap();s.save(v.clone(),0).unwrap();let name=s.backup().unwrap();let mut changed=s.ledger.clone();changed["transactions"][0]["description"]=json!("edited salary");s.save(changed,1).unwrap();drop(s);let mut s=Store::open(d).unwrap();assert_eq!(s.ledger["transactions"][0]["description"],"edited salary");s.restore(&name).unwrap();assert_eq!(s.ledger["transactions"],v["transactions"]);assert_eq!(s.ledger["transactions"].as_array().unwrap().len(),v["transactions"].as_array().unwrap().len());assert_eq!(s.ledger["revision"],3);}
 #[test] fn interrupted_migration_and_old_backup_restore_preserve_history(){
  let d=dir("migration");let mut old=history_fixture();old["schemaVersion"]=json!(1);old["revision"]=json!(9);old.as_object_mut().unwrap().remove("tags");
  for (i,t) in old["transactions"].as_array_mut().unwrap().iter_mut().enumerate(){t.as_object_mut().unwrap().remove("tagIds");t["trip"]=json!(if i==0{" Sample  trip A "}else if i==1{"SAMPLE TRIP A"}else{""});}
  let upgraded=crate::migration::upgrade(&old).unwrap();fs::write(d.join("transactions.json"),serde_json::to_vec(&old).unwrap()).unwrap();fs::write(d.join("transactions.json.pending"),serde_json::to_vec(&upgraded).unwrap()).unwrap();
  let mut s=Store::open(d.clone()).unwrap();assert_eq!(s.ledger["schemaVersion"],2);assert_eq!(s.ledger["revision"],10);assert_eq!(s.ledger["transactions"],upgraded["transactions"]);
  let backup_name=fs::read_dir(d.join("backups")).unwrap().filter_map(|e|e.ok()).map(|e|e.file_name().to_string_lossy().to_string()).find(|n|n.starts_with("transactions-")).unwrap();let preserved=read_ledger(&d.join("backups").join(&backup_name)).unwrap();assert_eq!(preserved,old);
  let mut changed=s.ledger.clone();changed["transactions"][0]["amount"]=json!(1);s.save(changed,10).unwrap();s.restore(&backup_name).unwrap();assert_eq!(s.ledger["transactions"],upgraded["transactions"]);assert_eq!(s.ledger["imports"],old["imports"]);assert_eq!(s.ledger["deletedSourceIds"],old["deletedSourceIds"]);assert_eq!(s.ledger["revision"],12);drop(s);let s=Store::open(d).unwrap();assert_eq!(s.ledger["tags"].as_array().unwrap().len(),1);
 }
}
