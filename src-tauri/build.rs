/// The app's own commands, listed so each one needs an explicit `allow-*` entry in a capability file
/// (least privilege: a command added here is not reachable until a capability grants it).
const COMMANDS: &[&str] = &[
    "autosave_load",
    "autosave_set",
    "autosave_remove",
    "recent_list",
    "recent_record",
    "recent_forget",
    "launch_file_take",
    "settings_get",
    "settings_set_update_check",
    "update_check",
    "update_install",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
