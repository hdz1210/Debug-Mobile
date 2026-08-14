use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const CERTIFICATE_FILE_NAME: &str = "mitmproxy-ca-cert.pem";
const CERTIFICATE_STATE_FILE_NAME: &str = "certificate-state.json";
const INSTALL_URL: &str = "http://mitm.it";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CertificateState {
    Missing,
    SetupRequired,
    Changed,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateStatus {
    pub state: CertificateState,
    pub certificate_path: Option<String>,
    pub fingerprint_sha256: Option<String>,
    pub created_at: Option<u64>,
    pub install_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CertificateStateFile {
    acknowledged_fingerprint_sha256: String,
}

pub fn prepare_certificate_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?;
    prepare_certificate_directory_at(&data_directory)
}

pub fn certificate_status(app: &AppHandle) -> Result<CertificateStatus, String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?;
    prepare_certificate_directory_at(&data_directory)?;
    certificate_status_at(&data_directory)
}

#[tauri::command]
pub fn get_certificate_status(app: AppHandle) -> Result<CertificateStatus, String> {
    certificate_status(&app)
}

#[tauri::command]
pub fn acknowledge_certificate(app: AppHandle) -> Result<CertificateStatus, String> {
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?;
    prepare_certificate_directory_at(&data_directory)?;

    let certificate_path = certificate_directory_at(&data_directory).join(CERTIFICATE_FILE_NAME);
    let fingerprint = certificate_fingerprint(&certificate_path)?;
    write_acknowledged_fingerprint(&data_directory, &fingerprint)?;
    certificate_status_at(&data_directory)
}

#[tauri::command]
pub fn reveal_certificate(app: AppHandle) -> Result<CertificateStatus, String> {
    let status = certificate_status(&app)?;
    let certificate_path = status
        .certificate_path
        .as_deref()
        .ok_or_else(|| "The proxy certificate has not been generated yet.".to_owned())?;
    app.opener()
        .reveal_item_in_dir(certificate_path)
        .map_err(|error| format!("Cannot open the certificate location: {error}"))?;
    Ok(status)
}

fn certificate_directory_at(data_directory: &Path) -> PathBuf {
    data_directory.join("certificates").join("mitmproxy")
}

fn legacy_certificate_directory_at(data_directory: &Path) -> PathBuf {
    data_directory.join("runtime").join("mitmproxy")
}

fn certificate_state_path(data_directory: &Path) -> PathBuf {
    data_directory.join(CERTIFICATE_STATE_FILE_NAME)
}

fn prepare_certificate_directory_at(data_directory: &Path) -> Result<PathBuf, String> {
    let certificate_directory = certificate_directory_at(data_directory);
    let legacy_directory = legacy_certificate_directory_at(data_directory);
    let legacy_certificate = legacy_directory.join(CERTIFICATE_FILE_NAME);
    let target_certificate = certificate_directory.join(CERTIFICATE_FILE_NAME);
    let should_migrate = legacy_certificate.is_file() && !target_certificate.is_file();

    if should_migrate {
        let parent = certificate_directory
            .parent()
            .ok_or_else(|| "Cannot resolve the certificate parent directory.".to_owned())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create certificate parent directory: {error}"))?;

        // Copy rather than move so downgrading to an older app version still
        // uses the exact same CA from the legacy runtime path.
        copy_directory_contents(&legacy_directory, &certificate_directory)?;
    }

    fs::create_dir_all(&certificate_directory)
        .map_err(|error| format!("Cannot create certificate directory: {error}"))?;

    // Existing installations already trusted this CA. Preserve that onboarding
    // state during the one-time move out of the disposable runtime directory.
    if should_migrate && !certificate_state_path(data_directory).is_file() {
        let fingerprint = certificate_fingerprint(&target_certificate)?;
        write_acknowledged_fingerprint(data_directory, &fingerprint)?;
    }

    Ok(certificate_directory)
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Cannot create migrated certificate directory: {error}"))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Cannot read legacy certificate directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot read certificate entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| format!("Cannot inspect certificate entry: {error}"))?
            .is_dir()
        {
            copy_directory_contents(&source_path, &destination_path)?;
        } else if !destination_path.exists() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("Cannot migrate certificate file: {error}"))?;
        }
    }
    Ok(())
}

fn certificate_status_at(data_directory: &Path) -> Result<CertificateStatus, String> {
    let certificate_path = certificate_directory_at(data_directory).join(CERTIFICATE_FILE_NAME);
    if !certificate_path.is_file() {
        return Ok(CertificateStatus {
            state: CertificateState::Missing,
            certificate_path: None,
            fingerprint_sha256: None,
            created_at: None,
            install_url: INSTALL_URL.to_owned(),
        });
    }

    let fingerprint = certificate_fingerprint(&certificate_path)?;
    let acknowledged = read_acknowledged_fingerprint(data_directory)?;
    let state = match acknowledged.as_deref() {
        None => CertificateState::SetupRequired,
        Some(previous) if previous == fingerprint => CertificateState::Ready,
        Some(_) => CertificateState::Changed,
    };
    let created_at = fs::metadata(&certificate_path)
        .ok()
        .and_then(|metadata| metadata.created().or_else(|_| metadata.modified()).ok())
        .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());

    Ok(CertificateStatus {
        state,
        certificate_path: Some(certificate_path.to_string_lossy().into_owned()),
        fingerprint_sha256: Some(fingerprint),
        created_at,
        install_url: INSTALL_URL.to_owned(),
    })
}

