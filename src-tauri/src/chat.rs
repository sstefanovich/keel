//! The Claude chat sidebar: runs Claude Code headless (`claude -p` with stream-json in and out)
//! in the Hold folder. Each line Claude prints is a JSON message, sent to the webview as a
//! `chat-line` event; the webview writes user messages and permission answers back as lines.

use crate::pty::{claude_dirs, find_claude};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct Session {
    stdin: ChildStdin,
    child: Child,
}

#[derive(Default)]
pub struct Chats {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
struct Line {
    id: u32,
    line: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    /// The end of what Claude wrote to stderr, to explain an unexpected exit.
    error: String,
}

/// Keep only the last few KB of stderr.
const STDERR_TAIL: usize = 4096;

/// Start a chat session. `resume` continues an earlier conversation by its session id.
#[tauri::command]
pub fn chat_spawn(app: AppHandle, state: State<Chats>, cwd: String, resume: Option<String>) -> Result<u32, String> {
    let claude = find_claude().ok_or("Claude Code isn't installed")?;
    let is_cmd = claude.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd"));
    let mut cmd = if is_cmd {
        let mut c = Command::new("cmd.exe");
        c.arg("/c").arg(&claude);
        c
    } else {
        Command::new(&claude)
    };
    cmd.args([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        // permission prompts and questions come back to us as control requests
        "--permission-prompt-tool",
        "stdio",
    ]);
    if let Some(id) = resume.filter(|s| !s.is_empty()) {
        cmd.args(["--resume", &id]);
    }
    cmd.current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut path = claude_dirs();
    if let Some(p) = std::env::var_os("PATH") {
        path.extend(std::env::split_paths(&p));
    }
    if let Ok(joined) = std::env::join_paths(path) {
        cmd.env("PATH", joined);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;

    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().unwrap().insert(id, Session { stdin, child });

    let tail = Arc::new(Mutex::new(Vec::<u8>::new()));
    let err_reader = {
        let tail = tail.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut t = tail.lock().unwrap();
                t.extend_from_slice(&buf[..n]);
                let excess = t.len().saturating_sub(STDERR_TAIL);
                t.drain(..excess);
            }
        })
    };
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if !line.trim().is_empty() {
                let _ = app.emit("chat-line", Line { id, line });
            }
        }
        let _ = err_reader.join();
        let error = String::from_utf8_lossy(&tail.lock().unwrap()).trim().to_string();
        let _ = app.emit("chat-exit", Exit { id, error });
    });
    Ok(id)
}

/// Write one JSON message (a line) to Claude.
#[tauri::command]
pub fn chat_send(state: State<Chats>, id: u32, line: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let s = sessions.get_mut(&id).ok_or("Claude isn't running")?;
    s.stdin.write_all(line.trim_end().as_bytes()).map_err(|e| e.to_string())?;
    s.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    s.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn chat_kill(state: State<Chats>, id: u32) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
    Ok(())
}
