import { useMemo, useState } from "react";
import { saveCapturedBody } from "../../lib/ipc";
import type { CapturedBody } from "../../types/events";
import { formatBodyText } from "./format-body";

type BodyViewerProps = {
  body?: CapturedBody | null;
  emptyMessage: string;
  imagePreview?: boolean;
  suggestedFileName: string;
};

export function BodyViewer({
  body,
  emptyMessage,
  imagePreview = false,
  suggestedFileName,
}: BodyViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body.data);
      setActionMessage("Copied");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Copy failed");
    }
  };

  const save = async () => {
    try {
      const saved = await saveCapturedBody(body, suggestedFileName);
      setActionMessage(saved ? "Body saved" : null);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="body-viewer">
      <header className="body-toolbar">
        <div>
          <strong>
            {formatted?.label ??
              (canPreviewImage ? "Image preview" : "Binary · Base64")}
          </strong>
          <span>
            {body.contentType || "Unknown content type"} · {body.size} bytes
          </span>
        </div>
        <div className="body-actions">
          {formatted && formatted.data !== body.data ? (
            <button
              className="text-button"
              type="button"
              onClick={() => setShowRaw((current) => !current)}
            >
              {showRaw ? "Pretty" : "Raw"}
            </button>
          ) : null}
          <button className="text-button" type="button" onClick={() => void copy()}>
            Copy
          </button>
          <button className="text-button" type="button" onClick={() => void save()}>
            Save
          </button>
        </div>
      </header>

      {body.truncated ? (
        <p className="body-warning">
          Body truncated. Original decoded size: {body.size} bytes.
        </p>
      ) : null}
      {actionMessage ? <p className="body-action-message">{actionMessage}</p> : null}

      {formatted?.formEntries && !showRaw ? (
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
      ) : null}

      {canPreviewImage ? (
        <div className="image-preview">
          <img
            src={`data:${mediaType};base64,${body.data}`}
            alt="Captured response preview"
          />
        </div>
      ) : null}

      {!canPreviewImage &&
      !(formatted?.formEntries && !showRaw) ? (
        <pre className="body-content">
          {formatted ? (showRaw ? body.data : formatted.data) : body.data}
        </pre>
      ) : null}
    </section>
  );
}