fn certificate_fingerprint(certificate_path: &Path) -> Result<String, String> {
    let pem = fs::read_to_string(certificate_path)
        .map_err(|error| format!("Cannot read proxy certificate: {error}"))?;
    let encoded = pem
        .split("-----BEGIN CERTIFICATE-----")
        .nth(1)
        .and_then(|value| value.split("-----END CERTIFICATE-----").next())
        .map(|value| value.lines().map(str::trim).collect::<String>())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The proxy certificate is not a valid PEM certificate.".to_owned())?;
    let der = STANDARD
        .decode(encoded)
        .map_err(|error| format!("Cannot decode proxy certificate: {error}"))?;
    let digest = Sha256::digest(der);
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

fn read_acknowledged_fingerprint(data_directory: &Path) -> Result<Option<String>, String> {
    let path = certificate_state_path(data_directory);
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read certificate state: {error}"))?;
    let state: CertificateStateFile = serde_json::from_str(&content)
        .map_err(|error| format!("Cannot parse certificate state: {error}"))?;
    Ok(Some(state.acknowledged_fingerprint_sha256))
}

fn write_acknowledged_fingerprint(data_directory: &Path, fingerprint: &str) -> Result<(), String> {
    fs::create_dir_all(data_directory)
        .map_err(|error| format!("Cannot create application data directory: {error}"))?;
    let content = serde_json::to_vec_pretty(&CertificateStateFile {
        acknowledged_fingerprint_sha256: fingerprint.to_owned(),
    })
    .map_err(|error| format!("Cannot serialize certificate state: {error}"))?;
    fs::write(certificate_state_path(data_directory), content)
        .map_err(|error| format!("Cannot save certificate state: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        CERTIFICATE_FILE_NAME, CertificateState, certificate_directory_at, certificate_fingerprint,
        certificate_status_at, prepare_certificate_directory_at, write_acknowledged_fingerprint,
    };
    use std::fs;
    use tempfile::tempdir;

    const TEST_CERTIFICATE: &str =
        "-----BEGIN CERTIFICATE-----\nAQIDBA==\n-----END CERTIFICATE-----\n";

    #[test]
    fn fingerprints_der_bytes_from_pem() {
        let directory = tempdir().expect("temp directory should be created");
        let certificate = directory.path().join("certificate.pem");
        fs::write(&certificate, TEST_CERTIFICATE).expect("certificate should be written");

        assert_eq!(
            certificate_fingerprint(&certificate).expect("fingerprint should be calculated"),
            "9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A"
        );
    }

    #[test]
    fn reports_setup_then_ready_after_acknowledgement() {
        let directory = tempdir().expect("temp directory should be created");
        let certificates = certificate_directory_at(directory.path());
        fs::create_dir_all(&certificates).expect("certificate directory should be created");
        fs::write(certificates.join(CERTIFICATE_FILE_NAME), TEST_CERTIFICATE)
            .expect("certificate should be written");

        let initial = certificate_status_at(directory.path()).expect("status should be available");
        assert_eq!(initial.state, CertificateState::SetupRequired);
        write_acknowledged_fingerprint(
            directory.path(),
            initial
                .fingerprint_sha256
                .as_deref()
                .expect("fingerprint should exist"),
        )
        .expect("acknowledgement should be saved");
        let ready = certificate_status_at(directory.path()).expect("status should be available");
        assert_eq!(ready.state, CertificateState::Ready);
    }

    #[test]
    fn migrates_and_acknowledges_the_legacy_certificate_directory() {
        let directory = tempdir().expect("temp directory should be created");
        let legacy = directory.path().join("runtime").join("mitmproxy");
        fs::create_dir_all(&legacy).expect("legacy directory should be created");
        fs::write(legacy.join(CERTIFICATE_FILE_NAME), TEST_CERTIFICATE)
            .expect("legacy certificate should be written");
        fs::write(legacy.join("mitmproxy-ca.pem"), "private material")
            .expect("legacy key should be written");

        let migrated = prepare_certificate_directory_at(directory.path())
            .expect("legacy certificates should migrate");
        assert!(migrated.join(CERTIFICATE_FILE_NAME).is_file());
        assert!(migrated.join("mitmproxy-ca.pem").is_file());
        assert!(legacy.join(CERTIFICATE_FILE_NAME).is_file());
        assert!(legacy.join("mitmproxy-ca.pem").is_file());
        let status = certificate_status_at(directory.path()).expect("status should be available");
        assert_eq!(status.state, CertificateState::Ready);
    }
}
