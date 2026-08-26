import { useState } from "react";
import type {
  CaptureStatusSnapshot,
  NetworkInfo,
} from "../../types/events";
import {
  IconBranch,
  IconCertificate,
  IconCheck,
  IconCopy,
  IconFlame,
  IconGlobe,
  IconHistory,
  IconLogs,
  IconPause,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconStop,
  IconTrash,
} from "../common/Icons";

export type WorkspaceView = "network" | "firebase" | "branch" | "all";

type CaptureToolbarProps = {
  bindMode: "local" | "lan";
  capture: CaptureStatusSnapshot;
  certificateNeedsAttention: boolean;
  isBusy: boolean;
  port: number;
  searchQuery: string;
  networkInfo: NetworkInfo | null;
  isScanningNetwork?: boolean;
  workspaceView: WorkspaceView;
  analyticsCounts: { firebaseCount: number; branchCount: number };
  totalFlowCount: number;
  onWorkspaceViewChange: (view: WorkspaceView) => void;
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
  onRefreshNetwork?: () => void;
};

export function CaptureToolbar({
  bindMode,
  capture,
  certificateNeedsAttention,
  isBusy,
  port,
  searchQuery,
  networkInfo,
  isScanningNetwork = false,
  workspaceView,
  analyticsCounts,
  totalFlowCount,
  onWorkspaceViewChange,
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
  onRefreshNetwork,
}: CaptureToolbarProps) {
  const [copiedIp, setCopiedIp] = useState(false);

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

  const lanIp = networkInfo?.recommendedAddress ?? null;
  const currentTargetAddress =
    bindMode === "lan" && lanIp
      ? `${lanIp}:${isProxyActive ? capture.port : port}`
      : `127.0.0.1:${isProxyActive ? capture.port : port}`;

  const handleCopyIp = async () => {
    if (!lanIp) return;
    try {
      await navigator.clipboard.writeText(lanIp);
      setCopiedIp(true);
      setTimeout(() => setCopiedIp(false), 1800);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <header className="app-unified-toolbar" role="banner">
      {/* Top Row: Brand, Workspace Tabs, Utility Actions */}
      <div className="toolbar-top-row">
        {/* Brand & Status */}
        <div className="brand-section">
          <div className="brand-icon" aria-hidden="true">
            <span>A</span>
          </div>
          <div className="brand-titles">
            <h1 className="brand-name">App Network Debugger</h1>
            <div className="brand-status-pill">
              <span className="status-dot" data-status={capture.status} />
              <span className="status-text">
                {capture.status === "running"
                  ? "Running"
                  : capture.status === "paused"
                    ? "Paused"
                    : "Idle"}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Workspaces / Segmented Control Tabs */}
        <nav className="workspace-tabs-segmented" aria-label="Workspace views">
          <button
            className={`segmented-tab ${workspaceView === "network" ? "active" : ""}`}
            type="button"
            aria-selected={workspaceView === "network"}
            onClick={() => onWorkspaceViewChange("network")}
          >
            <IconGlobe className="tab-icon" size={14} />
            <span>Network Traffic</span>
            <span className="seg-count">{totalFlowCount}</span>
          </button>
          <button
            className={`segmented-tab ${workspaceView === "firebase" ? "active" : ""}`}
            type="button"
            aria-selected={workspaceView === "firebase"}
            onClick={() => onWorkspaceViewChange("firebase")}
          >
            <IconFlame className="tab-icon highlight-fire-icon" size={14} />
            <span>Firebase</span>
            {analyticsCounts.firebaseCount > 0 && (
              <span className="seg-count highlight-fire">
                {analyticsCounts.firebaseCount}
              </span>
            )}
          </button>
          <button
            className={`segmented-tab ${workspaceView === "branch" ? "active" : ""}`}
            type="button"
            aria-selected={workspaceView === "branch"}
            onClick={() => onWorkspaceViewChange("branch")}
          >
            <IconBranch className="tab-icon highlight-branch-icon" size={14} />
            <span>Branch</span>
            {analyticsCounts.branchCount > 0 && (
              <span className="seg-count highlight-branch">
                {analyticsCounts.branchCount}
              </span>
            )}
          </button>
        </nav>

        {/* Right: Proxy Config & Utilities */}
        <div className="toolbar-utilities">
          <div className="proxy-quick-config">
            <label className="config-label">
              <span className="config-key">Bind</span>
              <select
                className="config-select"
                disabled={isProxyActive}
                value={bindMode}
                aria-label="Proxy network interface bind mode"
                onChange={(e) =>
                  onBindModeChange(e.target.value as "local" | "lan")
                }
              >
                <option value="lan">LAN (Mobile)</option>
                <option value="local">Localhost</option>
              </select>
            </label>

            <label className="config-label">
              <span className="config-key">Port</span>
              <input
                className="config-port-input"
                disabled={isProxyActive}
                max={65535}
                min={1}
                type="number"
                value={port}
                aria-label="Proxy port number"
                onChange={(e) => onPortChange(e.target.valueAsNumber)}
              />
            </label>
          </div>

          <div className="utility-buttons">
            <button
              className="button button-subtle certificate-btn"
              data-attention={certificateNeedsAttention}
              title="View and install CA Certificate on mobile device"
              type="button"
              onClick={onCertificate}
            >
              <IconCertificate size={14} />
              <span>Certificate</span>
            </button>
            <button
              className="button button-subtle"
              disabled={isProxyActive}
              title="View saved capture history"
              type="button"
              onClick={onHistory}
            >
              <IconHistory size={14} />
              <span>History</span>
            </button>
            <button
              className="button button-subtle"
              title="Open diagnostic logs"
              type="button"
              onClick={onOpenLogs}
            >
              <IconLogs size={14} />
              <span>Logs</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Row: Capture Actions, Live Mobile IP Card, Search */}
      <div className="toolbar-bottom-row">
        {/* Left: Capture Actions */}
        <div className="capture-control-group">
          {!isProxyActive ? (
            <button
              className="button button-primary start-btn"
              disabled={isBusy}
              type="button"
              onClick={onStart}
            >
              <IconPlay size={14} />
              <span>Start capture</span>
            </button>
          ) : (
            <>
              <button
                className={`button ${canResume ? "button-primary" : "button-warning"}`}
                disabled={isBusy || (!canPause && !canResume)}
                type="button"
                onClick={canResume ? onResume : onPause}
              >
                {canResume ? <IconPlay size={14} /> : <IconPause size={14} />}
                <span>{canResume ? "Resume" : "Pause"}</span>
              </button>
              <button
                className="button button-danger stop-btn"
                disabled={isBusy}
                title="Stop the proxy"
                type="button"
                onClick={onStop}
              >
                <IconStop size={14} />
                <span>Stop</span>
              </button>
            </>
          )}

          <button
            className="button button-subtle clear-btn"
            title="Clear all recorded requests"
            type="button"
            onClick={onClear}
          >
            <IconTrash size={14} />
            <span>Clear</span>
          </button>
        </div>

        {/* Center: Live Mobile Proxy IP badge */}
        <div className="mobile-ip-badge-container">
          {bindMode === "lan" ? (
            <div className="mobile-ip-badge" title="Configure your phone Wi-Fi HTTP proxy to this IP and Port">
              <span className="badge-pulse" aria-hidden="true" />
              <span className="badge-label">Phone Wi-Fi Proxy:</span>
              <strong className="badge-ip">{currentTargetAddress}</strong>
              {lanIp && (
                <button
                  className="badge-copy-btn"
                  title="Copy IP Address"
                  type="button"
                  onClick={handleCopyIp}
                >
                  {copiedIp ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  <span>{copiedIp ? "Copied" : "Copy"}</span>
                </button>
              )}
              {onRefreshNetwork && (
                <button
                  className={`badge-refresh-btn ${isScanningNetwork ? "scanning" : ""}`}
                  disabled={isScanningNetwork}
                  title="Scan for network IP changes"
                  type="button"
                  onClick={onRefreshNetwork}
                >
                  <IconRefresh size={12} />
                </button>
              )}
            </div>
          ) : (
            <div className="mobile-ip-badge local-badge">
              <span className="badge-label">Local Proxy:</span>
              <strong className="badge-ip">{currentTargetAddress}</strong>
            </div>
          )}
        </div>

        {/* Right: Search Box */}
        <div className="search-box-wrapper">
          <label className="search-input-container">
            <IconSearch className="search-icon" size={14} />
            <input
              className="global-search-input"
              placeholder="Search URL, path, method, status…"
              type="search"
              aria-label="Filter network traffic"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </label>
        </div>
      </div>
    </header>
  );
}
