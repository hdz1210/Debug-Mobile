import { useMemo, useState } from "react";
import { saveCapturedBody } from "../../lib/ipc";
import type { CapturedBody } from "../../types/events";
import { formatBodyText } from "./format-body";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconRefresh,
} from "../common/Icons";

type BodyViewerProps = {
  body?: CapturedBody | null;
  emptyMessage: string;
  imagePreview?: boolean;
  suggestedFileName: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BodyViewer({
  body,
  emptyMessage,
  imagePreview = false,
  suggestedFileName,
}: BodyViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const formatted = useMemo(
    () => (body?.format === "text" ? formatBodyText(body) : null),
    [body],
  );

  if (!body || body.size === 0) {
    return <p className="detail-empty">{emptyMessage}</p>;
  }

  const mediaType = (body.contentType ?? "").split(";", 1)[0].toLowerCase();
  const canPreviewImage =
    imagePreview &&
    body.format === "base64" &&
    mediaType.startsWith("image/") &&
    !body.truncated;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body.data);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setActionMessage("Copy failed");
      setTimeout(() => setActionMessage(null), 2000);
    }
  };

  const handleSave = async () => {
    try {
      const saved = await saveCapturedBody(body, suggestedFileName);
      if (saved) {
        setActionMessage("Body saved");
        setTimeout(() => setActionMessage(null), 2000);
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  const label =
    formatted?.label ??
    (canPreviewImage ? "Image Preview" : "Binary Payload");

  return (
    <section className="body-viewer" aria-label="Payload viewer">
      <header className="body-toolbar">
        <div className="body-meta">
          <span className="body-format-badge">{label}</span>
          <span className="body-content-type" title={body.contentType || "Unknown content type"}>
            {body.contentType || "Unknown content type"}
          </span>
          <span className="body-size-pill tabular-nums">
            {formatBytes(body.size)}
          </span>
        </div>

        <div className="body-actions">
          {formatted && formatted.data !== body.data ? (
            <button
              className={`button button-subtle body-mode-btn ${showRaw ? "active" : ""}`}
              type="button"
              onClick={() => setShowRaw((current) => !current)}
            >
              <IconRefresh size={12} />
              <span>{showRaw ? "Show Pretty" : "Show Raw"}</span>
            </button>
          ) : null}

          <button
            className="button button-subtle body-copy-btn"
            type="button"
            onClick={() => void handleCopy()}
          >
            {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>

          <button
            className="button button-subtle body-save-btn"
            type="button"
            onClick={() => void handleSave()}
          >
            <IconDownload size={12} />
            <span>Save</span>
          </button>
        </div>
      </header>

      {body.truncated ? (
        <div className="body-warning" role="alert">
          Payload truncated. Original decoded size: {formatBytes(body.size)}.
        </div>
      ) : null}

      {actionMessage ? (
        <div className="body-action-message" role="status">
          {actionMessage}
        </div>
      ) : null}

      {formatted?.formEntries && !showRaw ? (
        <div className="body-table-wrapper">
          <table className="key-value-table">
            <tbody>
              {formatted.formEntries.map(([name, value], index) => (
                <tr key={`${name}:${index}`}>
                  <th>{name}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canPreviewImage ? (
        <div className="image-preview">
          <img
            src={`data:${mediaType};base64,${body.data}`}
            alt="Captured response preview"
          />
        </div>
      ) : null}

      {!canPreviewImage && !(formatted?.formEntries && !showRaw) ? (
        <div className="body-content-wrapper">
          <pre className="body-content">
            <code>
              {formatted ? (showRaw ? body.data : formatted.data) : body.data}
            </code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}
