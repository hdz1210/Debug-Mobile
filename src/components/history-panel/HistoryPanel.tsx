import { useCallback, useEffect, useState } from "react";
import {
  deleteSession,
  listSessions,
  renameSession,
} from "../../lib/ipc";
import type { SessionSummary } from "../../types/events";

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

  const handleRename = async (session: SessionSummary) => {
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

  const handleDelete = async (session: SessionSummary) => {
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
        className="history-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
      >
        <header>
          <div>
            <p className="eyebrow">Saved locally</p>
            <h2 id="history-title">Capture history</h2>
          </div>
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
        </header>

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
            <article className="history-card" key={session.id}>
              <button
                className="history-main"
                type="button"
                onClick={() => void onOpenSession(session)}
              >
                <strong>{session.name ?? "Untitled session"}</strong>
                <span>
                  {new Date(session.startedAt * 1_000).toLocaleString()}
                </span>
                <span>
                  {session.flowCount} requests · {formatBytes(session.totalSize)}
                </span>
              </button>
              <div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void handleRename(session)}
                >
                  Rename
                </button>
                <button
                  className="text-button danger"
                  type="button"
                  onClick={() => void handleDelete(session)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
