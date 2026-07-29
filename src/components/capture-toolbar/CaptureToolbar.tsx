import type { CaptureStatusSnapshot } from "../../types/events";

type CaptureToolbarProps = {
  bindMode: "local" | "lan";
  capture: CaptureStatusSnapshot;
  isBusy: boolean;
  port: number;
  searchQuery: string;
  onBindModeChange: (mode: "local" | "lan") => void;
  onClear: () => void;
  onHistory: () => void;
  onOpenLogs: () => void;
  onPortChange: (port: number) => void;
  onSearchChange: (query: string) => void;
  onStart: () => void;
  onStop: () => void;
};

export function CaptureToolbar({
  bindMode,
  capture,
  isBusy,
  port,
  searchQuery,
  onBindModeChange,
  onClear,
  onHistory,
  onOpenLogs,
  onPortChange,
  onSearchChange,
  onStart,
  onStop,
}: CaptureToolbarProps) {
  const isActive =
    capture.status === "running" || capture.status === "starting";

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          A
        </span>
        <div>
          <h1>App Network Debugger</h1>
          <p>
            <span className="status-dot" data-status={capture.status} />
            {capture.status}
            {capture.status === "running"
              ? ` · ${capture.host}:${capture.port}`
              : ""}
          </p>
        </div>
      </div>

      <div className="capture-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={isBusy || isActive || capture.status === "stopping"}
          onClick={onStart}
        >
          Start capture
        </button>
        <button
          className="button"
          type="button"
          disabled={isBusy || !isActive}
          onClick={onStop}
        >
          Stop
        </button>
        <button className="button" type="button" onClick={onClear}>
          Clear
        </button>
        <button
          className="button"
          type="button"
          disabled={isActive}
          onClick={onHistory}
        >
          History
        </button>
        <button className="button" type="button" onClick={onOpenLogs}>
          Logs
        </button>
      </div>

      <div className="proxy-settings">
        <label>
          <span>Bind</span>
          <select
            value={bindMode}
            disabled={isActive}
            onChange={(event) =>
              onBindModeChange(event.target.value as "local" | "lan")
            }
          >
            <option value="local">Local only</option>
            <option value="lan">LAN devices</option>
          </select>
        </label>
        <label>
          <span>Port</span>
          <input
            className="port-input"
            type="number"
            min={1}
            max={65535}
            value={port}
            disabled={isActive}
            onChange={(event) => onPortChange(event.target.valueAsNumber)}
          />
        </label>
      </div>

      <label className="search-box">
        <span className="visually-hidden">Search requests</span>
        <input
          type="search"
          value={searchQuery}
          placeholder="Search URL, domain, method, status…"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
    </header>
  );
}
