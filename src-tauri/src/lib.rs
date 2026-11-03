//! crownguard desktop: the web app in a locked-down Tauri webview, with SQLite instead of localStorage and native
//! file dialogs instead of downloads. See docs/desktop/security.md for the threat model.

mod commands;
pub mod db;

use commands::{Db, LaunchFile, PendingUpdate};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_fs::FsExt;

/// Event sent to the webview when the operating system asks the running app to open a file.
pub const OPEN_FILE_EVENT: &str = "open-file";

/// True when the build carries an updater public key. Without one the update check stays unavailable.
pub fn updater_key_configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

/// A file handed to us by the operating system, if it looks like an assessment we can open.
fn assessment_file(candidate: &Path) -> Option<PathBuf> {
    let name = candidate
        .file_name()?
        .to_string_lossy()
        .to_ascii_lowercase();
    if !name.ends_with(".json") {
        return None;
    }
    let path = candidate.canonicalize().ok()?;
    let meta = std::fs::metadata(&path).ok()?;
    (meta.is_file() && meta.len() <= commands::MAX_VALUE_BYTES as u64).then_some(path)
}

/// Let the webview read (and save back to) a file the user opened from the operating system, and nudge it.
/// The webview takes the path with `launch_file_take`, on start-up and on each nudge, so it is opened exactly once
/// however early the operating system sends it.
fn offer_file(app: &AppHandle, path: PathBuf) {
    if app.fs_scope().allow_file(&path).is_err() {
        return;
    }
    if let Ok(mut slot) = app.state::<LaunchFile>().0.lock() {
        *slot = Some(path);
    }
    let _ = app.emit(OPEN_FILE_EVENT, ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .manage(LaunchFile::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("crownguard.db"))?;
            app.manage(Db(Mutex::new(conn)));

            // Windows and Linux pass a double-clicked file as an argument. macOS sends RunEvent::Opened below.
            if let Some(path) = std::env::args_os()
                .skip(1)
                .find_map(|a| assessment_file(Path::new(&a)))
            {
                offer_file(app.handle(), path);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::autosave_load,
            commands::autosave_set,
            commands::autosave_remove,
            commands::recent_list,
            commands::recent_record,
            commands::recent_forget,
            commands::launch_file_take,
            commands::settings_get,
            commands::settings_set_update_check,
            commands::update_check,
            commands::update_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while building crownguard");

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Some(path) = url.to_file_path().ok().and_then(|p| assessment_file(&p)) {
                    offer_file(_app, path);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_json_files_are_offered() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("org.crownguard.json");
        std::fs::write(&good, "{}").unwrap();
        let other = dir.path().join("notes.txt");
        std::fs::write(&other, "x").unwrap();
        assert!(assessment_file(&good).is_some());
        assert!(assessment_file(&other).is_none());
        assert!(assessment_file(dir.path()).is_none());
        assert!(assessment_file(&dir.path().join("missing.json")).is_none());
    }
}
