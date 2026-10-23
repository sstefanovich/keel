//! Calendar subscriptions (ICS feeds from Outlook / Google). Fetched here rather than in the
//! webview (no CORS) and cached in the app's cache folder, never in the Hold: the feed URLs are
//! secrets and the events belong to the calendar, not to the notes.

use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const MAX_BYTES: usize = 32 * 1024 * 1024;

/// `webcal://` is just a hint to calendar apps; the feed itself is served over https.
fn normalize_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let url = if let Some(rest) = lower.strip_prefix("webcal://").map(|_| &url[9..]) {
        format!("https://{rest}")
    } else {
        url.to_string()
    };
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("A calendar link starts with https:// (or webcal://)".into());
    }
    Ok(url)
}

/// Cache ids come from the UI; keep them to plain file-name characters.
fn cache_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad calendar id".into());
    }
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("calendars");
    Ok(dir.join(format!("{id}.ics")))
}

/// Download a feed, cache it, and return its text.
#[tauri::command]
pub async fn calendar_fetch(app: AppHandle, id: String, url: String) -> Result<String, String> {
    let path = cache_file(&app, &id)?;
    let url = normalize_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("Keel")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| format!("Couldn't reach the calendar: {}", without_url(e)))?;
    let status = res.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "The calendar refused the request (the link may have been reset or unpublished)".into(),
            404 => "Calendar not found (the link may have been reset or unpublished)".into(),
            s => format!("The calendar server answered {s}"),
        });
    }
    let bytes = res.bytes().await.map_err(|e| format!("Download failed: {}", without_url(e)))?;
    if bytes.len() > MAX_BYTES {
        return Err("The calendar feed is too large".into());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !text.trim_start_matches('\u{feff}').trim_start().starts_with("BEGIN:VCALENDAR") {
        return Err("That link didn't return a calendar (use the ICS link, not the HTML one)".into());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("ics.tmp");
    std::fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(text)
}

/// Errors from reqwest include the URL, which is a secret: keep it out of messages.
fn without_url(e: reqwest::Error) -> String {
    e.without_url().to_string()
}

/// The last downloaded copy of a feed, if any (shown while offline or before the first refresh).
#[tauri::command]
pub fn calendar_cached(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let path = cache_file(&app, &id)?;
    match std::fs::read_to_string(&path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Forget a removed calendar's cached copy.
#[tauri::command]
pub fn calendar_forget(app: AppHandle, id: String) -> Result<(), String> {
    let path = cache_file(&app, &id)?;
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn webcal_becomes_https() {
        assert_eq!(normalize_url(" webcal://example.com/a.ics ").unwrap(), "https://example.com/a.ics");
        assert_eq!(normalize_url("WEBCAL://Example.com/B.ics").unwrap(), "https://Example.com/B.ics");
        assert_eq!(normalize_url("https://x.y/z.ics").unwrap(), "https://x.y/z.ics");
    }

    #[test]
    fn other_schemes_are_refused() {
        assert!(normalize_url("file:///c:/x.ics").is_err());
        assert!(normalize_url("ftp://x").is_err());
        assert!(normalize_url("").is_err());
    }
}
