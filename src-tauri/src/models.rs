use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagePayload {
    pub paths: Vec<String>,
    pub api_keys: Vec<String>,
    pub recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioPayload {
    pub paths: Vec<String>,
    pub format: String,
    pub recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestorePayload {
    pub backup_path: String,
    pub original_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteBackupPayload {
    pub backup_path: String,
    pub original_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupStatusPayload {
    pub original_path: String,
    pub backup_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ComparePayload {
    pub left_path: String,
    pub right_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgressItem {
    pub file: String,
    pub backup_path: Option<String>,
    pub format: Option<String>,
    pub status: String,
    pub input_size: Option<String>,
    pub output_size: Option<String>,
    pub input_bytes: Option<u64>,
    pub output_bytes: Option<u64>,
    pub saved: Option<String>,
    pub reason: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stats {
    pub total: usize,
    pub processed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub saved_bytes: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyCount {
    pub key: String,
    pub compression_count: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PausedPayload {
    pub remaining: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupStatus {
    pub original_path: String,
    pub backup_path: Option<String>,
    pub original_exists: bool,
    pub backup_exists: bool,
    pub original_size: Option<String>,
    pub backup_size: Option<String>,
    pub original_bytes: Option<u64>,
    pub backup_bytes: Option<u64>,
    pub original_modified: Option<u64>,
    pub backup_modified: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageMetadata {
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioMetadata {
    pub duration: Option<String>,
    pub codec: Option<String>,
    pub sample_rate: Option<String>,
    pub channels: Option<String>,
    pub bitrate: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMetadata {
    pub path: String,
    pub name: String,
    pub extension: Option<String>,
    pub kind: String,
    pub exists: bool,
    pub size: Option<String>,
    pub bytes: Option<u64>,
    pub modified: Option<u64>,
    pub sha256: Option<String>,
    pub image: Option<ImageMetadata>,
    pub audio: Option<AudioMetadata>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextDiffLine {
    pub kind: String,
    pub left: Option<String>,
    pub right: Option<String>,
    pub line: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompareResult {
    pub left: FileMetadata,
    pub right: FileMetadata,
    pub same_hash: Option<bool>,
    pub size_delta: Option<i64>,
    pub text_diff: Option<Vec<TextDiffLine>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyCheckResult {
    pub valid: bool,
    pub compression_count: Option<u32>,
    pub remaining: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeHealth {
    pub app_version: String,
    pub ffmpeg_path: String,
    pub ffmpeg_exists: bool,
    pub ffmpeg_available: bool,
    pub backup_dir_name: String,
    pub tinypng_key_count: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TinifyShrinkResponse {
    pub input: TinifySize,
    pub output: TinifyOutput,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TinifySize {
    pub size: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct TinifyOutput {
    pub size: u64,
    pub url: String,
}

#[derive(Debug)]
pub(crate) struct TinifyError {
    pub status: Option<u16>,
    pub compression_count: Option<u32>,
    pub message: String,
}

#[derive(Debug)]
pub(crate) struct CompressionResult {
    pub success: bool,
    pub format: Option<String>,
    pub input_size: u64,
    pub output_size: u64,
    pub saved_bytes: Option<u64>,
    pub reason: Option<String>,
    pub compression_count: u32,
}
