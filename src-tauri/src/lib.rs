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
use serde::{Deserialize, Serialize};
use settings::{
    current_backup_dir_name, is_valid_backup_dir_name, load_settings, normalize_settings,
    normalize_tinypng_keys, persist_settings, should_hide_instead_of_quit, AppSettings,
    LocalImageSettings, SettingsState, StoredTinypngKey, DEFAULT_BACKUP_DIR_NAME,
};

#[derive(Default)]
struct TaskState {
    stop_image: AtomicBool,
    stop_audio: AtomicBool,
}

type AppResult<T> = Result<T, String>;

const TINY_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15, 0, 3,
    134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

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

#[derive(Debug, Deserialize, Serialize)]
struct ExportedSettings {
    format: String,
    version: u32,
    settings: AppSettings,
}

fn encode_exported_settings(settings: AppSettings) -> AppResult<String> {
    serde_json::to_string_pretty(&ExportedSettings {
        format: "tinypress-settings".into(),
        version: 1,
        settings,
    })
    .map_err(|e| e.to_string())
}

fn decode_exported_settings(raw: &str) -> AppResult<AppSettings> {
    let exported: ExportedSettings = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    if exported.format != "tinypress-settings" {
        return Err("不是 TinyPress 配置文件".into());
    }
    if exported.version != 1 {
        return Err(format!("不支持的配置文件版本：{}", exported.version));
    }
    Ok(normalize_settings(exported.settings))
}

