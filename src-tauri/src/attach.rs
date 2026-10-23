//! Images pasted or dropped into notes (saved under the Hold, e.g. `attachments/…png`), and page
//! titles for pasted links.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::fs;
use std::time::Duration;

use crate::hold::resolve;

const MAX_IMAGE: usize = 25 * 1024 * 1024;

fn mime_of(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// Save an image (base64) into the hold. Refuses non-image names and existing files.
#[tauri::command]
pub fn hold_write_image(root: String, path: String, data: String) -> Result<(), String> {
    if mime_of(&path).is_none() {
        return Err("Only images can be attached".into());
    }
    let bytes = STANDARD.decode(data.as_bytes()).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE {
        return Err("That image is too large (25 MB at most)".into());
    }
    let target = resolve(&root, &path)?;
    if target.exists() {
        return Err(format!("{path} already exists"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, bytes).map_err(|e| e.to_string())
}

/// An image from the hold as a data: URL, for showing inside a note.
#[tauri::command]
pub fn hold_image_url(root: String, path: String) -> Result<String, String> {
    let mime = mime_of(&path).ok_or("Not an image")?;
    let target = resolve(&root, &path)?;
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE {
        return Err("Image too large to show".into());
    }
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// The text of a page's <title>, entities decoded and whitespace collapsed.
fn title_of(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<title")?;
    let open_end = start + lower[start..].find('>')? + 1;
    let close = open_end + lower[open_end..].find("</title>")?;
    let raw = &html[open_end..close];
    let text = raw
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ");
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

/// The title of a web page, for turning a pasted link into `[title](url)`. None when there isn't
/// a useful one (sign-in pages, errors, timeouts).
#[tauri::command]
pub async fn link_title(url: String) -> Result<Option<String>, String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Keel")
        .build()
        .map_err(|e| e.to_string())?;
    let Ok(res) = client.get(&url).send().await else { return Ok(None) };
    if !res.status().is_success() {
        return Ok(None);
    }
    let is_html = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("html"));
    if !is_html {
        return Ok(None);
    }
    let Ok(body) = res.bytes().await else { return Ok(None) };
    let head = String::from_utf8_lossy(&body[..body.len().min(512 * 1024)]);
    let title = title_of(&head);
    let useless = |t: &str| {
        let t = t.to_ascii_lowercase();
        ["sign in", "sign-in", "log in", "login", "access denied", "redirecting", "just a moment", "403", "404"].iter().any(|w| t.contains(w))
    };
    Ok(title.filter(|t| !useless(t) && t.len() <= 300))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles() {
        assert_eq!(title_of("<html><head><TITLE>\n  Rust &amp; Tauri\n</TITLE>").as_deref(), Some("Rust & Tauri"));
        assert_eq!(title_of("<title data-x=\"1\">A</title>").as_deref(), Some("A"));
        assert_eq!(title_of("<html>no title</html>"), None);
        assert_eq!(title_of("<title>   </title>"), None);
    }

    #[test]
    fn images_only() {
        let dir = std::env::temp_dir().join(format!("keel-attach-{}", std::process::id()));
        let root = dir.to_str().unwrap().to_string();
        let png = STANDARD.encode([137u8, 80, 78, 71]);
        hold_write_image(root.clone(), "attachments/a.png".into(), png.clone()).unwrap();
        assert!(hold_write_image(root.clone(), "attachments/a.png".into(), png.clone()).is_err()); // no overwrite
        assert!(hold_write_image(root.clone(), "notes/x.md".into(), png.clone()).is_err());
        assert!(hold_write_image(root.clone(), "../a.png".into(), png).is_err());
        assert!(hold_image_url(root.clone(), "attachments/a.png".into()).unwrap().starts_with("data:image/png;base64,"));
        let _ = fs::remove_dir_all(&dir);
    }
}
