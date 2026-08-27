import { useCallback, useEffect, useState } from "react";
import {
  deleteSession,
  listSessions,
  renameSession,
} from "../../lib/ipc";
import type { SessionSummary } from "../../types/events";
import {
  IconClose,
  IconHistory,
  IconTrash,
} from "../common/Icons";

type HistoryPanelProps = {
  open: boolean;
  onClose: () => void;
  onOpenSession: (session: SessionSummary) => Promise<void>;
};

function formatBytes(size: number): string {
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

function readableError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "The history operation failed.";
}

export function HistoryPanel({
  open,
  onClose,
  onOpenSession,
}: HistoryPanelProps) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await listSessions());
    } catch (refreshError) {
      setError(readableError(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  if (!open) {
    return null;
  }

  const handleRename = async (session: SessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = window.prompt(
      "Session name",
      session.name ?? new Date(session.startedAt * 1_000).toLocaleString(),
    );
    if (!name) return;
    try {
      await renameSession(session.id, name);
      await refresh();
    } catch (renameError) {
      setError(readableError(renameError));
    }
  };

  const handleDelete = async (session: SessionSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete "${session.name ?? "Untitled session"}" and its captured body files?`,
    );
    if (!confirmed) return;
    try {
      await deleteSession(session.id);
      await refresh();
    } catch (deleteError) {
      setError(readableError(deleteError));
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="history-panel dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <header className="dialog-header">
          <div className="dialog-header-title">
            <IconHistory size={16} className="dialog-header-icon" />
            <div>
              <p className="eyebrow">Saved locally</p>
              <h2 id="history-title">Capture history</h2>
            </div>
          </div>
          <button
            className="dialog-close-btn"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <IconClose size={14} />
          </button>
        </header>

        <div className="dialog-body history-body">
          {error ? (
            <p className="history-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="history-list">
            {loading ? <p className="detail-empty">Loading sessions…</p> : null}
            {!loading && sessions.length === 0 ? (
              <p className="detail-empty">No saved capture sessions yet.</p>
            ) : null}
            {sessions.map((session) => (
              <article
                className="history-card"
                key={session.id}
                onClick={() => void onOpenSession(session)}
              >
                <div className="history-main">
                  <div className="history-title-row">
                    <strong className="history-session-name">
                      {session.name ?? "Untitled session"}
                    </strong>
                  </div>
                  <div className="history-meta-row">
                    <span className="history-meta-item">
                      {new Date(session.startedAt * 1_000).toLocaleString()}
                    </span>
                    <span className="history-meta-separator">·</span>
                    <span className="history-meta-badge tabular-nums">
                      {session.flowCount} requests
                    </span>
                    <span className="history-meta-separator">·</span>
                    <span className="history-meta-badge tabular-nums">
                      {formatBytes(session.totalSize)}
                    </span>
                  </div>
                </div>
                <div className="history-card-actions">
                  <button
                    className="button button-subtle history-action-btn"
                    type="button"
                    title="Rename session"
                    onClick={(e) => void handleRename(session, e)}
                  >
                    Rename
                  </button>
                  <button
                    className="button button-subtle history-action-btn danger"
                    type="button"
                    title="Delete session"
                    onClick={(e) => void handleDelete(session, e)}
                  >
                    <IconTrash size={12} />
                    <span>Delete</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <footer className="dialog-footer">
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
