mod models;
mod platform;
mod settings;

use models::*;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::UNIX_EPOCH,
};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    window::Color,
    AppHandle, Emitter, Manager, State, WindowEvent,
};

use platform::{
    create_app_menu, create_status_bar, open_external, open_in_finder, quit_from_setting,
    show_main_window,
};
use settings::{
    current_backup_dir_name, is_valid_backup_dir_name, load_settings, normalize_settings,
    normalize_tinypng_keys, persist_settings, should_hide_instead_of_quit, AppSettings,
    SettingsState, StoredTinypngKey, DEFAULT_BACKUP_DIR_NAME,
};

#[derive(Default)]
struct TaskState {
    stop_image: AtomicBool,
    stop_audio: AtomicBool,
}

type AppResult<T> = Result<T, String>;

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_app_settings(state: State<'_, SettingsState>) -> AppResult<AppSettings> {
    state
        .value
        .lock()
        .map(|settings| settings.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_app_settings(
    state: State<'_, SettingsState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let mut normalized = normalize_settings(settings);
    let mut current = state.value.lock().map_err(|e| e.to_string())?;
    normalized.tinypng_keys = current.tinypng_keys.clone();
    persist_settings(&state.config_path, &normalized)?;
    *current = normalized.clone();
    Ok(normalized)
}

#[tauri::command]
fn get_tinypng_keys(state: State<'_, SettingsState>) -> AppResult<Vec<StoredTinypngKey>> {
    state
        .value
        .lock()
        .map(|settings| settings.tinypng_keys.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_tinypng_keys(
    state: State<'_, SettingsState>,
    keys: Vec<StoredTinypngKey>,
) -> AppResult<Vec<StoredTinypngKey>> {
    let mut current = state.value.lock().map_err(|e| e.to_string())?;
    current.tinypng_keys = normalize_tinypng_keys(keys);
    persist_settings(&state.config_path, &current)?;
    Ok(current.tinypng_keys.clone())
}

#[tauri::command]
fn sync_window_theme(app: AppHandle, mode: String) -> AppResult<()> {
    let color = match mode.as_str() {
        "dark" => Color(17, 17, 17, 255),
        _ => Color(251, 251, 251, 255),
    };

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_background_color(Some(color))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn check_tinypng_key(api_key: String) -> AppResult<KeyCheckResult> {
    const TINY_PNG: &[u8] = &[
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80,
        15, 0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.tinify.com/shrink")
        .basic_auth("api", Some(api_key))
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(TINY_PNG.to_vec())
        .send()
        .await
        .map_err(|e| format!("网络错误：{}", e))?;

    let status = response.status().as_u16();
    let compression_count = header_count(response.headers());

    match status {
        200 | 201 => Ok(KeyCheckResult {
            valid: true,
            compression_count: Some(compression_count.unwrap_or(0)),
            remaining: Some(500 - compression_count.unwrap_or(0) as i32),
            error: None,
        }),
        401 => Ok(KeyCheckResult {
            valid: false,
            compression_count: None,
            remaining: None,
            error: Some("API Key 无效".into()),
        }),
        429 => Ok(KeyCheckResult {
            valid: true,
            compression_count: Some(compression_count.unwrap_or(500)),
            remaining: Some(0),
            error: Some("当月已达上限".into()),
        }),
        _ => Ok(KeyCheckResult {
            valid: false,
            compression_count: None,
            remaining: None,
            error: Some(format!("网络错误：HTTP {}", status)),
        }),
    }
}

#[tauri::command]
fn stop_image_compression(state: State<'_, TaskState>) {
    state.stop_image.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn stop_audio_compression(state: State<'_, TaskState>) {
    state.stop_audio.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn get_backup_status(
    state: State<'_, SettingsState>,
    payload: BackupStatusPayload,
) -> BackupStatus {
    let backup_dir_name = current_backup_dir_name(&state);
    backup_status(
        Path::new(&payload.original_path),
        payload.backup_path.as_deref().map(Path::new),
        &backup_dir_name,
    )
}

#[tauri::command]
fn get_file_metadata(app: AppHandle, file_path: String) -> FileMetadata {
    file_metadata(Path::new(&file_path), Some(&app), true)
}

#[tauri::command]
fn compare_files(app: AppHandle, payload: ComparePayload) -> CompareResult {
    compare_file_pair(
        &app,
        Path::new(&payload.left_path),
        Path::new(&payload.right_path),
    )
}

#[tauri::command]
async fn compress_image(
    app: AppHandle,
    state: State<'_, TaskState>,
    settings: State<'_, SettingsState>,
    payload: ImagePayload,
) -> AppResult<()> {
    state.stop_image.store(false, Ordering::SeqCst);
    let recursive = payload.recursive.unwrap_or(true);
    let backup_dir_name = current_backup_dir_name(&settings);
    let mut files = Vec::new();
    for p in &payload.paths {
        let path = Path::new(p);
        if path.is_dir() {
            collect_files(
                path,
                &["png", "jpg", "jpeg"],
                recursive,
                &backup_dir_name,
                &mut files,
            );
        } else if path.exists() {
            files.push(path.to_path_buf());
        }
    }

    app.emit("compress:image:total", files.len())
        .map_err(|e| e.to_string())?;

    let mut processed = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut saved_total = 0u64;
    let mut exhausted_keys: Vec<String> = Vec::new();
    let mut all_keys_exhausted = false;

    for (idx, file) in files.iter().enumerate() {
        if state.stop_image.load(Ordering::SeqCst) {
            emit_paused(&app, &files[idx..])?;
            return Ok(());
        }

        let backup_path = backup_file(file, &backup_dir_name);
        let mut key = pick_key(&payload.api_keys, &exhausted_keys);
        if key.is_none() {
            emit_paused(&app, &files[idx..])?;
            all_keys_exhausted = true;
            break;
        }

        let mut done = false;
        while !done {
            if state.stop_image.load(Ordering::SeqCst) {
                emit_paused(&app, &files[idx..])?;
                return Ok(());
            }
            let current_key = match &key {
                Some(k) => k.clone(),
                None => break,
            };

            match compress_image_file(file, &current_key).await {
                Ok(result) => {
                    app.emit(
                        "compress:image:keycount",
                        KeyCount {
                            key: current_key,
                            compression_count: result.compression_count,
                        },
                    )
                    .map_err(|e| e.to_string())?;

                    if result.success {
                        processed += 1;
                        saved_total += result.saved_bytes.unwrap_or(0);
                        app.emit(
                            "compress:image:progress",
                            ProgressItem::success(file, backup_path.as_deref(), &result),
                        )
                        .map_err(|e| e.to_string())?;
                    } else {
                        skipped += 1;
                        app.emit(
                            "compress:image:progress",
                            ProgressItem::skipped(file, backup_path.as_deref(), &result),
                        )
                        .map_err(|e| e.to_string())?;
                    }
                    done = true;
                }
                Err(err) if err.status == Some(429) => {
                    exhausted_keys.push(current_key.clone());
                    app.emit(
                        "compress:image:keycount",
                        KeyCount {
                            key: current_key,
                            compression_count: err.compression_count.unwrap_or(500),
                        },
                    )
                    .map_err(|e| e.to_string())?;
                    key = pick_key(&payload.api_keys, &exhausted_keys);
                    if key.is_none() {
                        emit_paused(&app, &files[idx..])?;
                        all_keys_exhausted = true;
                        done = true;
                    }
                }
                Err(err) => {
                    failed += 1;
                    app.emit(
                        "compress:image:progress",
                        ProgressItem::error(file, backup_path.as_deref(), &err.message),
                    )
                    .map_err(|e| e.to_string())?;
                    done = true;
                }
            }
        }
        if all_keys_exhausted {
            break;
        }
    }

    if !all_keys_exhausted {
        app.emit(
            "compress:image:done",
            Stats {
                total: files.len(),
                processed,
                skipped,
                failed,
                saved_bytes: format_size(saved_total),
            },
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn compress_audio(
    app: AppHandle,
    state: State<'_, TaskState>,
    settings: State<'_, SettingsState>,
    payload: AudioPayload,
) -> AppResult<()> {
    state.stop_audio.store(false, Ordering::SeqCst);
    let recursive = payload.recursive.unwrap_or(true);
    let backup_dir_name = current_backup_dir_name(&settings);
    let requested_format = normalize_audio_request(&payload.format);
    let exts: &[&str] = if requested_format == "mixed" {
        &["mp3", "ogg", "wav"]
    } else {
        std::slice::from_ref(&requested_format)
    };
    let mut files = Vec::new();
    for p in &payload.paths {
        let path = Path::new(p);
        if path.is_dir() {
            collect_files(path, exts, recursive, &backup_dir_name, &mut files);
        } else if path.exists() {
            files.push(path.to_path_buf());
        }
    }

    app.emit("compress:audio:total", files.len())
        .map_err(|e| e.to_string())?;

    let ffmpeg = find_ffmpeg(&app);
    let mut processed = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut saved_total = 0u64;

    for (idx, file) in files.iter().enumerate() {
        if state.stop_audio.load(Ordering::SeqCst) {
            emit_audio_paused(&app, &files[idx..])?;
            return Ok(());
        }

        let actual_format = audio_format_for_request(file, requested_format);
        let Some(actual_format) = actual_format else {
            skipped += 1;
            let result = skipped_audio_result(file, "不支持的音频格式，已跳过");
            app.emit(
                "compress:audio:progress",
                ProgressItem::skipped(file, None, &result),
            )
            .map_err(|e| e.to_string())?;
            continue;
        };

        let backup_path = backup_file(file, &backup_dir_name);
        let file_for_task = file.clone();
        let format_for_task = actual_format.to_string();
        let ffmpeg_for_task = ffmpeg.clone();
        let result = tokio::task::spawn_blocking(move || {
            compress_audio_file(&file_for_task, &format_for_task, &ffmpeg_for_task)
        })
        .await
        .map_err(|e| e.to_string())?;

        match result {
            Ok(result) => {
                if result.success {
                    processed += 1;
                    saved_total += result.saved_bytes.unwrap_or(0);
                    app.emit(
                        "compress:audio:progress",
                        ProgressItem::success(file, backup_path.as_deref(), &result),
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    skipped += 1;
                    app.emit(
                        "compress:audio:progress",
                        ProgressItem::skipped(file, backup_path.as_deref(), &result),
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            Err(error) => {
                failed += 1;
                app.emit(
                    "compress:audio:progress",
                    ProgressItem::error(file, backup_path.as_deref(), &error),
                )
                .map_err(|e| e.to_string())?;
            }
        }

        if state.stop_audio.load(Ordering::SeqCst) {
            emit_audio_paused(&app, &files[idx + 1..])?;
            return Ok(());
        }
    }

    app.emit(
        "compress:audio:done",
        Stats {
            total: files.len(),
            processed,
            skipped,
            failed,
            saved_bytes: format_size(saved_total),
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn restore_file(payload: RestorePayload) -> AppResult<()> {
    fs::copy(payload.backup_path, payload.original_path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_backup_file(payload: DeleteBackupPayload) -> AppResult<()> {
    delete_backup_for_original(
        Path::new(&payload.original_path),
        Path::new(&payload.backup_path),
    )
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let settings = load_settings(app.handle());
            app.manage(SettingsState {
                config_path: settings.0,
                value: Mutex::new(settings.1),
            });
            create_status_bar(app.handle())?;
            Ok(())
        })
        .menu(create_app_menu)
        .manage(TaskState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_app_settings,
            update_app_settings,
            get_tinypng_keys,
            update_tinypng_keys,
            sync_window_theme,
            check_tinypng_key,
            get_backup_status,
            get_file_metadata,
            compare_files,
            compress_image,
            stop_image_compression,
            compress_audio,
            stop_audio_compression,
            restore_file,
            delete_backup_file,
            open_in_finder,
            open_external,
        ])
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if should_hide_instead_of_quit(window.app_handle()) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => {
                show_main_window(app);
                let _ = app.emit("app:navigate-settings", ());
            }
            "app_quit" => quit_from_setting(app),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

impl ProgressItem {
    fn success(file: &Path, backup_path: Option<&str>, result: &CompressionResult) -> Self {
        Self {
            file: file.to_string_lossy().to_string(),
            backup_path: backup_path.map(str::to_string),
            format: result.format.clone(),
            status: "success".into(),
            input_size: Some(format_size(result.input_size)),
            output_size: Some(format_size(result.output_size)),
            input_bytes: Some(result.input_size),
            output_bytes: Some(result.output_size),
            saved: result.saved_bytes.map(format_size),
            reason: None,
            error: None,
        }
    }

    fn skipped(file: &Path, backup_path: Option<&str>, result: &CompressionResult) -> Self {
        Self {
            file: file.to_string_lossy().to_string(),
            backup_path: backup_path.map(str::to_string),
            format: result.format.clone(),
            status: "skipped".into(),
            input_size: Some(format_size(result.input_size)),
            output_size: Some(format_size(result.output_size)),
            input_bytes: Some(result.input_size),
            output_bytes: Some(result.output_size),
            saved: None,
            reason: result.reason.clone(),
            error: None,
        }
    }

    fn error(file: &Path, backup_path: Option<&str>, error: &str) -> Self {
        Self {
            file: file.to_string_lossy().to_string(),
            backup_path: backup_path.map(str::to_string),
            format: audio_format_from_path(file).map(str::to_string),
            status: "error".into(),
            input_size: None,
            output_size: None,
            input_bytes: None,
            output_bytes: None,
            saved: None,
            reason: None,
            error: Some(error.to_string()),
        }
    }
}

fn collect_files(
    dir: &Path,
    exts: &[&str],
    recursive: bool,
    backup_dir_name: &str,
    results: &mut Vec<PathBuf>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| {
                name == DEFAULT_BACKUP_DIR_NAME || name == std::ffi::OsStr::new(backup_dir_name)
            }) {
                continue;
            }
            if recursive {
                collect_files(&path, exts, recursive, backup_dir_name, results);
            }
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| exts.iter().any(|allowed| allowed.eq_ignore_ascii_case(e)))
            .unwrap_or(false)
        {
            results.push(path);
        }
    }
}

fn normalize_audio_request(format: &str) -> &str {
    match format {
        "mixed" | "mp3" | "ogg" | "wav" => format,
        _ => "mixed",
    }
}

fn audio_format_from_path(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("mp3") => Some("mp3"),
        Some(ext) if ext.eq_ignore_ascii_case("ogg") => Some("ogg"),
        Some(ext) if ext.eq_ignore_ascii_case("wav") => Some("wav"),
        _ => None,
    }
}

fn audio_format_for_request<'a>(path: &Path, requested: &'a str) -> Option<&'a str> {
    let actual = audio_format_from_path(path)?;
    if requested == "mixed" || requested == actual {
        Some(actual)
    } else {
        None
    }
}

fn skipped_audio_result(file_path: &Path, reason: &str) -> CompressionResult {
    let original_size = fs::metadata(file_path).map(|meta| meta.len()).unwrap_or(0);
    CompressionResult {
        success: false,
        format: audio_format_from_path(file_path).map(str::to_string),
        input_size: original_size,
        output_size: original_size,
        saved_bytes: None,
        reason: Some(reason.to_string()),
        compression_count: 0,
    }
}

fn backup_file(file_path: &Path, backup_dir_name: &str) -> Option<String> {
    let dir = file_path.parent()?;
    let name = file_path.file_name()?;
    let backup_dir = dir.join(backup_dir_name);
    fs::create_dir_all(&backup_dir).ok()?;
    let backup_path = backup_dir.join(name);
    if !backup_path.exists() {
        fs::copy(file_path, &backup_path).ok()?;
    }
    Some(backup_path.to_string_lossy().to_string())
}

fn delete_backup_for_original(original: &Path, backup: &Path) -> AppResult<()> {
    let original_name = original
        .file_name()
        .ok_or_else(|| "原文件路径无效".to_string())?;
    if backup.file_name() != Some(original_name) {
        return Err("备份文件名必须与原文件名一致".into());
    }

    let original_parent = original
        .parent()
        .ok_or_else(|| "原文件路径无效".to_string())?;
    let backup_parent = backup
        .parent()
        .ok_or_else(|| "备份路径必须位于备份目录内".to_string())?;
    let backup_grandparent = backup_parent
        .parent()
        .ok_or_else(|| "备份路径必须位于原文件同级目录内".to_string())?;

    let original_parent = fs::canonicalize(original_parent).map_err(|e| e.to_string())?;
    let backup_grandparent = fs::canonicalize(backup_grandparent).map_err(|e| e.to_string())?;
    if original_parent != backup_grandparent {
        return Err("只能删除原文件同级备份目录内的备份".into());
    }
    let backup_dir_name = backup_parent
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "备份目录名无效".to_string())?;
    if !is_valid_backup_dir_name(backup_dir_name) {
        return Err("备份目录名无效".into());
    }

    match fs::remove_file(backup) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn format_size(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".into();
    }
    let sizes = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut idx = 0usize;
    while value >= 1024.0 && idx < sizes.len() - 1 {
        value /= 1024.0;
        idx += 1;
    }
    let formatted = format!("{:.2}", value)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    format!("{} {}", formatted, sizes[idx])
}

fn header_count(headers: &reqwest::header::HeaderMap) -> Option<u32> {
    headers
        .get("compression-count")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u32>().ok())
}

fn pick_key(keys: &[String], exhausted: &[String]) -> Option<String> {
    keys.iter()
        .map(|k| k.trim())
        .find(|k| !k.is_empty() && !exhausted.iter().any(|e| e == *k))
        .map(str::to_string)
}

fn emit_paused(app: &AppHandle, remaining: &[PathBuf]) -> AppResult<()> {
    app.emit(
        "compress:image:paused",
        PausedPayload {
            remaining: remaining
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
        },
    )
    .map_err(|e| e.to_string())
}

fn emit_audio_paused(app: &AppHandle, remaining: &[PathBuf]) -> AppResult<()> {
    app.emit(
        "compress:audio:paused",
        PausedPayload {
            remaining: remaining
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
        },
    )
    .map_err(|e| e.to_string())
}

fn backup_status(
    original: &Path,
    backup_override: Option<&Path>,
    backup_dir_name: &str,
) -> BackupStatus {
    let backup_path = backup_override
        .map(Path::to_path_buf)
        .or_else(|| expected_backup_path(original, backup_dir_name));
    let original_meta = fs::metadata(original).ok();
    let backup_meta = backup_path
        .as_ref()
        .and_then(|path| fs::metadata(path).ok());

    BackupStatus {
        original_path: original.to_string_lossy().to_string(),
        backup_path: backup_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        original_exists: original_meta.is_some(),
        backup_exists: backup_meta.is_some(),
        original_size: original_meta.as_ref().map(|meta| format_size(meta.len())),
        backup_size: backup_meta.as_ref().map(|meta| format_size(meta.len())),
        original_bytes: original_meta.as_ref().map(|meta| meta.len()),
        backup_bytes: backup_meta.as_ref().map(|meta| meta.len()),
        original_modified: original_meta.as_ref().and_then(modified_secs),
        backup_modified: backup_meta.as_ref().and_then(modified_secs),
    }
}

fn expected_backup_path(file_path: &Path, backup_dir_name: &str) -> Option<PathBuf> {
    Some(
        file_path
            .parent()?
            .join(backup_dir_name)
            .join(file_path.file_name()?),
    )
}

fn modified_secs(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
}

fn file_metadata(path: &Path, app: Option<&AppHandle>, include_hash: bool) -> FileMetadata {
    let metadata = fs::metadata(path).ok();
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());
    let kind = file_kind(extension.as_deref());

    FileMetadata {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string_lossy().to_string()),
        extension,
        kind: kind.to_string(),
        exists: metadata.is_some(),
        size: metadata.as_ref().map(|meta| format_size(meta.len())),
        bytes: metadata.as_ref().map(|meta| meta.len()),
        modified: metadata.as_ref().and_then(modified_secs),
        sha256: if include_hash && metadata.is_some() {
            sha256_file(path).ok()
        } else {
            None
        },
        image: if kind == "image" {
            image_dimensions(path).map(|(width, height)| ImageMetadata {
                width: Some(width),
                height: Some(height),
            })
        } else {
            None
        },
        audio: if kind == "audio" {
            app.map(|handle| audio_metadata(path, &find_ffmpeg(handle)))
        } else {
            None
        },
    }
}

fn compare_file_pair(app: &AppHandle, left: &Path, right: &Path) -> CompareResult {
    let left_meta = file_metadata(left, Some(app), true);
    let right_meta = file_metadata(right, Some(app), true);
    let same_hash = left_meta
        .sha256
        .as_ref()
        .zip(right_meta.sha256.as_ref())
        .map(|(left_hash, right_hash)| left_hash == right_hash);
    let size_delta = left_meta
        .bytes
        .zip(right_meta.bytes)
        .map(|(left_bytes, right_bytes)| right_bytes as i64 - left_bytes as i64);
    let text_diff = if left_meta.kind == "text" && right_meta.kind == "text" {
        build_text_diff(left, right).ok()
    } else {
        None
    };

    CompareResult {
        left: left_meta,
        right: right_meta,
        same_hash,
        size_delta,
        text_diff,
    }
}

fn file_kind(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or_default() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" => "image",
        "mp3" | "ogg" | "wav" | "flac" | "m4a" | "aac" => "audio",
        "txt" | "json" | "md" | "css" | "js" | "jsx" | "ts" | "tsx" | "html" | "xml" | "rs"
        | "toml" | "yaml" | "yml" => "text",
        _ => "binary",
    }
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 16 * 1024];

    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn image_dimensions(path: &Path) -> Option<(u32, u32)> {
    let bytes = fs::read(path).ok()?;
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
        let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
        return Some((width, height));
    }
    if bytes.len() >= 10 && bytes.starts_with(b"GIF") {
        let width = u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32;
        let height = u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32;
        return Some((width, height));
    }
    jpeg_dimensions(&bytes)
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }
    let mut index = 2usize;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        if marker == 0xc0 || marker == 0xc2 {
            let height = u16::from_be_bytes(bytes[index + 5..index + 7].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[index + 7..index + 9].try_into().ok()?) as u32;
            return Some((width, height));
        }
        let segment_len = u16::from_be_bytes(bytes[index + 2..index + 4].try_into().ok()?) as usize;
        if segment_len < 2 {
            return None;
        }
        index += 2 + segment_len;
    }
    None
}

fn audio_metadata(path: &Path, ffmpeg: &Path) -> AudioMetadata {
    let output = Command::new(ffmpeg).arg("-i").arg(path).output();
    let text = output
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stderr).to_string())
        .unwrap_or_default();
    let audio_line = text.lines().find(|line| line.contains("Audio:"));

    AudioMetadata {
        duration: parse_duration(&text),
        codec: audio_line.and_then(|line| {
            after_audio(line).and_then(|value| value.split(',').next().map(trim_string))
        }),
        sample_rate: audio_line.and_then(|line| pick_segment(line, "Hz")),
        channels: audio_line.and_then(parse_channels),
        bitrate: audio_line.and_then(|line| pick_segment(line, "kb/s")),
    }
}

fn after_audio(line: &str) -> Option<&str> {
    line.split_once("Audio:").map(|(_, value)| value.trim())
}

fn trim_string(value: &str) -> String {
    value.trim().to_string()
}

fn parse_duration(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.split_once("Duration:"))
        .and_then(|(_, rest)| rest.split(',').next())
        .map(trim_string)
}

fn pick_segment(line: &str, needle: &str) -> Option<String> {
    line.split(',')
        .map(str::trim)
        .find(|part| part.contains(needle))
        .map(str::to_string)
}

fn parse_channels(line: &str) -> Option<String> {
    line.split(',')
        .map(str::trim)
        .find(|part| matches!(*part, "mono" | "stereo") || part.ends_with("channels"))
        .map(str::to_string)
}

fn build_text_diff(left: &Path, right: &Path) -> AppResult<Vec<TextDiffLine>> {
    let left_text = fs::read_to_string(left).map_err(|e| e.to_string())?;
    let right_text = fs::read_to_string(right).map_err(|e| e.to_string())?;
    let left_lines: Vec<&str> = left_text.lines().collect();
    let right_lines: Vec<&str> = right_text.lines().collect();
    let max = left_lines.len().max(right_lines.len());
    let mut diff = Vec::new();

    for index in 0..max {
        let left_line = left_lines.get(index).copied();
        let right_line = right_lines.get(index).copied();
        let kind = match (left_line, right_line) {
            (Some(left_value), Some(right_value)) if left_value == right_value => "same",
            (Some(_), Some(_)) => "changed",
            (Some(_), None) => "removed",
            (None, Some(_)) => "added",
            (None, None) => "same",
        };
        diff.push(TextDiffLine {
            kind: kind.to_string(),
            left: left_line.map(str::to_string),
            right: right_line.map(str::to_string),
            line: index + 1,
        });
    }

    Ok(diff)
}

async fn compress_image_file(
    file_path: &Path,
    api_key: &str,
) -> Result<CompressionResult, TinifyError> {
    let file_data = fs::read(file_path).map_err(|e| TinifyError {
        status: None,
        compression_count: None,
        message: e.to_string(),
    })?;
    let client = reqwest::Client::new();
    let upload = client
        .post("https://api.tinify.com/shrink")
        .basic_auth("api", Some(api_key.to_string()))
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(file_data)
        .send()
        .await
        .map_err(|e| TinifyError {
            status: None,
            compression_count: None,
            message: e.to_string(),
        })?;

    let status = upload.status();
    let compression_count = header_count(upload.headers()).unwrap_or(0);
    if !status.is_success() {
        return Err(TinifyError {
            status: Some(status.as_u16()),
            compression_count: Some(compression_count),
            message: format!("TinyPNG HTTP {}", status.as_u16()),
        });
    }

    let shrink: TinifyShrinkResponse = upload.json().await.map_err(|e| TinifyError {
        status: None,
        compression_count: Some(compression_count),
        message: e.to_string(),
    })?;

    if shrink.output.size < shrink.input.size {
        let bytes = client
            .get(&shrink.output.url)
            .basic_auth("api", Some(api_key.to_string()))
            .send()
            .await
            .map_err(|e| TinifyError {
                status: None,
                compression_count: Some(compression_count),
                message: e.to_string(),
            })?
            .bytes()
            .await
            .map_err(|e| TinifyError {
                status: None,
                compression_count: Some(compression_count),
                message: e.to_string(),
            })?;
        fs::write(file_path, bytes).map_err(|e| TinifyError {
            status: None,
            compression_count: Some(compression_count),
            message: e.to_string(),
        })?;
        Ok(CompressionResult {
            success: true,
            format: None,
            input_size: shrink.input.size,
            output_size: shrink.output.size,
            saved_bytes: Some(shrink.input.size - shrink.output.size),
            reason: None,
            compression_count,
        })
    } else {
        Ok(CompressionResult {
            success: false,
            format: None,
            input_size: shrink.input.size,
            output_size: shrink.output.size,
            saved_bytes: None,
            reason: Some("压缩后无体积减小，已跳过".into()),
            compression_count,
        })
    }
}

fn compress_audio_file(
    file_path: &Path,
    format: &str,
    ffmpeg: &Path,
) -> Result<CompressionResult, String> {
    let original_size = fs::metadata(file_path).map_err(|e| e.to_string())?.len();
    let ext = match format {
        "mp3" => ".mp3",
        "ogg" => ".ogg",
        "wav" => ".wav",
        _ => ".tmp",
    };
    let temp_file = PathBuf::from(format!("{}.tmp{}", file_path.to_string_lossy(), ext));
    let temp = temp_file.to_string_lossy().to_string();
    let input = file_path.to_string_lossy().to_string();

    let mut args: Vec<String> = match format {
        "mp3" => [
            "-i", &input, "-b:a", "64k", "-acodec", "mp3", "-ar", "44100", "-ac", "1", &temp, "-y",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
        "ogg" => [
            "-i",
            &input,
            "-c:a",
            "libvorbis",
            "-b:a",
            "96k",
            "-ar",
            "44100",
            &temp,
            "-y",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
        _ => [
            "-i",
            &input,
            "-acodec",
            "pcm_s16le",
            "-ar",
            "22050",
            "-ac",
            "1",
            &temp,
            "-y",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
    };

    let output = Command::new(ffmpeg)
        .args(args.drain(..))
        .output()
        .map_err(|e| format!("ffmpeg 启动失败：{}", e))?;

    if !output.status.success()
        || !temp_file.exists()
        || fs::metadata(&temp_file).map(|m| m.len()).unwrap_or(0) == 0
    {
        let _ = fs::remove_file(&temp_file);
        return Err(format!(
            "ffmpeg failed with code {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let compressed_size = fs::metadata(&temp_file).map_err(|e| e.to_string())?.len();
    if compressed_size < original_size {
        fs::copy(&temp_file, file_path).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&temp_file);
        Ok(CompressionResult {
            success: true,
            format: Some(format.to_string()),
            input_size: original_size,
            output_size: compressed_size,
            saved_bytes: Some(original_size - compressed_size),
            reason: None,
            compression_count: 0,
        })
    } else {
        let _ = fs::remove_file(&temp_file);
        Ok(CompressionResult {
            success: false,
            format: Some(format.to_string()),
            input_size: original_size,
            output_size: compressed_size,
            saved_bytes: None,
            reason: Some("压缩后无体积减小，已跳过".into()),
            compression_count: 0,
        })
    }
}

fn find_ffmpeg(app: &AppHandle) -> PathBuf {
    if let Ok(path) = std::env::var("FFMPEG_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return path;
        }
    }

    let binary = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("ffmpeg"));
        candidates.push(resource_dir.join("node_modules/ffmpeg-static").join(binary));
        candidates.push(
            resource_dir
                .join("_up_/node_modules/ffmpeg-static")
                .join(binary),
        );
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("node_modules/ffmpeg-static").join(binary));
        candidates.push(
            current_dir
                .join("..")
                .join("node_modules/ffmpeg-static")
                .join(binary),
        );
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../node_modules/ffmpeg-static")
            .join(binary),
    );

    candidates
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from("ffmpeg"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn formats_file_sizes() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(1024 * 1024), "1 MB");
    }

    #[test]
    fn collects_files_and_skips_backup_dir() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("a.png"), b"x").unwrap();
        fs::write(root.join("b.txt"), b"x").unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("nested").join("c.JPG"), b"x").unwrap();
        fs::create_dir(root.join("_tiny_backup")).unwrap();
        fs::write(root.join("_tiny_backup").join("d.png"), b"x").unwrap();
        fs::create_dir(root.join("custom_backup")).unwrap();
        fs::write(root.join("custom_backup").join("e.png"), b"x").unwrap();

        let mut files = Vec::new();
        collect_files(root, &["png", "jpg"], true, "custom_backup", &mut files);
        let names: Vec<String> = files
            .iter()
            .filter_map(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string())
            .collect();

        assert!(names.contains(&"a.png".to_string()));
        assert!(names.contains(&"c.JPG".to_string()));
        assert!(!names.contains(&"d.png".to_string()));
        assert!(!names.contains(&"e.png".to_string()));
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn creates_backup_with_default_and_custom_dir_name() {
        let dir = tempdir().unwrap();
        let original = dir.path().join("a.png");
        fs::write(&original, b"original").unwrap();

        let default_backup = backup_file(&original, DEFAULT_BACKUP_DIR_NAME).unwrap();
        assert_eq!(
            PathBuf::from(default_backup),
            dir.path().join(DEFAULT_BACKUP_DIR_NAME).join("a.png")
        );

        let custom_backup = backup_file(&original, "custom_backup").unwrap();
        assert_eq!(
            PathBuf::from(custom_backup),
            dir.path().join("custom_backup").join("a.png")
        );
    }

    #[test]
    fn resolves_mixed_audio_formats_by_extension() {
        assert_eq!(normalize_audio_request("mixed"), "mixed");
        assert_eq!(normalize_audio_request("mp3"), "mp3");
        assert_eq!(normalize_audio_request("bad"), "mixed");
        assert_eq!(
            audio_format_for_request(Path::new("song.MP3"), "mixed"),
            Some("mp3")
        );
        assert_eq!(
            audio_format_for_request(Path::new("song.ogg"), "mixed"),
            Some("ogg")
        );
        assert_eq!(
            audio_format_for_request(Path::new("song.wav"), "wav"),
            Some("wav")
        );
        assert_eq!(audio_format_for_request(Path::new("song.wav"), "mp3"), None);
        assert_eq!(
            audio_format_for_request(Path::new("song.flac"), "mixed"),
            None
        );
    }

    #[test]
    fn picks_first_non_exhausted_key() {
        let keys = vec!["".into(), "a".into(), "b".into()];
        assert_eq!(pick_key(&keys, &[]), Some("a".into()));
        assert_eq!(pick_key(&keys, &["a".into()]), Some("b".into()));
        assert_eq!(pick_key(&keys, &["a".into(), "b".into()]), None);
    }

    #[test]
    fn reports_backup_status() {
        let dir = tempdir().unwrap();
        let original = dir.path().join("a.png");
        fs::write(&original, b"original").unwrap();
        let backup = expected_backup_path(&original, DEFAULT_BACKUP_DIR_NAME).unwrap();
        fs::create_dir_all(backup.parent().unwrap()).unwrap();
        fs::write(&backup, b"backup").unwrap();

        let status = backup_status(&original, None, DEFAULT_BACKUP_DIR_NAME);
        assert!(status.original_exists);
        assert!(status.backup_exists);
        assert_eq!(status.original_bytes, Some(8));
        assert_eq!(status.backup_bytes, Some(6));
    }

    #[test]
    fn deletes_only_matching_sibling_backup_file() {
        let dir = tempdir().unwrap();
        let original = dir.path().join("a.png");
        fs::write(&original, b"original").unwrap();
        let backup_dir = dir.path().join("custom_backup");
        fs::create_dir(&backup_dir).unwrap();
        let backup = backup_dir.join("a.png");
        fs::write(&backup, b"backup").unwrap();

        delete_backup_for_original(&original, &backup).unwrap();
        assert!(!backup.exists());

        fs::write(&backup, b"backup").unwrap();
        let wrong_name = backup_dir.join("b.png");
        fs::write(&wrong_name, b"backup").unwrap();
        assert!(delete_backup_for_original(&original, &wrong_name).is_err());
        assert!(wrong_name.exists());

        let other_dir = tempdir().unwrap();
        let other_backup_dir = other_dir.path().join("custom_backup");
        fs::create_dir(&other_backup_dir).unwrap();
        let other_backup = other_backup_dir.join("a.png");
        fs::write(&other_backup, b"backup").unwrap();
        assert!(delete_backup_for_original(&original, &other_backup).is_err());
        assert!(other_backup.exists());
    }

    #[test]
    fn hashes_files_with_sha256() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("a.txt");
        fs::write(&file, b"abc").unwrap();

        assert_eq!(
            sha256_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
