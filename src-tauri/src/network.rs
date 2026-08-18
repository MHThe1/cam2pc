//! Local network IP detection.

use tracing::warn;

/// Returns the primary non-loopback IPv4 address of this machine, or `None`.
pub fn local_ip() -> Option<String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| {
            warn!("Could not determine local IP: {}", e);
            e
        })
        .ok()
}
