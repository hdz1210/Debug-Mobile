use crate::diagnostics;
use crate::event_parser::BodyFormat;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

fn decode_body(data: &str, format: BodyFormat) -> Result<Vec<u8>, String> {
    match format {
        BodyFormat::Text => Ok(data.as_bytes().to_vec()),
        BodyFormat::Base64 => STANDARD
            .decode(data)
            .map_err(|error| format!("Cannot decode captured binary body: {error}")),
    }
}

#[tauri::command]
pub fn save_captured_body(
    app: tauri::AppHandle,
    path: String,
    data: String,
    format: BodyFormat,
) -> Result<(), String> {
    let result = save_captured_body_to_path(path, data, format);
    if let Err(error) = &result {
        diagnostics::write_error(&app, "file", error);
    }
    result
}

fn save_captured_body_to_path(
    path: String,
    data: String,
    format: BodyFormat,
) -> Result<(), String> {
    let destination = PathBuf::from(path);
    if !destination.is_absolute() {
        return Err("The selected body destination must be an absolute path.".to_owned());
    }
    if destination.is_dir() {
        return Err("The selected body destination is a directory.".to_owned());
    }

    let bytes = decode_body(&data, format)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&destination)
        .map_err(|error| format!("Cannot create body file: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("Cannot write body file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::decode_body;
    use crate::event_parser::BodyFormat;

    #[test]
    fn decodes_text_and_base64_bodies() {
        assert_eq!(
            decode_body("hello", BodyFormat::Text).expect("text should decode"),
            b"hello"
        );
        assert_eq!(
            decode_body("AAEC/w==", BodyFormat::Base64).expect("base64 should decode"),
            [0, 1, 2, 255]
        );
    }

    #[test]
    fn rejects_invalid_base64() {
        assert!(decode_body("not base64!", BodyFormat::Base64).is_err());
    }
}
