use serde_json::Value;
use std::path::Path;

pub fn validate(settings: &Value) -> Result<(), String> {
    if settings["schemaVersion"] != 1 || settings["categories"].as_array().is_none() {
        return Err("Invalid settings".into());
    }
    if let Some(theme) = settings.get("theme") {
        if !["light", "dark"].contains(&theme.as_str().unwrap_or("")) {
            return Err("Theme must be light or dark".into());
        }
    }
    Ok(())
}

/// Settings stay separate from financial data, with a dated snapshot before atomic replacement.
pub fn save(dir: &Path, settings: &Value) -> Result<(), String> {
    validate(settings)?;
    let path = dir.join("settings.json");
    let old = std::fs::read(&path).map_err(|error| error.to_string())?;
    crate::storage::atomic(
        &dir.join("backups").join(format!(
            "settings-{}.json",
            chrono::Utc::now().format("%Y%m%d-%H%M%S-%f")
        )),
        &old,
    )?;
    crate::storage::atomic(
        &path,
        &serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn optional_theme_accepts_legacy_settings_and_rejects_unknown_values() {
        assert!(validate(&json!({"schemaVersion":1,"categories":["Food"]})).is_ok());
        for theme in ["light", "dark"] {
            assert!(validate(&json!({"schemaVersion":1,"categories":[],"theme":theme})).is_ok());
        }
        for theme in [
            json!("system"),
            json!("unknown"),
            json!(null),
            json!(true),
            json!(1),
        ] {
            assert!(validate(&json!({"schemaVersion":1,"categories":[],"theme":theme})).is_err());
        }
    }
    #[test]
    fn theme_survives_readback_with_backup_and_no_ledger_change() {
        let root = std::env::temp_dir();
        let dir = root.join(format!(
            "expense-tracker-settings-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&dir).unwrap();
        std::fs::create_dir(dir.join("backups")).unwrap();
        let original = br#"{"schemaVersion":1,"categories":["Food"],"custom":"keep"}"#;
        std::fs::write(dir.join("settings.json"), original).unwrap();
        std::fs::write(dir.join("transactions.json"), b"unchanged ledger sentinel").unwrap();
        let mut settings: Value = serde_json::from_slice(original).unwrap();
        settings["theme"] = json!("dark");
        save(&dir, &settings).unwrap();
        let reopened: Value =
            serde_json::from_slice(&std::fs::read(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(reopened["theme"], "dark");
        assert_eq!(reopened["custom"], "keep");
        let backups: Vec<_> = std::fs::read_dir(dir.join("backups"))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read(&backups[0]).unwrap(), original);
        settings["theme"] = json!("invalid");
        assert!(save(&dir, &settings).is_err());
        let unchanged: Value =
            serde_json::from_slice(&std::fs::read(dir.join("settings.json")).unwrap()).unwrap();
        assert_eq!(unchanged, reopened);
        assert_eq!(
            std::fs::read(dir.join("transactions.json")).unwrap(),
            b"unchanged ledger sentinel"
        );
        assert!(
            dir.starts_with(&root)
                && dir
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("expense-tracker-settings-")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
