//! TLS certificate generation and management.
//!
//! On first run, generates a self-signed root CA and a device certificate
//! covering `localhost` and the machine's LAN IP. The root CA is installed
//! into the Windows certificate store so that devices on the same network
//! can trust the HTTPS endpoint without browser warnings.

use anyhow::{Context, Result};
use rcgen::{
    BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose,
    IsCa, KeyPair, SanType,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio_rustls::rustls::ServerConfig;
use tracing::info;

/// Paths for persisted certificate files.
pub struct CertPaths {
    pub cert_pem: PathBuf,
    pub key_pem: PathBuf,
    pub ca_cert_pem: PathBuf,
}

impl CertPaths {
    fn new(dir: &Path) -> Self {
        Self {
            cert_pem: dir.join("cert.pem"),
            key_pem: dir.join("key.pem"),
            ca_cert_pem: dir.join("ca.pem"),
        }
    }

    fn all_exist(&self) -> bool {
        self.cert_pem.exists() && self.key_pem.exists() && self.ca_cert_pem.exists()
    }
}

/// Ensures a valid TLS cert exists in `cert_dir`, generating one if needed.
/// Returns a rustls `ServerConfig` ready for use with `axum-server`.
pub fn ensure_cert(cert_dir: &Path, local_ip: &str) -> Result<Arc<ServerConfig>> {
    std::fs::create_dir_all(cert_dir).context("Failed to create cert directory")?;

    let paths = CertPaths::new(cert_dir);

    if !paths.all_exist() {
        info!("Generating new TLS certificate for IP: {}", local_ip);
        generate_and_save(&paths, local_ip).context("Certificate generation failed")?;

        // Install the CA into the Windows trust store so LAN devices trust us
        #[cfg(target_os = "windows")]
        install_ca_windows(&paths.ca_cert_pem).context("Failed to install CA into Windows store")?;
    } else {
        info!("Using existing TLS certificate from {:?}", cert_dir);
    }

    load_server_config(&paths)
}

/// Generates a root CA + a device certificate signed by that CA.
fn generate_and_save(paths: &CertPaths, local_ip: &str) -> Result<()> {
    // ── Root CA ──────────────────────────────────────────────────────────────
    let ca_key = KeyPair::generate()?;
    let mut ca_params = CertificateParams::default();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params.distinguished_name = {
        let mut dn = DistinguishedName::new();
        dn.push(DnType::OrganizationName, "Cam2PC Local CA");
        dn.push(DnType::CommonName, "Cam2PC Root CA");
        dn
    };
    // Valid for 10 years
    ca_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    ca_params.not_after = rcgen::date_time_ymd(2034, 1, 1);

    let ca_cert = ca_params.self_signed(&ca_key)?;

    // ── Device certificate ───────────────────────────────────────────────────
    let device_key = KeyPair::generate()?;
    let mut device_params = CertificateParams::default();
    device_params.distinguished_name = {
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, "Cam2PC Device");
        dn
    };
    device_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    device_params.subject_alt_names = vec![
        SanType::DnsName("localhost".try_into()?),
        SanType::IpAddress(std::net::IpAddr::V4("127.0.0.1".parse()?)),
        SanType::IpAddress(std::net::IpAddr::V4(local_ip.parse().unwrap_or([127, 0, 0, 1].into()))),
    ];
    device_params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    device_params.not_after = rcgen::date_time_ymd(2026, 1, 1);

    let device_cert = device_params.signed_by(&device_key, &ca_cert, &ca_key)?;

    // ── Persist ──────────────────────────────────────────────────────────────
    std::fs::write(&paths.ca_cert_pem, ca_cert.pem())?;
    std::fs::write(&paths.cert_pem, device_cert.pem())?;
    std::fs::write(&paths.key_pem, device_key.serialize_pem())?;

    info!("TLS certificate written to {:?}", paths.cert_pem.parent().unwrap());
    Ok(())
}

/// Loads a rustls `ServerConfig` from PEM files on disk.
fn load_server_config(paths: &CertPaths) -> Result<Arc<ServerConfig>> {
    let cert_pem = std::fs::read(&paths.cert_pem)?;
    let key_pem = std::fs::read(&paths.key_pem)?;

    let certs = rustls_pemfile::certs(&mut cert_pem.as_slice())
        .collect::<Result<Vec<_>, _>>()
        .context("Failed to parse certificate PEM")?;

    let key = rustls_pemfile::private_key(&mut key_pem.as_slice())
        .context("Failed to parse private key PEM")?
        .context("No private key found in key.pem")?;

    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("Failed to build TLS ServerConfig")?;

    Ok(Arc::new(config))
}

/// Installs the CA certificate into the Windows "Root" certificate store
/// so that browsers on this machine (and other LAN devices pointing here)
/// trust our self-signed certificate without warnings.
#[cfg(target_os = "windows")]
fn install_ca_windows(ca_path: &Path) -> Result<()> {
    use std::process::Command;

    info!("Installing CA certificate into Windows Root store…");

    // certutil -addstore -f Root <ca.pem>
    let output = Command::new("certutil")
        .args(["-addstore", "-f", "Root", ca_path.to_str().unwrap_or_default()])
        .output()
        .context("Failed to run certutil")?;

    if output.status.success() {
        info!("CA certificate installed successfully");
    } else {
        // Non-fatal: user may not be running as admin, or cert already installed
        tracing::warn!(
            "certutil returned non-zero: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(())
}
