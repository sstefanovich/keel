//! File history for the Hold: periodic snapshots kept in a git repository in the Hold folder
//! (libgit2 is built in, so git doesn't need to be installed). Snapshots are local commits only;
//! nothing is pushed anywhere. An existing repository (the owner's own) is used as is.

use git2::{IndexAddOption, ObjectType, Oid, Repository, RepositoryOpenFlags, Signature, Sort};
use serde::Serialize;
use std::path::{Component, Path};

const IGNORE: &str = "# Keel's temporary files\n*.keel-tmp\n*.tmp\n";

fn open_or_init(root: &str) -> Result<Repository, String> {
    let dir = Path::new(root);
    // only a repository at the hold root itself, never a parent folder's
    match Repository::open_ext(dir, RepositoryOpenFlags::NO_SEARCH, std::iter::empty::<&std::ffi::OsStr>()) {
        Ok(r) => Ok(r),
        Err(_) => {
            let r = Repository::init(dir).map_err(|e| e.message().to_string())?;
            let ignore = dir.join(".gitignore");
            if !ignore.exists() {
                std::fs::write(&ignore, IGNORE).map_err(|e| e.to_string())?;
            }
            Ok(r)
        }
    }
}

fn open(root: &str) -> Result<Option<Repository>, String> {
    match Repository::open_ext(Path::new(root), RepositoryOpenFlags::NO_SEARCH, std::iter::empty::<&std::ffi::OsStr>()) {
        Ok(r) => Ok(Some(r)),
        Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(e) => Err(e.message().to_string()),
    }
}

/// Paths come from the UI: relative, forward slashes, no `..`.
fn check(rel: &str) -> Result<(), String> {
    let ok = !rel.is_empty() && Path::new(rel).components().all(|c| matches!(c, Component::Normal(_)));
    if ok { Ok(()) } else { Err(format!("Invalid path: {rel}")) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    id: String,
    time: i64,
}

/// Commit everything that changed since the last snapshot. None when nothing changed.
pub fn snapshot(root: &str, message: &str) -> Result<Option<Snapshot>, String> {
    let err = |e: git2::Error| e.message().to_string();
    let repo = open_or_init(root)?;
    let mut index = repo.index().map_err(err)?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None).map_err(err)?;
    index.update_all(["*"].iter(), None).map_err(err)?;
    index.write().map_err(err)?;
    let tree_id = index.write_tree().map_err(err)?;
    let parent = match repo.head() {
        Ok(h) => Some(h.peel_to_commit().map_err(err)?),
        Err(_) => None, // first snapshot
    };
    if parent.as_ref().is_some_and(|p| p.tree_id() == tree_id) {
        return Ok(None);
    }
    let tree = repo.find_tree(tree_id).map_err(err)?;
    let sig = Signature::now("Keel", "keel@localhost").map_err(err)?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let id = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents).map_err(err)?;
    Ok(Some(Snapshot { id: id.to_string(), time: sig.when().seconds() * 1000 }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    id: String,
    /// ms since the epoch
    time: i64,
    message: String,
    /// The file doesn't exist in this version (it was deleted then)
    deleted: bool,
}

fn blob_at(commit: &git2::Commit, rel: &str) -> Option<Oid> {
    let entry = commit.tree().ok()?.get_path(Path::new(rel)).ok()?;
    (entry.kind() == Some(ObjectType::Blob)).then(|| entry.id())
}

/// Snapshots in which a file changed, newest first.
pub fn file_versions(root: &str, rel: &str, limit: usize) -> Result<Vec<Version>, String> {
    check(rel)?;
    let err = |e: git2::Error| e.message().to_string();
    let Some(repo) = open(root)? else { return Ok(vec![]) };
    let mut walk = repo.revwalk().map_err(err)?;
    if walk.push_head().is_err() {
        return Ok(vec![]); // no snapshots yet
    }
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).map_err(err)?;
    let mut out = vec![];
    for oid in walk {
        let commit = repo.find_commit(oid.map_err(err)?).map_err(err)?;
        let here = blob_at(&commit, rel);
        let before = commit.parent(0).ok().and_then(|p| blob_at(&p, rel));
        if here != before {
            out.push(Version {
                id: commit.id().to_string(),
                time: commit.time().seconds() * 1000,
                message: commit.summary().unwrap_or("").to_string(),
                deleted: here.is_none(),
            });
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

/// A file's text in a snapshot.
pub fn file_at(root: &str, id: &str, rel: &str) -> Result<Option<String>, String> {
    check(rel)?;
    let err = |e: git2::Error| e.message().to_string();
    let Some(repo) = open(root)? else { return Ok(None) };
    let commit = repo.find_commit(Oid::from_str(id).map_err(err)?).map_err(err)?;
    let Some(blob_id) = blob_at(&commit, rel) else { return Ok(None) };
    let blob = repo.find_blob(blob_id).map_err(err)?;
    Ok(Some(String::from_utf8_lossy(blob.content()).into_owned()))
}

// Snapshots walk the whole folder, so they run off the main thread.

#[tauri::command]
pub async fn history_snapshot(root: String, message: Option<String>) -> Result<Option<Snapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || snapshot(&root, message.as_deref().unwrap_or("Keel snapshot")))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_versions(root: String, path: String, limit: Option<usize>) -> Result<Vec<Version>, String> {
    tauri::async_runtime::spawn_blocking(move || file_versions(&root, &path, limit.unwrap_or(100)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn history_read(root: String, id: String, path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || file_at(&root, &id, &path)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("keel-history-{}-{}", std::process::id(), rand_suffix()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn snapshots_versions_and_reads() {
        let dir = temp();
        let root = dir.to_str().unwrap();
        std::fs::create_dir_all(dir.join("notes")).unwrap();
        std::fs::write(dir.join("notes/a.md"), "one\n").unwrap();
        std::fs::write(dir.join("notes/b.md"), "bee\n").unwrap();
        let first = snapshot(root, "first").unwrap().expect("first snapshot");
        assert!(snapshot(root, "nothing changed").unwrap().is_none());
        assert!(dir.join(".gitignore").exists());

        std::fs::write(dir.join("notes/a.md"), "two\n").unwrap();
        std::fs::write(dir.join("notes/x.md.keel-tmp"), "ignored").unwrap();
        let second = snapshot(root, "second").unwrap().expect("second snapshot");
        std::fs::remove_file(dir.join("notes/a.md")).unwrap();
        snapshot(root, "third").unwrap().expect("deletion is a change");

        let v = file_versions(root, "notes/a.md", 10).unwrap();
        assert_eq!(v.len(), 3);
        assert!(v[0].deleted);
        assert_eq!(v[1].id, second.id);
        assert_eq!(v[2].id, first.id);
        assert_eq!(file_at(root, &first.id, "notes/a.md").unwrap().as_deref(), Some("one\n"));
        assert_eq!(file_at(root, &second.id, "notes/a.md").unwrap().as_deref(), Some("two\n"));
        // b.md only changed in the first snapshot; temp files are never recorded
        assert_eq!(file_versions(root, "notes/b.md", 10).unwrap().len(), 1);
        assert!(file_versions(root, "notes/x.md.keel-tmp", 10).unwrap().is_empty());
        assert!(file_versions(root, "../outside.md", 10).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_repository_means_no_history() {
        let dir = temp();
        assert!(file_versions(dir.to_str().unwrap(), "notes/a.md", 10).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
