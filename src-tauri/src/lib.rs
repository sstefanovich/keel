mod hold;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// Default hold location: ~/Keel
#[tauri::command]
fn default_hold_dir(app: AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join("Keel").to_string_lossy().into_owned())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CapturePayload {
    /// The window was hidden before capture, so the UI hides it again afterwards.
    was_hidden: bool,
}

fn quick_capture(app: &AppHandle) {
    let was_hidden = app
        .get_webview_window("main")
        .map(|w| !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false))
        .unwrap_or(true);
    show_main(app);
    let _ = app.emit("quick-capture", CapturePayload { was_hidden });
}

pub const CAPTURE_SHORTCUT: &str = "ctrl+alt+k";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::ShortcutState;

    tauri::Builder::default()
        // must be first: a second launch just focuses the running instance
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts([CAPTURE_SHORTCUT])
                .expect("valid shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        quick_capture(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Keel", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "Quick capture\tCtrl+Alt+K", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &capture, &quit])?;
            TrayIconBuilder::with_id("keel")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Keel")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "capture" => quick_capture(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Launched at login: stay in the tray so reminders keep running.
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(app.handle());
            }
            Ok(())
        })
        // Closing the window hides it to the tray; reminders keep firing.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            default_hold_dir,
            hold::hold_list,
            hold::hold_read,
            hold::hold_write,
            hold::hold_exists,
            hold::hold_remove,
            hold::hold_rename,
            hold::save_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Keel");
}
