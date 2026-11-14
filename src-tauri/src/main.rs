#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod storage;
mod migration;
use storage::Store;
use serde_json::{Value,json};
use std::sync::Mutex;
use tauri::{Manager,State};
struct AppState(Mutex<Store>);
fn ocr_self_test_mode()->bool{std::env::args().any(|s|s=="--ocr-self-test")}
#[tauri::command] fn finish_ocr_self_test(result:Value,app:tauri::AppHandle)->Result<(),String>{if !ocr_self_test_mode(){return Err("Diagnostic mode is not enabled".into());}let path=std::env::current_exe().map_err(|e|e.to_string())?.parent().unwrap().join("ocr-self-test.json");storage::atomic(&path,&serde_json::to_vec_pretty(&result).map_err(|e|e.to_string())?)?;app.exit(if result["passed"]==true{0}else{1});Ok(())}
#[tauri::command] fn load(state:State<AppState>)->Result<Value,String>{let s=state.0.lock().map_err(|e|e.to_string())?;let settings:Value=serde_json::from_slice(&std::fs::read(s.dir.join("settings.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;if settings["schemaVersion"]!=1{return Err("Unsupported settings schema".into());}Ok(json!({"ledger":s.ledger,"path":s.dir,"recovery":s.recovery,"settings":settings,"ocrSelfTest":ocr_self_test_mode()}))}
#[tauri::command] fn save(ledger:Value,expected:u64,state:State<AppState>)->Result<Value,String>{state.0.lock().map_err(|e|e.to_string())?.save(ledger,expected)}
#[tauri::command] fn backups(state:State<AppState>)->Result<Vec<String>,String>{let s=state.0.lock().map_err(|e|e.to_string())?;let mut names:Vec<String>=std::fs::read_dir(s.dir.join("backups")).map_err(|e|e.to_string())?.filter_map(|e|e.ok()).filter_map(|e|e.file_name().into_string().ok()).filter(|n|n.starts_with("transactions-")&&n.ends_with(".json")).collect();names.sort();names.reverse();Ok(names)}
#[tauri::command] fn backup(state:State<AppState>)->Result<String,String>{state.0.lock().map_err(|e|e.to_string())?.backup()}
#[tauri::command] fn restore(name:String,state:State<AppState>)->Result<Value,String>{state.0.lock().map_err(|e|e.to_string())?.restore(&name)}
#[tauri::command] fn save_settings(settings:Value,state:State<AppState>)->Result<(),String>{if settings["schemaVersion"]!=1||settings["categories"].as_array().is_none(){return Err("Invalid settings".into());}let s=state.0.lock().map_err(|e|e.to_string())?;let old=std::fs::read(s.dir.join("settings.json")).map_err(|e|e.to_string())?;storage::atomic(&s.dir.join("backups").join(format!("settings-{}.json",chrono::Utc::now().timestamp_millis())),&old)?;storage::atomic(&s.dir.join("settings.json"),&serde_json::to_vec_pretty(&settings).map_err(|e|e.to_string())?)}
#[tauri::command] fn export_csv(csv:String,state:State<AppState>)->Result<String,String>{let s=state.0.lock().map_err(|e|e.to_string())?;let path=s.dir.join(format!("export-{}.csv",chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S")));storage::atomic(&path,format!("\u{feff}{csv}").as_bytes())?;Ok(path.display().to_string())}
fn main(){
 let result=(||->Result<(),Box<dyn std::error::Error>>{
  let exe=std::env::current_exe()?;let parent=exe.parent().ok_or("Cannot locate executable folder")?;
  for key in ["ProgramFiles","ProgramFiles(x86)"] {if let Ok(p)=std::env::var(key){if parent.to_string_lossy().to_lowercase().starts_with(&p.to_lowercase()){return Err("Move ExpenseTracker.exe into a writable folder outside Program Files.".into());}}}
  let store=Store::open(parent.join(if ocr_self_test_mode(){"self-test-data"}else{"data"})).map_err(std::io::Error::other)?;
  let mut builder=tauri::Builder::default();if !ocr_self_test_mode(){builder=builder.plugin(tauri_plugin_single_instance::init(|app,_,_|{if let Some(w)=app.get_webview_window("main"){let _=w.unminimize();let _=w.set_focus();}}));}
  builder.setup(|app|{if ocr_self_test_mode(){if let Some(w)=app.get_webview_window("main"){w.hide()?;}}Ok(())}).manage(AppState(Mutex::new(store))).invoke_handler(tauri::generate_handler![load,save,backups,backup,restore,save_settings,export_csv,finish_ocr_self_test]).run(tauri::generate_context!())?;Ok(())
 })();
 if let Err(e)=result { #[cfg(windows)] {use std::{ffi::OsStr,os::windows::ffi::OsStrExt};#[link(name="user32")] unsafe extern "system" {fn MessageBoxW(h:usize,text:*const u16,title:*const u16,kind:u32)->i32;}let msg:Vec<u16>=OsStr::new(&e.to_string()).encode_wide().chain(Some(0)).collect();let title:Vec<u16>=OsStr::new("Expense Tracker could not open").encode_wide().chain(Some(0)).collect();unsafe{MessageBoxW(0,msg.as_ptr(),title.as_ptr(),0x10);}} eprintln!("{e}");std::process::exit(1);}
}
