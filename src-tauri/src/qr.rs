//! QR code generation.
//!
//! Encodes a URL as a QR code and returns it as a base64-encoded PNG string
//! suitable for embedding in HTML: `<img src="data:image/png;base64,…">`.

use anyhow::{Context, Result};
use base64::Engine as _;
use image::{ImageBuffer, Luma};
use qrcode::QrCode;

/// Generates a QR code for `url` and returns a `data:image/png;base64,…` string.
pub fn url_to_data_url(url: &str) -> Result<String> {
    let code = QrCode::new(url.as_bytes()).context("Failed to encode URL as QR code")?;

    // Render to a luma image at 10px per module with 4-module quiet zone
    let image: ImageBuffer<Luma<u8>, Vec<u8>> = code
        .render::<Luma<u8>>()
        .min_dimensions(300, 300)
        .max_dimensions(600, 600)
        .quiet_zone(true)
        .build();

    // Encode as PNG bytes
    let mut png_bytes: Vec<u8> = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png_bytes),
            image::ImageFormat::Png,
        )
        .context("Failed to encode QR code as PNG")?;

    // Base64-encode and wrap as data URL
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}
