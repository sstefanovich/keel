//! Pseudo-terminals for the Claude panel: runs Claude Code (`claude`) in the Hold folder
//! and streams its output to the webview as `pty-output` events.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
struct Output {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
}

fn home() -> Option<PathBuf> {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

/// Folders Claude Code installs into. Keel may have been started before Claude Code was
/// installed (or the installer didn't touch PATH), so don't rely on the inherited PATH alone.
fn claude_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(h) = home() {
        dirs.push(h.join(".local").join("bin"));
        dirs.push(h.join(".claude").join("local"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    dirs
}

/// Locate the Claude Code CLI. Deliberately ignores the Claude *desktop app*
/// (…\AnthropicClaude\claude.exe), which shares the executable name.
fn find_claude() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    let path_dirs = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default();
    claude_dirs()
        .into_iter()
        .chain(path_dirs)
        .filter(|d| !d.to_string_lossy().to_lowercase().contains("anthropicclaude"))
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .find(|p| p.is_file())
}

/// Path to Claude Code, or None if it isn't installed (the panel shows install help).
#[tauri::command]
pub fn claude_path() -> Option<String> {
    find_claude().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn pty_spawn(app: AppHandle, state: State<Ptys>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let claude = find_claude().ok_or("Claude Code isn't installed")?;
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let is_cmd = claude.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd"));
    let mut cmd = if is_cmd {
        let mut c = CommandBuilder::new("cmd.exe");
        c.args(["/c".into(), claude.clone().into_os_string()]);
        c
    } else {
        CommandBuilder::new(&claude)
    };
    cmd.cwd(&cwd);
    // so Claude's own tools (and anything it shells out to) can find the CLI too
    let mut path = claude_dirs();
    if let Some(p) = std::env::var_os("PATH") {
        path.extend(std::env::split_paths(&p));
    }
    if let Ok(joined) = std::env::join_paths(path) {
        cmd.env("PATH", joined);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().unwrap().insert(id, Session { master: pair.master, writer, child });

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    // don't split a multi-byte UTF-8 character across two events
                    let valid = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => pending.len(),
                    };
                    if valid > 0 {
                        let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
                        pending.drain(..valid);
                        let _ = app.emit("pty-output", Output { id, data });
                    }
                }
            }
        }
        let _ = app.emit("pty-exit", Exit { id });
    });
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let s = sessions.get_mut(&id).ok_or("terminal closed")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let s = sessions.get(&id).ok_or("terminal closed")?;
    s.master
        .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<Ptys>, id: u32) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_picks_the_desktop_app() {
        if let Some(p) = find_claude() {
            assert!(!p.to_string_lossy().to_lowercase().contains("anthropicclaude"), "{p:?}");
        }
    }

    /// Runs a real command through a pseudo-terminal and reads its output back.
    #[test]
    fn pty_round_trip() {
        let pair = native_pty_system()
            .openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 })
            .unwrap();
        let mut cmd = if cfg!(windows) {
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/c", "echo keel-pty-ok"]);
            c
        } else {
            let mut c = CommandBuilder::new("sh");
            c.args(["-c", "echo keel-pty-ok"]);
            c
        };
        cmd.cwd(std::env::temp_dir());
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        let mut out = String::new();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !out.contains("keel-pty-ok") && std::time::Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(std::time::Duration::from_millis(200)) {
                let text = String::from_utf8_lossy(&chunk);
                // Windows ConPTY asks for the cursor position at startup and waits for the
                // answer (xterm.js gives it in the app); answer it here like a terminal would
                if text.contains("\x1b[6n") {
                    writer.write_all(b"\x1b[1;1R").unwrap();
                    writer.flush().unwrap();
                }
                out.push_str(&text);
            }
        }
        let _ = child.kill();
        assert!(out.contains("keel-pty-ok"), "got: {out:?}");
    }
}
