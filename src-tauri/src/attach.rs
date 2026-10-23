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

/// A web page's HTML (up to `max` bytes), or None if it isn't reachable HTML.
async fn fetch_html(url: &str, timeout: u64, max: usize) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Keel")
        .build()
        .ok()?;
    let res = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let is_html = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("html"));
    if !is_html {
        return None;
    }
    let body = res.bytes().await.ok()?;
    Some(String::from_utf8_lossy(&body[..body.len().min(max)]).into_owned())
}

/// The title of a web page, for turning a pasted link into `[title](url)`. None when there isn't
/// a useful one (sign-in pages, errors, timeouts).
#[tauri::command]
pub async fn link_title(url: String) -> Result<Option<String>, String> {
    let Some(head) = fetch_html(&url, 6, 512 * 1024).await else { return Ok(None) };
    let title = title_of(&head);
    let useless = |t: &str| {
        let t = t.to_ascii_lowercase();
        ["sign in", "sign-in", "log in", "login", "access denied", "redirecting", "just a moment", "403", "404"].iter().any(|w| t.contains(w))
    };
    Ok(title.filter(|t| !useless(t) && t.len() <= 300))
}

// ---------- recipes ----------

#[derive(serde::Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecipeInfo {
    title: String,
    ingredients: Vec<String>,
    steps: Vec<String>,
    servings: Option<String>,
    /// ISO 8601 duration as the page gives it ("PT1H30M")
    total_time: Option<String>,
    image: Option<String>,
}

/// Strip tags and decode the common entities in text taken from a page.
fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
        .replace("&frac12;", "½")
        .replace("&frac14;", "¼")
        .replace("&frac34;", "¾");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_recipe(v: &serde_json::Value) -> bool {
    match v.get("@type") {
        Some(serde_json::Value::String(t)) => t == "Recipe",
        Some(serde_json::Value::Array(ts)) => ts.iter().any(|t| t == "Recipe"),
        _ => false,
    }
}

/// The first schema.org Recipe object anywhere in a JSON-LD value (top level, arrays, @graph).
fn find_recipe(v: &serde_json::Value) -> Option<&serde_json::Value> {
    match v {
        serde_json::Value::Object(map) => {
            if is_recipe(v) {
                return Some(v);
            }
            map.values().find_map(find_recipe)
        }
        serde_json::Value::Array(items) => items.iter().find_map(find_recipe),
        _ => None,
    }
}

fn text_of(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(clean_text(s)),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Array(a) => a.iter().find_map(text_of),
        serde_json::Value::Object(o) => o.get("text").or_else(|| o.get("name")).or_else(|| o.get("url")).and_then(text_of),
        _ => None,
    }
    .filter(|s| !s.is_empty())
}

/// recipeInstructions: a string, a list of strings, HowToSteps, or HowToSections of HowToSteps.
fn steps_of(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => {
            // one long string: split on line breaks when it has them
            for part in s.split(['\n', '\r']).map(clean_text).filter(|p| !p.is_empty()) {
                out.push(part);
            }
        }
        serde_json::Value::Array(items) => items.iter().for_each(|i| steps_of(i, out)),
        serde_json::Value::Object(o) => {
            if let Some(list) = o.get("itemListElement") {
                steps_of(list, out);
            } else if let Some(t) = o.get("text").and_then(text_of) {
                out.push(t);
            }
        }
        _ => {}
    }
}

