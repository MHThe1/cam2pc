//! NDI bridge process lifecycle management.
//!
//! The NDI feature spawns a Node.js child process (`node ndi-bridge.js`)
//! that uses the `grandiose` npm package to output frames as an NDI source.
//!
//! The bridge script lives at `<project-root>/sidecar/ndi-bridge.js` during
//! development, and will be bundled alongside the app in production.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tracing::{info, warn};

/// Global handle to the running NDI bridge child process.
static NDI_CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// Resolves the path to `ndi-bridge.js`.
/// In dev, it's at `<workspace-root>/sidecar/ndi-bridge.js`.
/// In production it will be bundled next to the executable.
fn bridge_script_path() -> PathBuf {
    // In production: next to the .exe
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("ndi-bridge.js")));

    if let Some(path) = exe_dir {
        if path.exists() {
            return path;
        }
    }

    // In development: project root sidecar/
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("ndi-bridge.js"))
        .unwrap_or_else(|| PathBuf::from("sidecar/ndi-bridge.js"));

    dev_path
}

/// Starts the NDI bridge by spawning `node ndi-bridge.js`.
/// Returns `Ok(true)` if started, `Ok(false)` if already running.
pub fn start() -> Result<bool, String> {
    let mut guard = NDI_CHILD.lock().map_err(|e| e.to_string())?;

    if guard.is_some() {
        return Ok(false);
    }

    let script = bridge_script_path();

    if !script.exists() {
        return Err(format!(
            "NDI bridge script not found at {:?}. Run `npm install` in the sidecar/ directory.",
            script
        ));
    }

    let child = Command::new("node")
        .arg(&script)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn NDI bridge (is Node.js installed?): {e}"))?;

    *guard = Some(child);
    info!("NDI bridge started (script: {:?})", script);
    Ok(true)
}

/// Stops the NDI bridge process.
pub fn stop() -> Result<(), String> {
    let mut guard = NDI_CHILD.lock().map_err(|e| e.to_string())?;

    if let Some(mut child) = guard.take() {
        child.kill().map_err(|e| format!("Failed to kill NDI bridge: {e}"))?;
        info!("NDI bridge stopped");
    } else {
        warn!("NDI stop requested but bridge was not running");
    }

    Ok(())
}

/// Returns whether the NDI bridge is currently running.
pub fn is_running() -> bool {
    NDI_CHILD
        .lock()
        .map(|mut g| {
            // Also check if the process has exited unexpectedly
            if let Some(child) = g.as_mut() {
                match child.try_wait() {
                    Ok(Some(_)) => {
                        // Process exited — clean up
                        g.take();
                        false
                    }
                    Ok(None) => true, // Still running
                    Err(_) => false,
                }
            } else {
                false
            }
        })
        .unwrap_or(false)
}