#[tauri::command]
fn export_app_settings(state: State<'_, SettingsState>, target_path: String) -> AppResult<()> {
    let settings = state.value.lock().map_err(|e| e.to_string())?.clone();
    fs::write(target_path, encode_exported_settings(settings)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_app_settings(
    state: State<'_, SettingsState>,
    source_path: String,
) -> AppResult<AppSettings> {
    let raw = fs::read_to_string(source_path).map_err(|e| e.to_string())?;
    let normalized = decode_exported_settings(&raw)?;
    persist_settings(&state.config_path, &normalized)?;
    let mut current = state.value.lock().map_err(|e| e.to_string())?;
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
fn get_runtime_health(app: AppHandle, state: State<'_, SettingsState>) -> AppResult<RuntimeHealth> {
    let ffmpeg_path = find_ffmpeg(&app);
    let ffmpeg_exists = ffmpeg_path.exists();
    let ffmpeg_available = Command::new(&ffmpeg_path)
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let settings = state.value.lock().map_err(|e| e.to_string())?;

    Ok(RuntimeHealth {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        ffmpeg_path: ffmpeg_path.display().to_string(),
        ffmpeg_exists,
        ffmpeg_available,
        backup_dir_name: settings.backup_dir_name.clone(),
        tinypng_key_count: settings
            .tinypng_keys
            .iter()
            .filter(|key| !key.value.trim().is_empty())
            .count(),
    })
}

#[tauri::command]
async fn check_tinypng_key(api_key: String) -> AppResult<KeyCheckResult> {
    check_tinypng_key_with_endpoint(api_key, &tinify_endpoint()).await
}

async fn check_tinypng_key_with_endpoint(
    api_key: String,
    endpoint: &str,
) -> AppResult<KeyCheckResult> {
    let client = reqwest::Client::new();
    let response = client
        .post(endpoint)
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
    let engine = match payload.engine.as_str() {
        "local" | "tinify" => payload.engine.as_str(),
        _ => "auto",
    };
    let backup_dir_name = current_backup_dir_name(&settings);
    let mut files = Vec::new();
    for p in &payload.paths {
        let path = Path::new(p);
        if path.is_dir() {
            collect_files(
                path,
                &["png", "jpg", "jpeg", "webp", "avif"],
                recursive,
                &backup_dir_name,
                &mut files,
            );
        } else if path.exists() {
            files.push(path.to_path_buf());
        }
    }
    files.sort();
    files.dedup();

    app.emit("compress:image:total", files.len())
        .map_err(|e| e.to_string())?;

    let mut processed = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;
    let mut saved_total = 0u64;
    let mut exhausted_keys: Vec<String> = Vec::new();
    let mut force_local = engine == "local";
    let ffmpeg = find_ffmpeg(&app);

    for (idx, file) in files.iter().enumerate() {
        if state.stop_image.load(Ordering::SeqCst) {
            emit_paused(&app, &files[idx..])?;
            return Ok(());
        }

        let backup_path = backup_file(file, &backup_dir_name);
        if force_local
            || (engine == "auto" && pick_key(&payload.api_keys, &exhausted_keys).is_none())
        {
            force_local = true;
            match compress_local_image_file(file, &payload.local, &ffmpeg) {
                Ok(mut result) if result.success => {
                    if engine == "auto" {
                        result.warnings.push("自动选择已使用本地压缩".into());
                    }
                    processed += 1;
                    saved_total += result.saved_bytes.unwrap_or(0);
                    app.emit(
                        "compress:image:progress",
                        ProgressItem::success(file, backup_path.as_deref(), &result),
                    )
                    .map_err(|e| e.to_string())?;
                }
                Ok(mut result) => {
                    if engine == "auto" {
                        result.warnings.push("自动选择已使用本地压缩".into());
                    }
                    skipped += 1;
                    app.emit(
                        "compress:image:progress",
                        ProgressItem::skipped(file, backup_path.as_deref(), &result),
                    )
                    .map_err(|e| e.to_string())?;
                }
                Err(message) => {
                    failed += 1;
                    app.emit(
                        "compress:image:progress",
                        ProgressItem::error(file, backup_path.as_deref(), &message),
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            continue;
        }

        let mut key = pick_key(&payload.api_keys, &exhausted_keys);
        if key.is_none() {
            emit_paused(&app, &files[idx..])?;
            return Ok(());
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
                        if engine == "auto" {
                            force_local = true;
                            match compress_local_image_file(file, &payload.local, &ffmpeg) {
                                Ok(mut result) if result.success => {
                                    result
                                        .warnings
                                        .push("Tinify Key 已耗尽，已切换为本地压缩".into());
                                    processed += 1;
                                    saved_total += result.saved_bytes.unwrap_or(0);
                                    app.emit(
                                        "compress:image:progress",
                                        ProgressItem::success(
                                            file,
                                            backup_path.as_deref(),
                                            &result,
                                        ),
                                    )
                                    .map_err(|e| e.to_string())?;
                                }
                                Ok(mut result) => {
                                    result
                                        .warnings
                                        .push("Tinify Key 已耗尽，已切换为本地压缩".into());
                                    skipped += 1;
                                    app.emit(
                                        "compress:image:progress",
                                        ProgressItem::skipped(
                                            file,
                                            backup_path.as_deref(),
                                            &result,
                                        ),
                                    )
                                    .map_err(|e| e.to_string())?;
                                }
                                Err(message) => {
                                    failed += 1;
                                    app.emit(
                                        "compress:image:progress",
                                        ProgressItem::error(file, backup_path.as_deref(), &message),
                                    )
                                    .map_err(|e| e.to_string())?;
                                }
                            }
                            done = true;
                        } else {
                            emit_paused(&app, &files[idx..])?;
                            return Ok(());
                        }
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
    }

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
    let payload = normalize_audio_payload(payload);
    let recursive = payload.recursive.unwrap_or(true);
    let backup_dir_name = current_backup_dir_name(&settings);
    let exts = &["mp3", "ogg", "wav"];
    let mut files = Vec::new();
    for p in &payload.paths {
        let path = Path::new(p);
        if path.is_dir() {
            collect_files(path, exts, recursive, &backup_dir_name, &mut files);
        } else if path.exists() {
            files.push(path.to_path_buf());
        }
    }
    files.sort();
    files.dedup();

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

        let actual_format = audio_format_from_path(file);
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
        let mp3_for_task = payload.mp3.clone();
        let ogg_for_task = payload.ogg.clone();
        let wav_for_task = payload.wav.clone();
        let result = tokio::task::spawn_blocking(move || {
            compress_audio_file(
                &file_for_task,
                &format_for_task,
                &mp3_for_task,
                &ogg_for_task,
                &wav_for_task,
                &ffmpeg_for_task,
            )
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
            export_app_settings,
            import_app_settings,
            get_runtime_health,
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
            engine: result.engine.clone(),
            warnings: result.warnings.clone(),
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
            engine: result.engine.clone(),
            warnings: result.warnings.clone(),
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
            engine: None,
            warnings: Vec::new(),
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

fn audio_ffmpeg_args(
    format: &str,
    mp3: &LossyAudioPayload,
    ogg: &LossyAudioPayload,
    wav: &WavAudioPayload,
    input: &str,
    output: &str,
) -> Vec<String> {
    let values: Vec<String> = match format {
        "mp3" => vec![
            "-i".into(),
            input.into(),
            "-b:a".into(),
            mp3.bitrate.clone(),
            "-acodec".into(),
            "mp3".into(),
            "-ar".into(),
            mp3.sample_rate.to_string(),
            "-ac".into(),
            mp3.channels.to_string(),
            output.into(),
            "-y".into(),
        ],
        "ogg" => vec![
            "-i".into(),
            input.into(),
            "-c:a".into(),
            "libvorbis".into(),
            "-b:a".into(),
            ogg.bitrate.clone(),
            "-ar".into(),
            ogg.sample_rate.to_string(),
            "-ac".into(),
            ogg.channels.to_string(),
            output.into(),
            "-y".into(),
        ],
        _ => vec![
            "-i".into(),
            input.into(),
            "-acodec".into(),
            "pcm_s16le".into(),
            "-ar".into(),
            wav.sample_rate.to_string(),
            "-ac".into(),
            wav.channels.to_string(),
            output.into(),
            "-y".into(),
        ],
    };
    values
}

fn normalize_audio_payload(payload: AudioPayload) -> AudioPayload {
    AudioPayload {
        paths: payload.paths,
        recursive: payload.recursive,
        mp3: normalize_lossy_audio_payload(
            payload.mp3,
            &["48k", "64k", "96k", "128k", "192k"],
            LossyAudioPayload {
                bitrate: "96k".into(),
                sample_rate: 44100,
                channels: 2,
            },
        ),
        ogg: normalize_lossy_audio_payload(
            payload.ogg,
            &["64k", "96k", "128k", "160k", "192k"],
            LossyAudioPayload {
                bitrate: "96k".into(),
                sample_rate: 44100,
                channels: 2,
            },
        ),
        wav: WavAudioPayload {
            sample_rate: normalize_audio_sample_rate(payload.wav.sample_rate, 22050),
            channels: normalize_audio_channels(payload.wav.channels, 2),
        },
    }
}

fn normalize_lossy_audio_payload(
    payload: LossyAudioPayload,
    bitrates: &[&str],
    fallback: LossyAudioPayload,
) -> LossyAudioPayload {
    LossyAudioPayload {
        bitrate: if bitrates.contains(&payload.bitrate.as_str()) {
            payload.bitrate
        } else {
            fallback.bitrate
        },
        sample_rate: normalize_audio_sample_rate(payload.sample_rate, fallback.sample_rate),
        channels: normalize_audio_channels(payload.channels, fallback.channels),
    }
}

fn normalize_audio_sample_rate(value: u32, fallback: u32) -> u32 {
    if [16000, 22050, 32000, 44100, 48000].contains(&value) {
        value
    } else {
        fallback
    }
}

fn normalize_audio_channels(value: u8, fallback: u8) -> u8 {
    if value == 1 || value == 2 {
        value
    } else {
        fallback
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
        engine: None,
        warnings: Vec::new(),
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
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" => "image",
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
        .post(tinify_endpoint())
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
        let temp_path = PathBuf::from(format!("{}.tiny-tinify.tmp", file_path.to_string_lossy()));
        fs::write(&temp_path, bytes).map_err(|e| TinifyError {
            status: None,
            compression_count: Some(compression_count),
            message: e.to_string(),
        })?;
        replace_file_from_temp(&temp_path, file_path).map_err(|e| TinifyError {
            status: None,
            compression_count: Some(compression_count),
            message: e,
        })?;
        Ok(CompressionResult {
            success: true,
            format: None,
            input_size: shrink.input.size,
            output_size: shrink.output.size,
            saved_bytes: Some(shrink.input.size - shrink.output.size),
            reason: None,
            compression_count,
            engine: Some("tinify".into()),
            warnings: Vec::new(),
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
            engine: Some("tinify".into()),
            warnings: Vec::new(),
        })
    }
}

fn tinify_endpoint() -> String {
    std::env::var("TINYPRESS_TINIFY_ENDPOINT")
        .unwrap_or_else(|_| "https://api.tinify.com/shrink".into())
}

fn image_format_from_path(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("png") => Some("png"),
        Some(ext) if ext.eq_ignore_ascii_case("jpg") || ext.eq_ignore_ascii_case("jpeg") => {
            Some("jpeg")
        }
        Some(ext) if ext.eq_ignore_ascii_case("webp") => Some("webp"),
        Some(ext) if ext.eq_ignore_ascii_case("avif") => Some("avif"),
        _ => None,
    }
}

fn has_png_chunk(bytes: &[u8], chunk: &[u8; 4]) -> bool {
    bytes.windows(4).any(|window| window == chunk)
}

fn replace_if_smaller(
    file_path: &Path,
    output: Vec<u8>,
    format: &str,
    warnings: Vec<String>,
) -> AppResult<CompressionResult> {
    let original_size = fs::metadata(file_path).map_err(|e| e.to_string())?.len();
    let output_size = output.len() as u64;
    if output_size >= original_size {
        return Ok(CompressionResult {
            success: false,
            format: Some(format.into()),
            input_size: original_size,
            output_size,
            saved_bytes: None,
            reason: Some("压缩后无体积减小，已跳过".into()),
            compression_count: 0,
            engine: Some("local".into()),
            warnings,
        });
    }
    let temp_path = PathBuf::from(format!("{}.tiny-local.tmp", file_path.to_string_lossy()));
    fs::write(&temp_path, output).map_err(|e| e.to_string())?;
    replace_file_from_temp(&temp_path, file_path)?;
    Ok(CompressionResult {
        success: true,
        format: Some(format.into()),
        input_size: original_size,
        output_size,
        saved_bytes: Some(original_size - output_size),
        reason: None,
        compression_count: 0,
        engine: Some("local".into()),
        warnings,
    })
}

fn replace_file_from_temp(temp_path: &Path, file_path: &Path) -> AppResult<()> {
    if fs::rename(temp_path, file_path).is_ok() {
        return Ok(());
    }
    let result = fs::copy(temp_path, file_path)
        .map(|_| ())
        .map_err(|e| e.to_string());
    let _ = fs::remove_file(temp_path);
    result
}

fn optimize_png_file(
    file_path: &Path,
    settings: &LocalImageSettings,
) -> AppResult<CompressionResult> {
    let input = fs::read(file_path).map_err(|e| e.to_string())?;
    let mut warnings = if has_png_chunk(&input, b"acTL") {
        vec!["检测到 APNG：已保留动画并仅执行无损优化".into()]
    } else {
        Vec::new()
    };
    let encoded = if settings.png.mode == "lossless" || !warnings.is_empty() {
        input.clone()
    } else {
        warnings.push("PNG 有损量化会移除辅助元数据，请确认色彩显示".into());
        let bitmap = lodepng::decode32(&input).map_err(|e| e.to_string())?;
        let pixels = bitmap
            .buffer
            .iter()
            .map(|pixel| imagequant::RGBA::new(pixel.r, pixel.g, pixel.b, pixel.a))
            .collect::<Vec<_>>();
        let mut quantizer = imagequant::new();
        quantizer
            .set_quality(settings.png.min_quality, settings.png.max_quality)
            .map_err(|e| e.to_string())?;
        quantizer
            .set_max_colors(settings.png.max_colors as u32)
            .map_err(|e| e.to_string())?;
        let mut image = quantizer
            .new_image(pixels, bitmap.width, bitmap.height, 0.0)
            .map_err(|e| e.to_string())?;
        let mut result = quantizer.quantize(&mut image).map_err(|e| e.to_string())?;
        result.set_dithering_level(1.0).map_err(|e| e.to_string())?;
        let (palette, indexed) = result.remapped(&mut image).map_err(|e| e.to_string())?;
        let palette = palette
            .into_iter()
            .map(|color| lodepng::RGBA::new(color.r, color.g, color.b, color.a))
            .collect::<Vec<_>>();
        let mut encoder = lodepng::Encoder::new();
        encoder.set_palette(&palette).map_err(|e| e.to_string())?;
        encoder
            .encode(&indexed, bitmap.width, bitmap.height)
            .map_err(|e| e.to_string())?
    };
    let optimized = oxipng::optimize_from_memory(&encoded, &oxipng::Options::default())
        .map_err(|e| e.to_string())?;
    replace_if_smaller(file_path, optimized, "png", warnings)
}

fn optimize_jpeg_file(
    file_path: &Path,
    settings: &LocalImageSettings,
) -> AppResult<CompressionResult> {
    let image = image::ImageReader::open(file_path)
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?
        .to_rgb8();
    let (width, height) = image.dimensions();
    let encoded = mozjpeg_rs::Encoder::new(mozjpeg_rs::Preset::ProgressiveBalanced)
        .quality(settings.jpeg.quality)
        .progressive(settings.jpeg.progressive)
        .encode_rgb(image.as_raw(), width, height)
        .map_err(|e| e.to_string())?;
    replace_if_smaller(
        file_path,
        encoded,
        "jpeg",
        vec!["JPEG 本地重编码会移除 EXIF 和 ICC 元数据，请确认方向与色彩显示".into()],
    )
}

fn detect_hdr(file_path: &Path, ffmpeg: &Path) -> bool {
    Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-i")
        .arg(file_path)
        .output()
        .map(|output| {
            let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
            stderr.contains("bt2020")
                || stderr.contains("smpte2084")
                || stderr.contains("arib-std-b67")
        })
        .unwrap_or(false)
}

fn image_ffmpeg_args(
    format: &str,
    settings: &LocalImageSettings,
    input: &str,
    output: &str,
    hdr: bool,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        input.into(),
    ];
    if format == "avif" && hdr {
        args.extend(["-vf", "zscale=t=linear:npl=100,tonemap=tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"].map(str::to_string));
    }
    match format {
        "webp" => args.extend([
            "-frames:v".into(),
            "1".into(),
            "-c:v".into(),
            "libwebp".into(),
            "-quality".into(),
            settings.webp.quality.to_string(),
            "-lossless".into(),
            if settings.webp.mode == "lossless" {
                "1".into()
            } else {
                "0".into()
            },
        ]),
        _ => args.extend([
            "-frames:v".into(),
            "1".into(),
            "-c:v".into(),
            "libaom-av1".into(),
            "-still-picture".into(),
            "1".into(),
            "-crf".into(),
            ((100 - settings.avif.quality as u32) * 63 / 100).to_string(),
            "-cpu-used".into(),
            settings.avif.speed.to_string(),
        ]),
    }
    args.extend([output.into(), "-y".into()]);
    args
}

fn compress_local_image_file(
    file_path: &Path,
    settings: &LocalImageSettings,
    ffmpeg: &Path,
) -> AppResult<CompressionResult> {
    let format = image_format_from_path(file_path).ok_or_else(|| "不支持的图片格式".to_string())?;
    if format == "png" {
        return optimize_png_file(file_path, settings);
    }
    if format == "jpeg" {
        return optimize_jpeg_file(file_path, settings);
    }
    let input = file_path.to_string_lossy().to_string();
    let temp_path = PathBuf::from(format!("{}.tiny-local.{}", input, format));
    let temp = temp_path.to_string_lossy().to_string();
    let hdr = format == "avif" && detect_hdr(file_path, ffmpeg);
    let mut warnings = vec!["本地重编码会移除辅助元数据，请确认方向与色彩显示".into()];
    if format == "webp" {
        let bytes = fs::read(file_path).map_err(|e| e.to_string())?;
        if bytes.windows(4).any(|chunk| chunk == b"ANIM") {
            return Ok(CompressionResult {
                success: false,
                format: Some("webp".into()),
                input_size: bytes.len() as u64,
                output_size: bytes.len() as u64,
                saved_bytes: None,
                reason: Some("动画 WebP 暂不支持本地压缩，请改用 Tinify API".into()),
                compression_count: 0,
                engine: Some("local".into()),
                warnings: vec!["检测到动画 WebP，已保留原文件".into()],
            });
        }
    }
    if format == "avif" && hdr {
        warnings.push("检测到 HDR AVIF：本地压缩已降级为 SDR".into());
    }
    let output = Command::new(ffmpeg)
        .args(image_ffmpeg_args(format, settings, &input, &temp, hdr))
        .output()
        .map_err(|e| format!("ffmpeg 启动失败：{}", e))?;
    if !output.status.success() || !temp_path.exists() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "ffmpeg 图片压缩失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let bytes = fs::read(&temp_path).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&temp_path);
    replace_if_smaller(file_path, bytes, format, warnings)
}

fn compress_audio_file(
    file_path: &Path,
    format: &str,
    mp3: &LossyAudioPayload,
    ogg: &LossyAudioPayload,
    wav: &WavAudioPayload,
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

    let mut args = audio_ffmpeg_args(format, mp3, ogg, wav, &input, &temp);

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
            engine: None,
            warnings: Vec::new(),
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
            engine: None,
            warnings: Vec::new(),
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
        candidates.push(resource_dir.join(binary));
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
    use std::{
        future::Future,
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    use tempfile::tempdir;

    fn run_async<T>(future: impl Future<Output = T>) -> T {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    fn tinify_mock_endpoint(status: u16, compression_count: Option<u32>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let _ = stream.read(&mut buffer);
            let status_text = match status {
                200 => "OK",
                201 => "Created",
                401 => "Unauthorized",
                429 => "Too Many Requests",
                _ => "Server Error",
            };
            let count_header = compression_count
                .map(|count| format!("compression-count: {}\r\n", count))
                .unwrap_or_default();
            let response = format!(
                "HTTP/1.1 {} {}\r\n{}content-length: 0\r\nconnection: close\r\n\r\n",
                status, status_text, count_header
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        endpoint
    }

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
    fn backup_keeps_first_original_copy() {
        let dir = tempdir().unwrap();
        let original = dir.path().join("a.png");
        fs::write(&original, b"first").unwrap();

        let backup = backup_file(&original, DEFAULT_BACKUP_DIR_NAME).unwrap();
        fs::write(&original, b"second").unwrap();
        let same_backup = backup_file(&original, DEFAULT_BACKUP_DIR_NAME).unwrap();

        assert_eq!(backup, same_backup);
        assert_eq!(fs::read(PathBuf::from(backup)).unwrap(), b"first");
    }

    #[test]
    fn normalizes_settings_and_preserves_keys() {
        let settings = AppSettings {
            night_mode: "invalid".into(),
            close_behavior: "bad".into(),
            backup_dir_name: "../bad".into(),
            compression: settings::CompressionSettings {
                image: settings::ImageCompressionSettings {
                    recursive_scan: false,
                    ..Default::default()
                },
                audio: settings::AudioCompressionSettings {
                    recursive_scan: false,
                    mp3: settings::LossyAudioSettings {
                        bitrate: "bad".into(),
                        sample_rate: 1,
                        channels: 9,
                    },
                    ogg: settings::LossyAudioSettings {
                        bitrate: "bad".into(),
                        sample_rate: 1,
                        channels: 9,
                    },
                    wav: settings::WavAudioSettings {
                        sample_rate: 1,
                        channels: 9,
                    },
                },
            },
            tinypng_keys: vec![StoredTinypngKey {
                value: "key".into(),
                compression_count: Some(8),
            }],
        };

        let normalized = normalize_settings(settings);

        assert_eq!(normalized.night_mode, "system");
        assert_eq!(normalized.close_behavior, "background");
        assert_eq!(normalized.backup_dir_name, DEFAULT_BACKUP_DIR_NAME);
        assert_eq!(normalized.compression.audio.mp3.bitrate, "96k");
        assert_eq!(normalized.compression.audio.mp3.sample_rate, 44100);
        assert_eq!(normalized.compression.audio.wav.channels, 2);
        assert_eq!(normalized.tinypng_keys[0].value, "key");
        assert_eq!(normalized.tinypng_keys[0].compression_count, Some(8));
    }

    #[test]
    fn exports_and_imports_complete_settings_with_keys() {
        let mut settings = AppSettings::default();
        settings.night_mode = "dark".into();
        settings.tinypng_keys = vec![StoredTinypngKey {
            value: "secret-key".into(),
            compression_count: Some(12),
        }];

        let encoded = encode_exported_settings(settings).unwrap();
        let decoded = decode_exported_settings(&encoded).unwrap();

        assert!(encoded.contains("\"format\": \"tinypress-settings\""));
        assert!(encoded.contains("\"version\": 1"));
        assert_eq!(decoded.night_mode, "dark");
        assert_eq!(decoded.tinypng_keys[0].value, "secret-key");
        assert_eq!(decoded.tinypng_keys[0].compression_count, Some(12));
    }

    #[test]
    fn rejects_invalid_or_unknown_settings_exports() {
        assert!(decode_exported_settings("not json").is_err());
        assert!(
            decode_exported_settings(r#"{"format":"other","version":1,"settings":{}}"#).is_err()
        );
        assert!(decode_exported_settings(
            r#"{"format":"tinypress-settings","version":2,"settings":{}}"#
        )
        .is_err());
    }

    #[test]
    fn persists_settings_to_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let settings = AppSettings {
            night_mode: "dark".into(),
            close_behavior: "quit".into(),
            backup_dir_name: "custom_backup".into(),
            compression: settings::CompressionSettings::default(),
            tinypng_keys: vec![StoredTinypngKey {
                value: "key".into(),
                compression_count: Some(3),
            }],
        };

        persist_settings(&path, &settings).unwrap();
        let raw = fs::read_to_string(path).unwrap();

        assert!(raw.contains("\"backupDirName\": \"custom_backup\""));
        assert!(raw.contains("\"compression\""));
        assert!(raw.contains("\"compressionCount\": 3"));
    }

    #[test]
    fn resolves_mixed_audio_formats_by_extension() {
        assert_eq!(audio_format_from_path(Path::new("song.MP3")), Some("mp3"));
        assert_eq!(audio_format_from_path(Path::new("song.ogg")), Some("ogg"));
        assert_eq!(audio_format_from_path(Path::new("song.wav")), Some("wav"));
        assert_eq!(audio_format_from_path(Path::new("song.flac")), None);
    }

    #[test]
    fn maps_audio_settings_to_ffmpeg_arguments() {
        let mp3 = LossyAudioPayload {
            bitrate: "48k".into(),
            sample_rate: 32000,
            channels: 1,
        };
        let ogg = LossyAudioPayload {
            bitrate: "160k".into(),
            sample_rate: 48000,
            channels: 2,
        };
        let wav = WavAudioPayload {
            sample_rate: 44100,
            channels: 2,
        };
        assert!(audio_ffmpeg_args("mp3", &mp3, &ogg, &wav, "in", "out").contains(&"48k".into()));
        assert!(audio_ffmpeg_args("ogg", &mp3, &ogg, &wav, "in", "out").contains(&"160k".into()));
        assert!(audio_ffmpeg_args("wav", &mp3, &ogg, &wav, "in", "out").contains(&"44100".into()));
    }

    #[test]
    fn normalizes_invalid_audio_payload_settings() {
        let payload = normalize_audio_payload(AudioPayload {
            paths: vec!["song.mp3".into()],
            recursive: Some(false),
            mp3: LossyAudioPayload {
                bitrate: "999k".into(),
                sample_rate: 12345,
                channels: 9,
            },
            ogg: LossyAudioPayload {
                bitrate: "1k".into(),
                sample_rate: 12345,
                channels: 0,
            },
            wav: WavAudioPayload {
                sample_rate: 12345,
                channels: 3,
            },
        });
        assert_eq!(payload.mp3.bitrate, "96k");
        assert_eq!(payload.mp3.sample_rate, 44100);
        assert_eq!(payload.mp3.channels, 2);
        assert_eq!(payload.ogg.bitrate, "96k");
        assert_eq!(payload.ogg.sample_rate, 44100);
        assert_eq!(payload.ogg.channels, 2);
        assert_eq!(payload.wav.sample_rate, 22050);
        assert_eq!(payload.wav.channels, 2);
        assert_eq!(payload.recursive, Some(false));
    }

    #[test]
    fn smoke_scans_generated_fixture_directories_without_duplicates() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tmp/tinypress-fixtures");
        if !root.exists() {
            return;
        }
        let mut files = Vec::new();
        collect_files(
            &root,
            &["png", "jpg", "jpeg", "webp", "avif"],
            true,
            DEFAULT_BACKUP_DIR_NAME,
            &mut files,
        );
        files.sort();
        files.dedup();
        assert_eq!(files.len(), 8);
        assert!(!files
            .iter()
            .any(|path| path.to_string_lossy().contains("_tiny_backup")));
    }

    #[test]
    fn smoke_compresses_generated_local_image_fixtures() {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let root = project.join(".tmp/tinypress-fixtures");
        let ffmpeg = project.join("node_modules/ffmpeg-static/ffmpeg");
        if !root.exists() || !ffmpeg.exists() {
            return;
        }
        let dir = tempdir().unwrap();
        let settings = settings::LocalImageSettings::default();
        for name in ["sample.png", "sample.jpg", "sample.webp", "sample.avif"] {
            let target = dir.path().join(name);
            fs::copy(root.join(name), &target).unwrap();
            let result = compress_local_image_file(&target, &settings, &ffmpeg).unwrap();
            assert!(result.success || result.reason.is_some());
            assert_eq!(result.engine.as_deref(), Some("local"));
        }
        let animated = dir.path().join("animated.webp");
        fs::copy(root.join("animated.webp"), &animated).unwrap();
        let result = compress_local_image_file(&animated, &settings, &ffmpeg).unwrap();
        assert!(result.reason.unwrap().contains("动画 WebP"));

        let transparent = dir.path().join("transparent.png");
        fs::copy(root.join("transparent.png"), &transparent).unwrap();
        let before = lodepng::decode32_file(&transparent).unwrap();
        let _ = compress_local_image_file(&transparent, &settings, &ffmpeg).unwrap();
        let after = lodepng::decode32_file(&transparent).unwrap();
        assert_eq!(
            before
                .buffer
                .iter()
                .map(|pixel| pixel.a)
                .collect::<Vec<_>>(),
            after.buffer.iter().map(|pixel| pixel.a).collect::<Vec<_>>()
        );

        let apng = dir.path().join("animated.png");
        fs::copy(root.join("animated.png"), &apng).unwrap();
        let result = compress_local_image_file(&apng, &settings, &ffmpeg).unwrap();
        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("APNG")));
        assert!(fs::read(&apng)
            .unwrap()
            .windows(4)
            .any(|chunk| chunk == b"acTL"));
    }

    #[test]
    fn maps_local_image_settings_to_ffmpeg_arguments() {
        let settings = settings::LocalImageSettings::default();
        let webp = image_ffmpeg_args("webp", &settings, "in.webp", "out.webp", false);
        assert!(webp.windows(2).any(|pair| pair == ["-c:v", "libwebp"]));
        let avif = image_ffmpeg_args("avif", &settings, "in.avif", "out.avif", false);
        assert!(avif.windows(2).any(|pair| pair == ["-c:v", "libaom-av1"]));
        assert!(avif.windows(2).any(|pair| pair == ["-cpu-used", "6"]));
    }

    #[test]
    fn creates_progressive_jpeg_when_enabled() {
        let encoded = mozjpeg_rs::Encoder::new(mozjpeg_rs::Preset::ProgressiveBalanced)
            .quality(82)
            .progressive(true)
            .encode_rgb(&[90; 8 * 8 * 3], 8, 8)
            .unwrap();
        assert!(encoded.windows(2).any(|marker| marker == [0xff, 0xc2]));
    }

    #[test]
    fn smoke_compresses_generated_audio_fixtures() {
        let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let root = project.join(".tmp/tinypress-fixtures");
        let ffmpeg = project.join("node_modules/ffmpeg-static/ffmpeg");
        if !root.exists() || !ffmpeg.exists() {
            return;
        }
        let dir = tempdir().unwrap();
        let mp3 = LossyAudioPayload {
            bitrate: "48k".into(),
            sample_rate: 32000,
            channels: 1,
        };
        let ogg = LossyAudioPayload {
            bitrate: "96k".into(),
            sample_rate: 44100,
            channels: 2,
        };
        let wav = WavAudioPayload {
            sample_rate: 44100,
            channels: 2,
        };
        for format in ["mp3", "ogg", "wav"] {
            let source = root.join(format!("sample.{}", format));
            let target = dir.path().join(format!("sample.{}", format));
            fs::copy(source, &target).unwrap();
            let result = compress_audio_file(&target, format, &mp3, &ogg, &wav, &ffmpeg).unwrap();
            assert!(result.success || result.reason.is_some());
        }
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
    fn reads_file_metadata_for_images_text_binary_and_missing_files() {
        let dir = tempdir().unwrap();
        let image = dir.path().join("one.png");
        let text = dir.path().join("a.txt");
        let binary = dir.path().join("data.bin");
        let missing = dir.path().join("missing.txt");
        fs::write(&image, TINY_PNG).unwrap();
        fs::write(&text, b"hello").unwrap();
        fs::write(&binary, [0, 159, 146, 150]).unwrap();

        let image_meta = file_metadata(&image, None, true);
        let text_meta = file_metadata(&text, None, true);
        let binary_meta = file_metadata(&binary, None, false);
        let missing_meta = file_metadata(&missing, None, true);

        assert_eq!(image_meta.kind, "image");
        let dimensions = image_meta.image.as_ref().unwrap();
        assert_eq!(dimensions.width, Some(1));
        assert_eq!(dimensions.height, Some(1));
        assert_eq!(text_meta.kind, "text");
        assert!(text_meta.sha256.is_some());
        assert_eq!(binary_meta.kind, "binary");
        assert!(!missing_meta.exists);
    }

    #[test]
    fn builds_text_diff_for_changed_added_and_removed_lines() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.txt");
        let right = dir.path().join("right.txt");
        fs::write(&left, "same\nold\nremoved\n").unwrap();
        fs::write(&right, "same\nnew\n").unwrap();

        let diff = build_text_diff(&left, &right).unwrap();

        assert_eq!(diff[0].kind, "same");
        assert_eq!(diff[1].kind, "changed");
        assert_eq!(diff[2].kind, "removed");
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

    #[test]
    fn checks_tinypng_key_against_mock_success_and_exhausted_responses() {
        let success = tinify_mock_endpoint(201, Some(42));
        let success_result =
            run_async(check_tinypng_key_with_endpoint("key".into(), &success)).unwrap();
        assert!(success_result.valid);
        assert_eq!(success_result.compression_count, Some(42));
        assert_eq!(success_result.remaining, Some(458));

        let exhausted = tinify_mock_endpoint(429, Some(500));
        let exhausted_result =
            run_async(check_tinypng_key_with_endpoint("key".into(), &exhausted)).unwrap();
        assert!(exhausted_result.valid);
        assert_eq!(exhausted_result.remaining, Some(0));
        assert_eq!(exhausted_result.error, Some("当月已达上限".into()));
    }

    #[test]
    fn checks_tinypng_key_against_mock_invalid_and_network_errors() {
        let invalid = tinify_mock_endpoint(401, None);
        let invalid_result =
            run_async(check_tinypng_key_with_endpoint("bad".into(), &invalid)).unwrap();
        assert!(!invalid_result.valid);
        assert_eq!(invalid_result.error, Some("API Key 无效".into()));

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let network_result = run_async(check_tinypng_key_with_endpoint("key".into(), &endpoint));
        assert!(network_result.is_err());
    }
}
