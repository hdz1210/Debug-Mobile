import type { CaptureStatusSnapshot } from "../../types/events";

type CaptureToolbarProps = {
  bindMode: "local" | "lan";
  capture: CaptureStatusSnapshot;
  certificateNeedsAttention: boolean;
  isBusy: boolean;
  port: number;
  searchQuery: string;
  onBindModeChange: (mode: "local" | "lan") => void;
  onClear: () => void;
  onCertificate: () => void;
  onHistory: () => void;
  onOpenLogs: () => void;
  onPause: () => void;
  onPortChange: (port: number) => void;
  onSearchChange: (query: string) => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
};

export function CaptureToolbar({
  bindMode,
  capture,
  certificateNeedsAttention,
  isBusy,
  port,
  searchQuery,
  onBindModeChange,
  onClear,
  onCertificate,
  onHistory,
  onOpenLogs,
  onPause,
  onPortChange,
  onSearchChange,
  onResume,
  onStart,
  onStop,
}: CaptureToolbarProps) {
  const isProxyActive = [
    "starting",
    "running",
    "pausing",
    "paused",
    "resuming",
    "stopping",
  ].includes(capture.status);
  const canPause = capture.status === "running";
  const canResume = capture.status === "paused";

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
            {isProxyActive
              ? ` · ${capture.host}:${capture.port}`
              : ""}
          </p>
        </div>
      </div>

      <div className="capture-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={isBusy || isProxyActive}
          onClick={onStart}
        >
          Start capture
        </button>
        <button
          className="button"
          type="button"
          disabled={isBusy || (!canPause && !canResume)}
          onClick={canResume ? onResume : onPause}
        >
          {canResume ? "Resume capture" : "Pause capture"}
        </button>
        <button
          className="button"
          type="button"
          title="Stops the proxy. A phone still configured to use it may lose Internet access."
          disabled={isBusy || (!canPause && !canResume)}
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
          disabled={isProxyActive}
          onClick={onHistory}
        >
          History
        </button>
        <button className="button" type="button" onClick={onOpenLogs}>
          Logs
        </button>
        <button
          className="button certificate-button"
          data-attention={certificateNeedsAttention}
          type="button"
          onClick={onCertificate}
        >
          Certificate
        </button>
      </div>

      <div className="proxy-settings">
        <label>
          <span>Bind</span>
          <select
            value={bindMode}
            disabled={isProxyActive}
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
            disabled={isProxyActive}
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
