use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{
    image::Image,
    menu::{AboutMetadata, AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

#[derive(Default)]
struct TaskState {
    stop_image: AtomicBool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImagePayload {
    paths: Vec<String>,
    api_keys: Vec<String>,
    recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioPayload {
    paths: Vec<String>,
    format: String,
    recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestorePayload {
    backup_path: String,
    original_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressItem {
    file: String,
    backup_path: Option<String>,
    status: String,
    input_size: Option<String>,
    output_size: Option<String>,
    input_bytes: Option<u64>,
    output_bytes: Option<u64>,
    saved: Option<String>,
    reason: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Stats {
    total: usize,
    processed: usize,
    skipped: usize,
    failed: usize,
    saved_bytes: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct KeyCount {
    key: String,
    compression_count: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PausedPayload {
    remaining: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyCheckResult {
    valid: bool,
    compression_count: Option<u32>,
    remaining: Option<i32>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TinifyShrinkResponse {
    input: TinifySize,
    output: TinifyOutput,
}

#[derive(Debug, Deserialize)]
struct TinifySize {
    size: u64,
}

#[derive(Debug, Deserialize)]
struct TinifyOutput {
    size: u64,
    url: String,
}

#[derive(Debug)]
struct TinifyError {
    status: Option<u16>,
    compression_count: Option<u32>,
    message: String,
}

type AppResult<T> = Result<T, String>;

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
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
async fn compress_image(
    app: AppHandle,
    state: State<'_, TaskState>,
    payload: ImagePayload,
) -> AppResult<()> {
    state.stop_image.store(false, Ordering::SeqCst);
    let recursive = payload.recursive.unwrap_or(true);
    let mut files = Vec::new();
    for p in &payload.paths {
        let path = Path::new(p);
        if path.is_dir() {
            collect_files(path, &["png", "jpg", "jpeg"], recursive, &mut files);
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

        let backup_path = backup_file(file);
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
async fn compress_audio(app: AppHandle, payload: AudioPayload) -> AppResult<()> {
    let recursive = payload.recursive.unwrap_or(true);
    let ext = match payload.format.as_str() {
        "mp3" => "mp3",
        "ogg" => "ogg",
        "wav" => "wav",
        _ => "mp3",
    };
    let mut files = Vec::new();
    for p in &payload.paths {
        let path = Path::new(p);
        if path.is_dir() {
            collect_files(path, &[ext], recursive, &mut files);
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

    for file in &files {
        let backup_path = backup_file(file);
        let file_for_task = file.clone();
        let format_for_task = payload.format.clone();
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
fn open_in_finder(file_path: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(&file_path).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", file_path))
        .status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(
            Path::new(&file_path)
                .parent()
                .unwrap_or_else(|| Path::new(".")),
        )
        .status();

    status.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external(url: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", &url]).status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(url).status();

    status.map(|_| ()).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            create_status_bar(app.handle())?;
            Ok(())
        })
        .menu(create_app_menu)
        .manage(TaskState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            check_tinypng_key,
            compress_image,
            stop_image_compression,
            compress_audio,
            restore_file,
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
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Debug)]
struct CompressionResult {
    success: bool,
    input_size: u64,
    output_size: u64,
    saved_bytes: Option<u64>,
    reason: Option<String>,
    compression_count: u32,
}

impl ProgressItem {
    fn success(file: &Path, backup_path: Option<&str>, result: &CompressionResult) -> Self {
        Self {
            file: file.to_string_lossy().to_string(),
            backup_path: backup_path.map(str::to_string),
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

fn create_status_bar(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "打开 TinyPress", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "完全退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png")).ok();

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("TinyPress 压缩工作台")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon).icon_as_template(true);
    } else {
        builder = builder.title("TinyPress");
    }

    builder.build(app)?;
    Ok(())
}

fn create_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(app, Some("关于 TinyPress"), Some(about_metadata(app)))?;

    let app_menu = Submenu::with_items(
        app,
        "TinyPress",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("完全退出"))?,
        ],
    )?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(app, None)?],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help_menu = Submenu::with_items(app, "Help", true, &[])?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

fn about_metadata(app: &AppHandle) -> AboutMetadata<'_> {
    AboutMetadataBuilder::new()
        .name(Some("TinyPress"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .authors(Some(vec!["taosiqi".into()]))
        .comments(Some("图片与音频压缩工作台"))
        .copyright(Some("Copyright 2026 taosiqi"))
        .website(Some("https://github.com/taosiqi/tiny-app"))
        .website_label(Some("GitHub"))
        .icon(app.default_window_icon().cloned())
        .build()
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn collect_files(dir: &Path, exts: &[&str], recursive: bool, results: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "_tiny_backup") {
                continue;
            }
            if recursive {
                collect_files(&path, exts, recursive, results);
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

fn backup_file(file_path: &Path) -> Option<String> {
    let dir = file_path.parent()?;
    let name = file_path.file_name()?;
    let backup_dir = dir.join("_tiny_backup");
    fs::create_dir_all(&backup_dir).ok()?;
    let backup_path = backup_dir.join(name);
    if !backup_path.exists() {
        fs::copy(file_path, &backup_path).ok()?;
    }
    Some(backup_path.to_string_lossy().to_string())
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
            input_size: shrink.input.size,
            output_size: shrink.output.size,
            saved_bytes: Some(shrink.input.size - shrink.output.size),
            reason: None,
            compression_count,
        })
    } else {
        Ok(CompressionResult {
            success: false,
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
