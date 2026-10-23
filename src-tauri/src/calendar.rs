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

/// Download a feed's text, checking it really is a calendar.
pub(crate) async fn download(url: &str) -> Result<String, String> {
    let url = normalize_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Keel/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "text/calendar, text/plain;q=0.9, */*;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the calendar: {}", without_url(e)))?;
    let status = res.status();
    // where redirects ended up (host and path only: the link itself is a secret)
    let fin = res.url().clone();
    let host = fin.host_str().unwrap_or("").to_ascii_lowercase();
    let path = fin.path().to_ascii_lowercase();
    let bytes = res.bytes().await.map_err(|e| format!("Download failed: {}", without_url(e)))?;
    if bytes.len() > MAX_BYTES {
        return Err("The calendar feed is too large".into());
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let is_calendar = text.trim_start_matches('\u{feff}').trim_start().starts_with("BEGIN:VCALENDAR");
    if status.is_success() && is_calendar {
        return Ok(text);
    }
    Err(explain(status.as_u16(), &host, &path, &normalize_url(&url).unwrap_or_default().to_ascii_lowercase()))
}

/// Why a calendar link didn't give a calendar, in terms of what to do about it.
fn explain(status: u16, final_host: &str, final_path: &str, asked: &str) -> String {
    let signed_in_only = "Your browser can open it because you're signed in there; Keel isn't.";
    if ["accounts.google.com", "login.microsoftonline.com", "login.live.com"].contains(&final_host) {
        return format!("That link needs a sign-in, so it isn't a subscription link. {signed_in_only} Use the secret/published ICS link instead (see “Where do I find the link?”).");
    }
    if asked.contains("calendar.google.com") && asked.contains("/public/") {
        return format!(
            "That's Google's public address, which only works if the calendar is shared publicly. {signed_in_only} \
             In Google Calendar's settings for this calendar, copy “Secret address in iCal format” instead."
        );
    }
    if final_host.ends_with("outlook.office365.com") && final_path.contains("errorfe") {
        return "Outlook says this published calendar doesn't exist: it may have been unpublished or its link reset. \
                Publish it again (Outlook → Settings → Calendar → Shared calendars) and copy the new ICS link."
            .into();
    }
    if asked.contains("outlook.") && asked.ends_with(".html") {
        return "That's Outlook's HTML link (a web page). Copy the ICS link shown next to it instead.".into();
    }
    match status {
        401 | 403 => "The calendar refused the request: the link may have been reset or unpublished, or your organisation blocks it.".into(),
        404 => "Calendar not found: the link may have been reset or unpublished.".into(),
        s if !(200..300).contains(&s) => format!("The calendar server answered {s}."),
        _ => "That link returned a web page, not a calendar. Use the ICS link (ending in .ics), not the HTML one.".into(),
    }
}

/// Download a feed, cache it, and return its text.
#[tauri::command]
pub async fn calendar_fetch(app: AppHandle, id: String, url: String) -> Result<String, String> {
    let path = cache_file(&app, &id)?;
    let text = download(&url).await?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("ics.tmp");
    std::fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(text)
}

/// Errors from reqwest include the URL, which is a secret: keep it out of messages. The causes
/// underneath ("error sending request" ← TLS / proxy / DNS details) are what make it diagnosable.
fn without_url(e: reqwest::Error) -> String {
    let e = e.without_url();
    let mut msg = e.to_string();
    let mut src = std::error::Error::source(&e);
    while let Some(s) = src {
        msg.push_str(": ");
        msg.push_str(&s.to_string());
        src = s.source();
    }
    msg
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
    fn failures_say_what_to_do() {
        use super::explain;
        assert!(explain(200, "accounts.google.com", "/signin", "https://calendar.google.com/x").contains("needs a sign-in"));
        assert!(explain(404, "calendar.google.com", "/calendar/ical/a/public/basic.ics", "https://calendar.google.com/calendar/ical/a/public/basic.ics").contains("Secret address"));
        assert!(explain(200, "outlook.office365.com", "/owa/auth/errorfe.aspx", "https://outlook.office365.com/owa/calendar/a/b/calendar.ics").contains("unpublished"));
        assert!(explain(200, "outlook.office365.com", "/owa/calendar/a/b/calendar.html", "https://outlook.office365.com/owa/calendar/a/b/calendar.html").contains("HTML link"));
        assert!(explain(500, "x.com", "/", "https://x.com/").contains("500"));
    }

    #[test]
    fn other_schemes_are_refused() {
        assert!(normalize_url("file:///c:/x.ics").is_err());
        assert!(normalize_url("ftp://x").is_err());
        assert!(normalize_url("").is_err());
    }
}

#[cfg(test)]
mod live {
    /// Real network: `cargo test -- --ignored live_` (Google's public US holidays calendar)
    #[test]
    #[ignore]
    fn live_google_public_calendar() {
        let url = "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics";
        let r = tauri::async_runtime::block_on(super::download(url));
        match &r {
            Ok(t) => println!("ok: {} bytes", t.len()),
            Err(e) => println!("error: {e}"),
        }
        assert!(r.is_ok());
    }
}
