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
    pub compression: CompressionSettings,
    #[serde(default)]
    pub tinypng_keys: Vec<StoredTinypngKey>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSettings {
    #[serde(default)]
    pub image: ImageCompressionSettings,
    #[serde(default)]
    pub audio: AudioCompressionSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCompressionSettings {
    #[serde(default = "default_true")]
    pub recursive_scan: bool,
    #[serde(default = "default_image_engine")]
    pub engine: String,
    #[serde(default)]
    pub local: LocalImageSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImageSettings {
    #[serde(default = "default_local_png")]
    pub png: LocalPngSettings,
    #[serde(default = "default_local_jpeg")]
    pub jpeg: LocalJpegSettings,
    #[serde(default = "default_local_webp")]
    pub webp: LocalWebpSettings,
    #[serde(default = "default_local_avif")]
    pub avif: LocalAvifSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPngSettings {
    pub mode: String,
    pub min_quality: u8,
    pub max_quality: u8,
    pub max_colors: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalJpegSettings {
    pub quality: u8,
    pub progressive: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWebpSettings {
    pub mode: String,
    pub quality: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAvifSettings {
    pub quality: u8,
    pub speed: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioCompressionSettings {
    #[serde(default = "default_true")]
    pub recursive_scan: bool,
    #[serde(default = "default_mp3")]
    pub mp3: LossyAudioSettings,
    #[serde(default = "default_ogg")]
    pub ogg: LossyAudioSettings,
    #[serde(default = "default_wav")]
    pub wav: WavAudioSettings,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossyAudioSettings {
    pub bitrate: String,
    pub sample_rate: u32,
    pub channels: u8,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavAudioSettings {
    pub sample_rate: u32,
    pub channels: u8,
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
fn default_true() -> bool {
    true
}
fn default_image_engine() -> String {
    "auto".into()
}
fn default_local_png() -> LocalPngSettings {
    LocalPngSettings {
        mode: "lossy".into(),
        min_quality: 70,
        max_quality: 90,
        max_colors: 256,
    }
}
fn default_local_jpeg() -> LocalJpegSettings {
    LocalJpegSettings {
        quality: 82,
        progressive: true,
    }
}
fn default_local_webp() -> LocalWebpSettings {
    LocalWebpSettings {
        mode: "lossy".into(),
        quality: 80,
    }
}
fn default_local_avif() -> LocalAvifSettings {
    LocalAvifSettings {
        quality: 70,
        speed: 6,
    }
}
fn default_mp3() -> LossyAudioSettings {
    LossyAudioSettings {
        bitrate: "96k".into(),
        sample_rate: 44100,
        channels: 2,
    }
}
fn default_ogg() -> LossyAudioSettings {
    LossyAudioSettings {
        bitrate: "96k".into(),
        sample_rate: 44100,
        channels: 2,
    }
}
fn default_wav() -> WavAudioSettings {
    WavAudioSettings {
        sample_rate: 22050,
        channels: 2,
    }
}

impl Default for ImageCompressionSettings {
    fn default() -> Self {
        Self {
            recursive_scan: true,
            engine: default_image_engine(),
            local: LocalImageSettings::default(),
        }
    }
}
impl Default for LocalImageSettings {
    fn default() -> Self {
        Self {
            png: default_local_png(),
            jpeg: default_local_jpeg(),
            webp: default_local_webp(),
            avif: default_local_avif(),
        }
    }
}
impl Default for AudioCompressionSettings {
    fn default() -> Self {
        Self {
            recursive_scan: true,
            mp3: default_mp3(),
            ogg: default_ogg(),
            wav: default_wav(),
        }
    }
}
impl Default for CompressionSettings {
    fn default() -> Self {
        Self {
            image: ImageCompressionSettings::default(),
            audio: AudioCompressionSettings::default(),
        }
    }
}
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            night_mode: default_night_mode(),
            close_behavior: default_close_behavior(),
            backup_dir_name: default_backup_dir_name(),
            compression: CompressionSettings::default(),
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
    AppSettings {
        night_mode: match settings.night_mode.as_str() {
            "system" | "dark" | "light" => settings.night_mode,
            _ => default_night_mode(),
        },
        close_behavior: match settings.close_behavior.as_str() {
            "background" | "quit" => settings.close_behavior,
            _ => default_close_behavior(),
        },
        backup_dir_name: normalize_backup_dir_name(&settings.backup_dir_name),
        compression: normalize_compression(settings.compression),
        tinypng_keys: normalize_tinypng_keys(settings.tinypng_keys),
    }
}

fn normalize_compression(settings: CompressionSettings) -> CompressionSettings {
    CompressionSettings {
        image: normalize_image(settings.image),
        audio: AudioCompressionSettings {
            recursive_scan: settings.audio.recursive_scan,
            mp3: normalize_lossy(
                settings.audio.mp3,
                &["48k", "64k", "96k", "128k", "192k"],
                default_mp3(),
            ),
            ogg: normalize_lossy(
                settings.audio.ogg,
                &["64k", "96k", "128k", "160k", "192k"],
                default_ogg(),
            ),
            wav: normalize_wav(settings.audio.wav),
        },
    }
}

fn normalize_image(settings: ImageCompressionSettings) -> ImageCompressionSettings {
    let min_quality = settings.local.png.min_quality.min(100);
    let max_quality = settings.local.png.max_quality.min(100);
    ImageCompressionSettings {
        recursive_scan: settings.recursive_scan,
        engine: match settings.engine.as_str() {
            "auto" | "local" | "tinify" => settings.engine,
            _ => default_image_engine(),
        },
        local: LocalImageSettings {
            png: LocalPngSettings {
                mode: normalize_loss_mode(settings.local.png.mode),
                min_quality: min_quality.min(max_quality),
                max_quality: max_quality.max(min_quality),
                max_colors: settings.local.png.max_colors.clamp(2, 256),
            },
            jpeg: LocalJpegSettings {
                quality: settings.local.jpeg.quality.min(100),
                progressive: settings.local.jpeg.progressive,
            },
            webp: LocalWebpSettings {
                mode: normalize_loss_mode(settings.local.webp.mode),
                quality: settings.local.webp.quality.min(100),
            },
            avif: LocalAvifSettings {
                quality: settings.local.avif.quality.min(100),
                speed: settings.local.avif.speed.clamp(1, 10),
            },
        },
    }
}

fn normalize_loss_mode(mode: String) -> String {
    match mode.as_str() {
        "lossy" | "lossless" => mode,
        _ => "lossy".into(),
    }
}

fn normalize_lossy(
    settings: LossyAudioSettings,
    bitrates: &[&str],
    fallback: LossyAudioSettings,
) -> LossyAudioSettings {
    LossyAudioSettings {
        bitrate: if bitrates.contains(&settings.bitrate.as_str()) {
            settings.bitrate
        } else {
            fallback.bitrate
        },
        sample_rate: normalize_sample_rate(settings.sample_rate, fallback.sample_rate),
        channels: normalize_channels(settings.channels, fallback.channels),
    }
}

fn normalize_wav(settings: WavAudioSettings) -> WavAudioSettings {
    let fallback = default_wav();
    WavAudioSettings {
        sample_rate: normalize_sample_rate(settings.sample_rate, fallback.sample_rate),
        channels: normalize_channels(settings.channels, fallback.channels),
    }
}

fn normalize_sample_rate(value: u32, fallback: u32) -> u32 {
    if [16000, 22050, 32000, 44100, 48000].contains(&value) {
        value
    } else {
        fallback
    }
}
fn normalize_channels(value: u8, fallback: u8) -> u8 {
    if value == 1 || value == 2 {
        value
    } else {
        fallback
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
    keys
}
pub fn persist_settings(path: &Path, settings: &AppSettings) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
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
