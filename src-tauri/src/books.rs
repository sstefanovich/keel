//! Book lookup for the personal Books page: Open Library's search (free, no key) turns a title,
//! author or ISBN into a few candidates with author, year, pages and a cover.

use std::time::Duration;

#[derive(serde::Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookHit {
    title: String,
    authors: Vec<String>,
    year: Option<i64>,
    pages: Option<i64>,
    /// A 13-digit ISBN when the catalogue has one (else a 10-digit one)
    isbn: Option<String>,
    /// Large cover image URL
    cover: Option<String>,
    /// Open Library work id ("/works/OL45804W"), to link back to it
    key: Option<String>,
}

fn strs(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|s| s.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

/// The candidates in an Open Library search response, in its order (best match first).
pub fn book_hits(json: &serde_json::Value) -> Vec<BookHit> {
    let Some(docs) = json.get("docs").and_then(|d| d.as_array()) else { return vec![] };
    docs.iter()
        .filter_map(|d| {
            let title = d.get("title")?.as_str()?.trim().to_string();
            if title.is_empty() {
                return None;
            }
            let isbns = strs(d.get("isbn"));
            let isbn = isbns.iter().find(|i| i.len() == 13).or_else(|| isbns.first()).cloned();
            Some(BookHit {
                title,
                authors: strs(d.get("author_name")).into_iter().take(3).collect(),
                year: d.get("first_publish_year").and_then(|y| y.as_i64()),
                pages: d.get("number_of_pages_median").and_then(|p| p.as_i64()),
                isbn,
                cover: d.get("cover_i").and_then(|c| c.as_i64()).map(|id| format!("https://covers.openlibrary.org/b/id/{id}-L.jpg")),
                key: d.get("key").and_then(|k| k.as_str()).map(String::from),
            })
        })
        .collect()
}

/// Look a book up by title, author or ISBN. Errors only when Open Library can't be reached.
#[tauri::command]
pub async fn book_search(query: String) -> Result<Vec<BookHit>, String> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(vec![]);
    }
    let digits: String = q.chars().filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x').collect();
    let is_isbn = (digits.len() == 10 || digits.len() == 13) && q.chars().all(|c| c.is_ascii_digit() || "-xX ".contains(c));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        // Open Library asks API clients to say who they are
        .user_agent("Keel/0.1 (personal book list; https://github.com/sstefanovich/keel)")
        .build()
        .map_err(|e| e.to_string())?;
    let param = if is_isbn { ("isbn", digits.as_str()) } else { ("q", q) };
    let res = client
        .get("https://openlibrary.org/search.json")
        .query(&[param, ("limit", "8"), ("fields", "key,title,author_name,first_publish_year,number_of_pages_median,isbn,cover_i")])
        .send()
        .await
        .map_err(|_| "Couldn't reach Open Library (are you online?)".to_string())?;
    if !res.status().is_success() {
        return Err(format!("Open Library didn't answer ({})", res.status()));
    }
    let body = res.bytes().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_slice(&body).map_err(|_| "Open Library sent something unexpected".to_string())?;
    Ok(book_hits(&json))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_search_results() {
        let json = serde_json::json!({ "docs": [
            { "key": "/works/OL1W", "title": "Project Hail Mary", "author_name": ["Andy Weir"], "first_publish_year": 2021,
              "number_of_pages_median": 496, "isbn": ["0593135202", "9780593135204"], "cover_i": 11200092 },
            { "title": "  " },
            { "title": "Untitled Notes" }
        ]});
        let hits = book_hits(&json);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].title, "Project Hail Mary");
        assert_eq!(hits[0].authors, vec!["Andy Weir"]);
        assert_eq!(hits[0].isbn.as_deref(), Some("9780593135204"));
        assert_eq!(hits[0].cover.as_deref(), Some("https://covers.openlibrary.org/b/id/11200092-L.jpg"));
        assert_eq!(hits[1], BookHit { title: "Untitled Notes".into(), ..Default::default() });
        assert!(book_hits(&serde_json::json!({})).is_empty());
    }
}

#[cfg(test)]
mod live {
    /// Real network: `cargo test -- --ignored live_books`
    #[test]
    #[ignore]
    fn live_books() {
        for q in ["project hail mary", "9780593135204"] {
            let r = tauri::async_runtime::block_on(super::book_search(q.into()));
            println!("{q}: {r:#?}");
        }
    }
}
