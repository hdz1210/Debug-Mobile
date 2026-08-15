import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { CertificateStatus } from "../../types/events";

type CertificatePanelProps = {
  open: boolean;
  status: CertificateStatus | null;
  isBusy: boolean;
  error: string | null;
  proxyActive: boolean;
  onAcknowledge: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onReveal: () => void;
};

function stateCopy(status: CertificateStatus | null): {
  title: string;
  message: string;
  tone: "neutral" | "warning" | "success";
} {
  switch (status?.state) {
    case "ready":
      return {
        title: "Certificate unchanged",
        message:
          "This is the same CA you previously marked as installed and trusted.",
        tone: "success",
      };
    case "changed":
      return {
        title: "Certificate changed",
        message:
          "Remove the old mitmproxy profile from the phone, then install and trust this CA.",
        tone: "warning",
      };
    case "setup_required":
      return {
        title: "One-time phone setup required",
        message: "Install and fully trust this CA on each phone you want to inspect.",
        tone: "warning",
      };
    default:
      return {
        title: "Certificate not generated yet",
        message: "Start the proxy once to generate its private per-installation CA.",
        tone: "neutral",
      };
  }
}

export function CertificatePanel({
  open,
  status,
  isBusy,
  error,
  proxyActive,
  onAcknowledge,
  onClose,
  onRefresh,
  onReveal,
}: CertificatePanelProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const copy = stateCopy(status);

  useEffect(() => {
    if (!open || !status?.installUrl) {
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(status.installUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0d1117", light: "#ffffff" },
    }).then((value) => {
      if (!cancelled) {
        setQrCode(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, status?.installUrl]);

  if (!open) {
    return null;
  }

  const copyInstallUrl = async () => {
    if (!status?.installUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(status.installUrl);
      setCopyMessage("Setup URL copied");
    } catch {
      setCopyMessage("Copy failed");
    }
    window.setTimeout(() => setCopyMessage(null), 1_800);
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="certificate-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="certificate-title"
      >
        <header>
          <div>
            <p className="eyebrow">HTTPS inspection</p>
            <h2 id="certificate-title">Phone certificate setup</h2>
          </div>
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="certificate-content">
          <div className="certificate-setup">
            <div className="certificate-qr" aria-label="QR code for mitm.it">
              {qrCode ? <img src={qrCode} alt="Open mitm.it on the phone" /> : null}
            </div>
            <div>
              <div className="certificate-state" data-tone={copy.tone}>
                <strong>{copy.title}</strong>
                <span>{copy.message}</span>
              </div>
              <ol>
                <li>Start the proxy and set the phone Wi-Fi proxy to this desktop.</li>
                <li>
                  Scan this QR code or open <code>{status?.installUrl ?? "http://mitm.it"}</code> in Safari.
                </li>
                <li>
                  Open <strong>Settings → VPN &amp; Device Management</strong> and tap <strong>Install</strong> on the mitmproxy profile.
                </li>
                <li>
                  Open <strong>Settings → General → About → Certificate Trust Settings</strong> and enable <strong>Full Trust</strong> for mitmproxy.
                </li>
              </ol>
              {!proxyActive ? (
                <p className="certificate-hint">
                  The setup URL works only while the desktop proxy is running.
                </p>
              ) : null}
            </div>
          </div>

          {status?.fingerprintSha256 ? (
            <dl className="certificate-details">
              <div>
                <dt>SHA-256 fingerprint</dt>
                <dd>{status.fingerprintSha256}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  {status.createdAt
                    ? new Date(status.createdAt * 1_000).toLocaleString()
                    : "Unknown"}
                </dd>
              </div>
            </dl>
          ) : null}

          {error ? <p className="history-error">{error}</p> : null}
          {copyMessage ? <p className="body-action-message">{copyMessage}</p> : null}
        </div>

        <footer className="dialog-actions certificate-actions">
          <button
            className="button"
            type="button"
            disabled={!status?.installUrl}
            onClick={() => void copyInstallUrl()}
          >
            Copy setup URL
          </button>
          <button
            className="button"
            type="button"
            disabled={!status?.certificatePath || isBusy}
            onClick={onReveal}
          >
            Show certificate file
          </button>
          <button className="button" type="button" disabled={isBusy} onClick={onRefresh}>
            Refresh
          </button>
          {status?.state === "changed" || status?.state === "setup_required" ? (
            <button
              className="button button-primary"
              type="button"
              disabled={isBusy}
              onClick={onAcknowledge}
            >
              I installed and trusted it
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
