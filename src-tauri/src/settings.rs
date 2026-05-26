use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

use crate::AppResult;

pub const DEFAULT_BACKUP_DIR_NAME: &str = "_tiny_backup";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_night_mode")]
    pub night_mode: String,
    #[serde(default = "default_close_behavior")]
    pub close_behavior: String,
    #[serde(default = "default_backup_dir_name")]
    pub backup_dir_name: String,
    #[serde(default)]
    pub tinypng_keys: Vec<StoredTinypngKey>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTinypngKey {
    pub value: String,
    pub compression_count: Option<u32>,
}

pub struct SettingsState {
    pub config_path: PathBuf,
    pub value: Mutex<AppSettings>,
}

fn default_night_mode() -> String {
    "system".into()
}

fn default_close_behavior() -> String {
    "background".into()
}

pub fn default_backup_dir_name() -> String {
    DEFAULT_BACKUP_DIR_NAME.into()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            night_mode: default_night_mode(),
            close_behavior: default_close_behavior(),
            backup_dir_name: default_backup_dir_name(),
            tinypng_keys: Vec::new(),
        }
    }
}

pub fn load_settings(app: &AppHandle) -> (PathBuf, AppSettings) {
    let config_dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("TinyPress"));
    let config_path = config_dir.join("settings.json");
    let settings = fs::read_to_string(&config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<AppSettings>(&raw).ok())
        .map(normalize_settings)
        .unwrap_or_default();

    (config_path, settings)
}

pub fn normalize_settings(settings: AppSettings) -> AppSettings {
    let night_mode = match settings.night_mode.as_str() {
        "system" | "dark" | "light" => settings.night_mode,
        _ => AppSettings::default().night_mode,
    };
    let close_behavior = match settings.close_behavior.as_str() {
        "background" | "quit" => settings.close_behavior,
        _ => AppSettings::default().close_behavior,
    };
    let backup_dir_name = normalize_backup_dir_name(&settings.backup_dir_name);

    AppSettings {
        night_mode,
        close_behavior,
        backup_dir_name,
        tinypng_keys: normalize_tinypng_keys(settings.tinypng_keys),
    }
}

fn normalize_backup_dir_name(name: &str) -> String {
    let trimmed = name.trim();
    if is_valid_backup_dir_name(trimmed) {
        trimmed.to_string()
    } else {
        default_backup_dir_name()
    }
}

pub fn is_valid_backup_dir_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\\')
}

pub fn normalize_tinypng_keys(keys: Vec<StoredTinypngKey>) -> Vec<StoredTinypngKey> {
    keys.into_iter()
        .map(|key| StoredTinypngKey {
            value: key.value,
            compression_count: key.compression_count,
        })
        .collect()
}

pub fn persist_settings(path: &Path, settings: &AppSettings) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn should_hide_instead_of_quit(app: &AppHandle) -> bool {
    app.state::<SettingsState>()
        .value
        .lock()
        .map(|settings| settings.close_behavior == "background")
        .unwrap_or(true)
}

pub fn current_backup_dir_name(state: &State<'_, SettingsState>) -> String {
    state
        .value
        .lock()
        .map(|settings| settings.backup_dir_name.clone())
        .unwrap_or_else(|_| default_backup_dir_name())
}
