#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod migration;
mod settings;
mod storage;
use serde_json::{json, Value};
use std::sync::Mutex;
use storage::Store;
use tauri::{Manager, State};
/// Tauri shares one storage instance; the mutex serializes all native commands.
struct AppState {
    store: Mutex<Store>,
}
fn ocr_self_test_mode() -> bool {
    std::env::args().any(|s| s == "--ocr-self-test")
}
#[tauri::command]
/// Diagnostic-only command: write synthetic results, then close the isolated test process.
fn finish_ocr_self_test(result: Value, app: tauri::AppHandle) -> Result<(), String> {
    if !ocr_self_test_mode() {
        return Err("Diagnostic mode is not enabled".into());
    }
    let path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .unwrap()
        .join("ocr-self-test.json");
    storage::atomic(
        &path,
        &serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
    )?;
    app.exit(if result["passed"] == true { 0 } else { 1 });
    Ok(())
}
#[tauri::command]
/// Initial UI payload. JSON field names are the TypeScript/native bridge contract.
fn load(state: State<AppState>) -> Result<Value, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let settings: Value = serde_json::from_slice(
        &std::fs::read(store.dir.join("settings.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if settings["schemaVersion"] != 1 {
        return Err("Unsupported settings schema".into());
    }
    Ok(json!({
        "ledger": store.ledger,
        "path": store.dir,
        "recovery": store.recovery,
        "settings": settings,
        "ocrSelfTest": ocr_self_test_mode()
    }))
}
#[tauri::command]
/// Persist a proposed ledger only when its expected revision still matches.
fn save(ledger: Value, expected: u64, state: State<AppState>) -> Result<Value, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .save(ledger, expected)
}
#[tauri::command]
/// Newest-first list of ledger snapshots; settings snapshots are separate.
fn backups(state: State<AppState>) -> Result<Vec<String>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let mut names: Vec<String> = std::fs::read_dir(store.dir.join("backups"))
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.starts_with("transactions-") && n.ends_with(".json"))
        .collect();
    names.sort();
    names.reverse();
    Ok(names)
}
#[tauri::command]
fn backup(state: State<AppState>) -> Result<String, String> {
    state.store.lock().map_err(|e| e.to_string())?.backup()
}
#[tauri::command]
fn restore(name: String, state: State<AppState>) -> Result<Value, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .restore(&name)
}
#[tauri::command]
/// Preserve the previous settings before replacing the current JSON file.
fn save_settings(settings: Value, state: State<AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    settings::save(&store.dir, &settings)
}
#[tauri::command]
/// Add a UTF-8 BOM for spreadsheet compatibility and save beside the ledger.
fn export_csv(csv: String, state: State<AppState>) -> Result<String, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let path = store.dir.join(format!(
        "export-{}.csv",
        chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S")
    ));
    storage::atomic(&path, format!("\u{feff}{csv}").as_bytes())?;
    Ok(path.display().to_string())
}
// Startup resolves paths from the executable before constructing the Tauri application.
fn main() {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let exe = std::env::current_exe()?;
        let parent = exe.parent().ok_or("Cannot locate executable folder")?;
        for key in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(p) = std::env::var(key) {
                if parent
                    .to_string_lossy()
                    .to_lowercase()
                    .starts_with(&p.to_lowercase())
                {
                    return Err(
                        "Move ExpenseTracker.exe into a writable folder outside Program Files."
                            .into(),
                    );
                }
            }
        }
        let store = Store::open(parent.join(if ocr_self_test_mode() {
            "self-test-data"
        } else {
            "data"
        }))
        .map_err(std::io::Error::other)?;
        let mut builder = tauri::Builder::default();
        if !ocr_self_test_mode() {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }));
        }
        builder
            .setup(|app| {
                if ocr_self_test_mode() {
                    if let Some(w) = app.get_webview_window("main") {
                        w.hide()?;
                    }
                }
                Ok(())
            })
            .manage(AppState {
                store: Mutex::new(store),
            })
            .invoke_handler(tauri::generate_handler![
                load,
                save,
                backups,
                backup,
                restore,
                save_settings,
                export_csv,
                finish_ocr_self_test
            ])
            .run(tauri::generate_context!())?;
        Ok(())
    })();
    if let Err(e) = result {
        #[cfg(windows)]
        {
            use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
            #[link(name = "user32")]
            unsafe extern "system" {
                fn MessageBoxW(h: usize, text: *const u16, title: *const u16, kind: u32) -> i32;
            }
            let msg: Vec<u16> = OsStr::new(&e.to_string())
                .encode_wide()
                .chain(Some(0))
                .collect();
            let title: Vec<u16> = OsStr::new("Expense Tracker could not open")
                .encode_wide()
                .chain(Some(0))
                .collect();
            unsafe {
                MessageBoxW(0, msg.as_ptr(), title.as_ptr(), 0x10);
            }
        }
        eprintln!("{e}");
        std::process::exit(1);
    }
}
