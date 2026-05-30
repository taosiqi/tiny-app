use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};

use crate::AppResult;
use std::collections::BTreeMap;

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
    #[serde(default = "default_preset_id")]
    pub default_preset_id: String,
    #[serde(default = "default_compression_presets")]
    pub compression_presets: BTreeMap<String, CompressionPreset>,
    #[serde(default)]
    pub tinypng_keys: Vec<StoredTinypngKey>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionPreset {
    #[serde(default = "default_true")]
    pub recursive_scan: bool,
    #[serde(default = "default_audio_format")]
    pub audio_format: String,
    #[serde(default = "default_audio_quality")]
    pub audio_quality: String,
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

fn default_preset_id() -> String {
    "balanced".into()
}

fn default_true() -> bool {
    true
}

fn default_audio_format() -> String {
    "mixed".into()
}

fn default_audio_quality() -> String {
    "medium".into()
}

fn default_compression_presets() -> BTreeMap<String, CompressionPreset> {
    [
        ("compact", "low"),
        ("balanced", "medium"),
        ("quality", "high"),
    ]
    .into_iter()
    .map(|(id, quality)| {
        (
            id.into(),
            CompressionPreset {
                recursive_scan: true,
                audio_format: "mixed".into(),
                audio_quality: quality.into(),
            },
        )
    })
    .collect()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            night_mode: default_night_mode(),
            close_behavior: default_close_behavior(),
            backup_dir_name: default_backup_dir_name(),
            default_preset_id: default_preset_id(),
            compression_presets: default_compression_presets(),
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
    let default_preset_id = match settings.default_preset_id.as_str() {
        "balanced" | "compact" | "quality" => settings.default_preset_id,
        _ => AppSettings::default().default_preset_id,
    };

    AppSettings {
        night_mode,
        close_behavior,
        backup_dir_name,
        default_preset_id,
        compression_presets: normalize_compression_presets(settings.compression_presets),
        tinypng_keys: normalize_tinypng_keys(settings.tinypng_keys),
    }
}

fn normalize_compression_presets(
    presets: BTreeMap<String, CompressionPreset>,
) -> BTreeMap<String, CompressionPreset> {
    let defaults = default_compression_presets();
    defaults
        .iter()
        .map(|(id, fallback)| {
            let preset = presets.get(id).unwrap_or(fallback);
            let audio_format = match preset.audio_format.as_str() {
                "mixed" | "mp3" | "ogg" | "wav" => preset.audio_format.clone(),
                _ => fallback.audio_format.clone(),
            };
            let audio_quality = match preset.audio_quality.as_str() {
                "low" | "medium" | "high" => preset.audio_quality.clone(),
                _ => fallback.audio_quality.clone(),
            };
            (
                id.clone(),
                CompressionPreset {
                    recursive_scan: preset.recursive_scan,
                    audio_format,
                    audio_quality,
                },
            )
        })
        .collect()
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
