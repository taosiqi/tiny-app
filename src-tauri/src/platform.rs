#[cfg(all(unix, not(target_os = "macos")))]
use std::path::Path;
use std::process::Command;
use tauri::{
    image::Image,
    menu::{AboutMetadata, AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::{settings::should_hide_instead_of_quit, AppResult};

pub fn create_status_bar(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "打开 TinyPress", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
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

pub fn create_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = PredefinedMenuItem::about(app, Some("关于 TinyPress"), Some(about_metadata(app)))?;
    let settings = MenuItem::with_id(app, "settings", "设置...", true, None::<&str>)?;
    let app_quit = MenuItem::with_id(app, "app_quit", "退出", true, None::<&str>)?;

    let app_menu = Submenu::with_items(
        app,
        "TinyPress",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &app_quit,
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
        .copyright(Some("Copyright 2026 taosiqi"))
        .website(Some("https://github.com/taosiqi/tiny-app"))
        .website_label(Some("GitHub"))
        .icon(app.default_window_icon().cloned())
        .build()
}

pub fn quit_from_setting(app: &AppHandle) {
    if should_hide_instead_of_quit(app) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    } else {
        app.exit(0);
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub fn open_in_finder(file_path: String) -> AppResult<()> {
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
pub fn open_external(url: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(url).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", &url]).status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(url).status();

    status.map(|_| ()).map_err(|e| e.to_string())
}
