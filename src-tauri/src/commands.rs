//! The custom commands the webview may call. Each one checks its input before touching the database or the
//! file-system scope; the webview is treated as untrusted.

use crate::db::{self, RecentAssessment};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Largest value accepted for one autosave key or one file summary. Assessments with logos and scan evidence run to
/// a few megabytes; this leaves room without letting the webview fill the disk.
pub const MAX_VALUE_BYTES: usize = 32 * 1024 * 1024;
const MAX_PATH_BYTES: usize = 4096;

/// The only autosave keys the web build writes (`persistence.ts`, `store.ts`).
const AUTOSAVE_KEYS: &[&str] = &[
    "crownguard:v1",
    "crownguard:v1:unreadable",
    "crownguard:v1:ephemeral",
    "crownguard:v1:probe",
];

pub struct Db(pub Mutex<Connection>);

/// An update found by `update_check`, held until the user chooses to install it.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

/// A file the operating system asked us to open (double-click, Open With), waiting for the webview to take it.
#[derive(Default)]
pub struct LaunchFile(pub Mutex<Option<PathBuf>>);

fn with_db<T>(
    db: &State<'_, Db>,
    f: impl FnOnce(&Connection) -> db::Result<T>,
) -> Result<T, String> {
    let conn =
        db.0.lock()
            .map_err(|_| "database lock poisoned".to_string())?;
    f(&conn)
}

pub fn check_key(key: &str) -> Result<(), String> {
    if AUTOSAVE_KEYS.contains(&key) {
        Ok(())
    } else {
        Err("unknown autosave key".into())
    }
}

pub fn check_value(value: &str) -> Result<(), String> {
    if value.len() > MAX_VALUE_BYTES {
        return Err("value is too large".into());
    }
    Ok(())
}

/// A path the webview reports for a file the user picked: absolute, a `.json` file, no NUL bytes, sensible length.
/// The path is only used as an index key and shown back to the user; it is never opened from here.
pub fn check_assessment_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > MAX_PATH_BYTES || path.contains('\0') {
        return Err("invalid path".into());
    }
    if !Path::new(path).is_absolute() {
        return Err("path must be absolute".into());
    }
    if !path.to_ascii_lowercase().ends_with(".json") {
        return Err("only .json assessment files are recorded".into());
    }
    Ok(())
}

#[tauri::command]
pub fn autosave_load(db: State<'_, Db>) -> Result<HashMap<String, String>, String> {
    with_db(&db, db::autosave_all)
}

#[tauri::command]
pub fn autosave_set(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    check_key(&key)?;
    check_value(&value)?;
    with_db(&db, |c| db::autosave_set(c, &key, &value))
}

#[tauri::command]
pub fn autosave_remove(db: State<'_, Db>, key: String) -> Result<(), String> {
    check_key(&key)?;
    with_db(&db, |c| db::autosave_remove(c, &key))
}

#[tauri::command]
pub fn recent_list(db: State<'_, Db>) -> Result<Vec<RecentAssessment>, String> {
    with_db(&db, db::recent)
}

#[tauri::command]
pub fn recent_record(db: State<'_, Db>, path: String, contents: String) -> Result<(), String> {
    check_assessment_path(&path)?;
    check_value(&contents)?;
    with_db(&db, |c| db::record_file(c, &path, &contents))
}

#[tauri::command]
pub fn recent_forget(db: State<'_, Db>, path: String) -> Result<(), String> {
    check_assessment_path(&path)?;
    with_db(&db, |c| db::forget_file(c, &path))
}

/// Hand over the file the app was launched to open, once.
#[tauri::command]
pub fn launch_file_take(launch: State<'_, LaunchFile>) -> Result<Option<String>, String> {
    let mut slot = launch.0.lock().map_err(|_| "lock poisoned".to_string())?;
    Ok(slot.take().map(|p| p.to_string_lossy().into_owned()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub update_check: bool,
    /// False when this build carries no updater public key, so updates can't be verified and stay off.
    pub update_available_in_build: bool,
}

#[tauri::command]
pub fn settings_get(app: AppHandle, db: State<'_, Db>) -> Result<Settings, String> {
    Ok(Settings {
        update_check: with_db(&db, |c| db::setting_bool(c, db::UPDATE_CHECK))?,
        update_available_in_build: crate::updater_key_configured(&app),
    })
}

#[tauri::command]
pub fn settings_set_update_check(db: State<'_, Db>, enabled: bool) -> Result<(), String> {
    with_db(&db, |c| db::set_setting_bool(c, db::UPDATE_CHECK, enabled))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

/// The one network call the app can make. It refuses unless the user has turned the update check on, and the
/// updater plugin only accepts packages signed with the public key built into this app.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    if !with_db(&db, |c| db::setting_bool(c, db::UPDATE_CHECK))? {
        return Err("The update check is turned off.".into());
    }
    if !crate::updater_key_configured(&app) {
        return Err("This build has no update signing key, so it can't check for updates.".into());
    }
    let update = app
        .updater()
        .map_err(|e| format!("update check failed: {e}"))?
        .check()
        .await
        .map_err(|e| format!("update check failed: {e}"))?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        notes: u.body.clone(),
    });
    *pending.0.lock().map_err(|_| "lock poisoned".to_string())? = update;
    Ok(info)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    db: State<'_, Db>,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    if !with_db(&db, |c| db::setting_bool(c, db::UPDATE_CHECK))? {
        return Err("The update check is turned off.".into());
    }
    let update = pending
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .take()
        .ok_or("No update is waiting. Check for updates first.")?;
    // download_and_install verifies the signature against the configured public key before installing anything.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("update failed: {e}"))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_autosave_keys_are_accepted() {
        assert!(check_key("crownguard:v1").is_ok());
        assert!(check_key("crownguard:v1:unreadable").is_ok());
        assert!(check_key("crownguard:v2").is_err());
        assert!(check_key("").is_err());
        assert!(check_key("crownguard:v1'; DROP TABLE autosave; --").is_err());
    }

    #[test]
    fn values_are_size_limited() {
        assert!(check_value("{}").is_ok());
        assert!(check_value(&"x".repeat(MAX_VALUE_BYTES + 1)).is_err());
    }

    #[test]
    fn recorded_paths_must_be_absolute_json_files() {
        let abs = if cfg!(windows) {
            r"C:\Users\x\a.crownguard.json"
        } else {
            "/home/x/a.crownguard.json"
        };
        assert!(check_assessment_path(abs).is_ok());
        assert!(check_assessment_path("a.crownguard.json").is_err());
        assert!(check_assessment_path("/etc/passwd").is_err());
        assert!(check_assessment_path("").is_err());
        assert!(check_assessment_path("/x/a\0.json").is_err());
        assert!(check_assessment_path(&format!("/{}.json", "a".repeat(5000))).is_err());
    }
}
