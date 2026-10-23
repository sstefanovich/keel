mod attach;
mod calendar;
mod history;
mod hold;
mod notify;
mod pty;

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

const CAPTURE_WIDTH: f64 = 680.0;

/// The small always-on-top capture box. Created hidden at startup so it opens instantly.
fn build_capture_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, "capture", tauri::WebviewUrl::App("index.html".into()))
        .title("Keel quick capture")
        .inner_size(CAPTURE_WIDTH, 132.0)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .build()
}

/// Put the capture box on the monitor under the mouse, centred, a quarter of the way down.
fn place_capture(app: &AppHandle, w: &tauri::WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let (pos, size) = (m.position(), m.size());
        let width = (CAPTURE_WIDTH * scale) as i32;
        let x = pos.x + (size.width as i32 - width) / 2;
        let y = pos.y + (size.height as f64 * 0.24) as i32;
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    } else {
        let _ = w.center();
    }
}

fn quick_capture(app: &AppHandle) {
    let main = app.get_webview_window("main");
    let main_in_front = main
        .as_ref()
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    // Already working in Keel: use its own capture box.
    if main_in_front {
        let _ = app.emit_to("main", "quick-capture", CapturePayload { was_hidden: false });
        return;
    }
    let capture = app.get_webview_window("capture").map(Ok).unwrap_or_else(|| build_capture_window(app));
    match capture {
        Ok(w) => {
            place_capture(app, &w);
            let _ = w.show();
            let _ = w.set_focus();
            let _ = app.emit_to("capture", "capture-open", ());
        }
        // fall back to the main window's box
        Err(_) => {
            show_main(app);
            let _ = app.emit_to("main", "quick-capture", CapturePayload { was_hidden: true });
        }
    }
}

pub const CAPTURE_SHORTCUT: &str = "ctrl+alt+k";

/// Whether the window has the Mica backdrop (Windows 11), so the UI can let it show through.
struct Backdrop {
    mica: bool,
}

#[tauri::command]
fn window_backdrop(state: tauri::State<Backdrop>) -> &'static str {
    if state.mica { "mica" } else { "none" }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::ShortcutState;

    tauri::Builder::default()
        .manage(pty::Ptys::default())
        // must be first: a second launch just focuses the running instance
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // remember window size/position/maximized between launches (restored before show)
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Keel draws its own title bar: never restore decorations from an older saved state
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .with_denylist(&["capture"])
                .build(),
        )
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

            let _ = build_capture_window(app.handle());

            // Windows 11 Mica behind the window; the UI keeps its own opaque background where it isn't supported
            #[cfg(windows)]
            let mica = app
                .get_webview_window("main")
                .map(|w| {
                    let _ = w.set_decorations(false);
                    window_vibrancy::apply_mica(&w, None).is_ok()
                })
                .unwrap_or(false);
            #[cfg(not(windows))]
            let mica = false;
            app.manage(Backdrop { mica });

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
            window_backdrop,
            hold::hold_list,
            hold::hold_read,
            hold::hold_write,
            hold::hold_exists,
            hold::hold_remove,
            hold::hold_rename,
            hold::save_export,
            hold::hold_dirs,
            hold::hold_mkdir,
            hold::hold_rmdir,
            pty::claude_path,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            calendar::calendar_fetch,
            calendar::calendar_cached,
            calendar::calendar_forget,
            history::history_snapshot,
            history::history_versions,
            history::history_read,
            notify::reminder_notify,
            attach::hold_write_image,
            attach::hold_image_url,
            attach::link_title,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Keel");
}
