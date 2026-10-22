//! File access for the Hold. Every path from the frontend is relative to the hold
//! root and must stay inside it.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct Entry {
    path: String,
    mtime: u64,
}

fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    let safe = !rel.is_empty()
        && rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !safe {
        return Err(format!("Invalid path: {rel}"));
    }
    Ok(Path::new(root).join(rel_path))
}

fn mtime_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue; // .keel, .git, .obsidian, …
        }
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            walk(root, &path, out)?;
        } else if ft.is_file() && name.to_lowercase().ends_with(".md") {
            let rel = path.strip_prefix(root).unwrap_or(&path);
            let rel = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            out.push(Entry { path: rel, mtime: mtime_ms(&path) });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn hold_list(root: String) -> Result<Vec<Entry>, String> {
    let root_path = Path::new(&root);
    fs::create_dir_all(root_path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    walk(root_path, root_path, &mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn hold_read(root: String, path: String) -> Result<String, String> {
    fs::read_to_string(resolve(&root, &path)?).map_err(|e| e.to_string())
}

/// Writes via a temp file + rename so a crash never leaves a half-written note.
#[tauri::command]
pub fn hold_write(root: String, path: String, content: String) -> Result<(), String> {
    let target = resolve(&root, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("md.keel-tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[tauri::command]
pub fn hold_exists(root: String, path: String) -> Result<bool, String> {
    Ok(resolve(&root, &path)?.exists())
}

#[tauri::command]
pub fn hold_remove(root: String, path: String) -> Result<(), String> {
    fs::remove_file(resolve(&root, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn hold_rename(root: String, from: String, to: String) -> Result<(), String> {
    let src = resolve(&root, &from)?;
    let dst = resolve(&root, &to)?;
    if dst.exists() {
        return Err(format!("{to} already exists"));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(src, dst).map_err(|e| e.to_string())
}

fn walk_dirs(root: &Path, dir: &Path, out: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') || !entry.file_type()?.is_dir() {
            continue;
        }
        let path = entry.path();
        let rel = path.strip_prefix(root).unwrap_or(&path);
        out.push(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"));
        walk_dirs(root, &path, out)?;
    }
    Ok(())
}

/// Every folder in the hold (relative, "/"-separated), including empty ones.
#[tauri::command]
pub fn hold_dirs(root: String) -> Result<Vec<String>, String> {
    let root_path = Path::new(&root);
    let mut out = Vec::new();
    if root_path.exists() {
        walk_dirs(root_path, root_path, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[tauri::command]
pub fn hold_mkdir(root: String, path: String) -> Result<(), String> {
    fs::create_dir_all(resolve(&root, &path)?).map_err(|e| e.to_string())
}

/// Removes a folder only if it's empty (never deletes notes).
#[tauri::command]
pub fn hold_rmdir(root: String, path: String) -> Result<(), String> {
    fs::remove_dir(resolve(&root, &path)?).map_err(|_| format!("{path} isn't empty"))
}

/// Saves an export (e.g. timesheet CSV) to a path the user picked in a save dialog.
#[tauri::command]
pub fn save_export(path: String, content: String) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::resolve;

    #[test]
    fn rejects_escapes() {
        assert!(resolve("C:/hold", "../x.md").is_err());
        assert!(resolve("C:/hold", "a/../../x.md").is_err());
        assert!(resolve("C:/hold", "C:/Windows/x.md").is_err());
        assert!(resolve("C:/hold", "/etc/x.md").is_err());
        assert!(resolve("C:/hold", "").is_err());
        assert!(resolve("C:/hold", "logs/2026/2026-10-19.md").is_ok());
    }
}