/// Read a recipe out of a page's JSON-LD (what Google's recipe cards use); title-only if there's none.
pub fn recipe_from_html(html: &str) -> RecipeInfo {
    let lower = html.to_ascii_lowercase();
    let mut from = 0;
    while let Some(at) = lower[from..].find("<script") {
        let start = from + at;
        let Some(open_end) = lower[start..].find('>').map(|i| start + i + 1) else { break };
        let Some(close) = lower[open_end..].find("</script>").map(|i| open_end + i) else { break };
        from = close + 9;
        if !lower[start..open_end].contains("application/ld+json") {
            continue;
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(html[open_end..close].trim()) else { continue };
        let Some(r) = find_recipe(&json) else { continue };
        let mut steps = vec![];
        if let Some(i) = r.get("recipeInstructions") {
            steps_of(i, &mut steps);
        }
        let ingredients = r
            .get("recipeIngredient")
            .or_else(|| r.get("ingredients"))
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(text_of).collect())
            .unwrap_or_default();
        return RecipeInfo {
            title: r.get("name").and_then(text_of).or_else(|| title_of(html)).unwrap_or_default(),
            ingredients,
            steps,
            servings: r.get("recipeYield").and_then(text_of),
            total_time: r.get("totalTime").and_then(text_of),
            image: r.get("image").and_then(text_of),
        };
    }
    RecipeInfo { title: title_of(html).unwrap_or_default(), ..Default::default() }
}

/// Fetch a recipe page and read its recipe. Errors only when the page can't be read at all.
#[tauri::command]
pub async fn recipe_from_url(url: String) -> Result<RecipeInfo, String> {
    let html = fetch_html(&url, 15, 4 * 1024 * 1024).await.ok_or("Couldn't open that page (is it a public recipe page?)")?;
    Ok(recipe_from_html(&html))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recipes_from_json_ld() {
        let html = r#"<html><head><title>Best Chilli | Food Site</title>
        <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
          {"@type":["Recipe"],"name":"Best Chilli &amp; Rice","recipeYield":["4","4 servings"],"totalTime":"PT1H30M",
           "image":{"@type":"ImageObject","url":"https://img/x.jpg"},
           "recipeIngredient":["2 onions, <b>chopped</b>","1 tin kidney beans"],
           "recipeInstructions":[{"@type":"HowToSection","name":"Prep","itemListElement":[{"@type":"HowToStep","text":"Chop the onions."}]},
                                 {"@type":"HowToStep","text":"Simmer for an hour."}]}]}
        </script></head></html>"#;
        let r = recipe_from_html(html);
        assert_eq!(r.title, "Best Chilli & Rice");
        assert_eq!(r.ingredients, vec!["2 onions, chopped", "1 tin kidney beans"]);
        assert_eq!(r.steps, vec!["Chop the onions.", "Simmer for an hour."]);
        assert_eq!(r.servings.as_deref(), Some("4"));
        assert_eq!(r.total_time.as_deref(), Some("PT1H30M"));
        assert_eq!(r.image.as_deref(), Some("https://img/x.jpg"));
    }

    #[test]
    fn recipes_with_plain_instructions_or_none() {
        let html = r#"<script type='application/ld+json'>[{"@type":"Recipe","name":"Toast","recipeIngredient":["bread"],"recipeInstructions":"Toast it.\nButter it."}]</script>"#;
        let r = recipe_from_html(html);
        assert_eq!(r.steps, vec!["Toast it.", "Butter it."]);
        let none = recipe_from_html("<title>Just a blog</title><script>var x = 1;</script>");
        assert_eq!(none, RecipeInfo { title: "Just a blog".into(), ..Default::default() });
    }

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

#[cfg(test)]
mod live {
    /// Real network: `cargo test -- --ignored live_recipe`
    #[test]
    #[ignore]
    fn live_recipe_sites() {
        for url in [
            "https://www.recipetineats.com/chilli-con-carne/",
            "https://www.bbcgoodfood.com/recipes/chilli-con-carne-recipe",
        ] {
            match tauri::async_runtime::block_on(super::recipe_from_url(url.into())) {
                Ok(r) => println!(
                    "{url}\n  title={:?} ingredients={} steps={} servings={:?} time={:?} first={:?}\n  steps={:#?}",
                    r.title,
                    r.ingredients.len(),
                    r.steps.len(),
                    r.servings,
                    r.total_time,
                    r.ingredients.first(),
                    &r.steps[..r.steps.len().min(4)]
                ),
                Err(e) => println!("{url}\n  error: {e}"),
            }
        }
    }
}

