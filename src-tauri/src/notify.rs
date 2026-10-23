//! Reminder notifications with Snooze buttons. Tauri's notification plugin can't add actions on
//! Windows, so this talks to the Windows toast API directly (the same library the plugin uses).
//! Choices come back to the UI as a "reminder-action" event.

use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct ReminderAction {
    id: String,
    /// "snooze:10", "snooze:60", or "open" (the notification itself was clicked)
    action: String,
}

#[cfg(windows)]
fn app_id(app: &AppHandle) -> String {
    use tauri_winrt_notification::Toast;
    // like the notification plugin: the installed app has its own identity; dev builds borrow PowerShell's
    let dev = tauri::utils::platform::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.display().to_string()))
        .map(|d| d.ends_with("target\\debug") || d.ends_with("target\\release"))
        .unwrap_or(true);
    if dev { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() }
}

#[cfg(windows)]
#[tauri::command]
pub fn reminder_notify(app: AppHandle, id: String, title: String, body: String) -> Result<(), String> {
    use tauri_winrt_notification::{Scenario, Toast};
    let handle = app.clone();
    Toast::new(&app_id(&app))
        .title(&title)
        .text1(&body)
        .scenario(Scenario::Reminder)
        .add_button("Snooze 10 min", "snooze:10")
        .add_button("Snooze 1 hour", "snooze:60")
        .add_button("Dismiss", "dismiss")
        .on_activated(move |action| {
            let action = action.unwrap_or_else(|| "open".into());
            let _ = handle.emit_to("main", "reminder-action", ReminderAction { id: id.clone(), action });
            Ok(())
        })
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn reminder_notify(_app: AppHandle, _id: String, _title: String, _body: String) -> Result<(), String> {
    Err("reminder_notify is Windows only".into())
}
