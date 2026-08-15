import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { CaptureToolbar } from "./components/capture-toolbar/CaptureToolbar";
import { CertificatePanel } from "./components/certificate-panel/CertificatePanel";
import { ConsentDialog } from "./components/consent-dialog/ConsentDialog";
import { HistoryPanel } from "./components/history-panel/HistoryPanel";
import { LanProxyBanner } from "./components/lan-proxy-banner/LanProxyBanner";
import { NetworkTable } from "./components/network-table/NetworkTable";
import { RequestDetails } from "./components/request-details/RequestDetails";
import { useBackendEvents } from "./hooks/use-backend-events";
import {
  acknowledgeCertificate,
  getCertificateStatus,
  getNetworkInfo,
  loadSessionEvents,
  pauseCapture,
  resumeCapture,
  revealCertificate,
  revealDiagnosticLog,
  saveNetworkArchive,
  startCapture,
  stopCapture,
} from "./lib/ipc";
import { flowMatchesSearch } from "./lib/flow-search";
import { serializeHar, suggestHarFileName } from "./lib/har-export";
import { useFlowStore } from "./stores/flow-store";
import type {
  CertificateStatus,
  CaptureConfig,
  NetworkInfo,
  SessionSummary,
} from "./types/events";

const CAPTURE_CONSENT_KEY = "appdbg.capture-consent.v1";

function readableError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The operation could not be completed.";
}

function App() {
  useBackendEvents();

  const flowsById = useFlowStore((state) => state.flowsById);
  const orderedFlowIds = useFlowStore((state) => state.orderedFlowIds);
  const selectedFlowId = useFlowStore((state) => state.selectedFlowId);
  const searchQuery = useFlowStore((state) => state.searchQuery);
  const capture = useFlowStore((state) => state.capture);
  const backendWarning = useFlowStore((state) => state.backendWarning);
  const setCapture = useFlowStore((state) => state.setCapture);
  const setSelectedFlowId = useFlowStore(
    (state) => state.setSelectedFlowId,
  );
  const setSearchQuery = useFlowStore((state) => state.setSearchQuery);
  const clearFlows = useFlowStore((state) => state.clearFlows);

  const [bindMode, setBindMode] = useState<"local" | "lan">("local");
  const [port, setPort] = useState(8080);
  const [isBusy, setIsBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConsentOpen, setIsConsentOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<string | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [networkInfoError, setNetworkInfoError] = useState<string | null>(null);
  const [isScanningNetwork, setIsScanningNetwork] = useState(false);
  const [certificateStatus, setCertificateStatus] =
    useState<CertificateStatus | null>(null);
  const [isCertificateOpen, setIsCertificateOpen] = useState(false);
  const [isCertificateBusy, setIsCertificateBusy] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);
  const [checkedFlowIds, setCheckedFlowIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isExporting, setIsExporting] = useState(false);

  const [splitPercent, setSplitPercent] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("appdbg:split-percent.v1");
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 20 && parsed <= 80) {
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return 55;
  });
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const currentX = e.clientX - rect.left;
      const newPercent = (currentX / rect.width) * 100;
      const clamped = Math.max(20, Math.min(80, newPercent));
      setSplitPercent(clamped);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      try {
        localStorage.setItem("appdbg:split-percent.v1", String(splitPercent));
      } catch {
        // Ignore
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [isResizing, splitPercent]);

  const handleResetSplit = () => {
    setSplitPercent(55);
    try {
      localStorage.setItem("appdbg:split-percent.v1", "55");
    } catch {
      // Ignore
    }
  };

  const refreshNetworkInfo = useCallback(async () => {
    setIsScanningNetwork(true);
    try {
      setNetworkInfo(await getNetworkInfo());
      setNetworkInfoError(null);
    } catch (error) {
      setNetworkInfoError(readableError(error));
    } finally {
      setIsScanningNetwork(false);
    }
  }, []);

  const refreshCertificateStatus = useCallback(async () => {
    setIsCertificateBusy(true);
    try {
      const status = await getCertificateStatus();
      setCertificateStatus(status);
      setCertificateError(null);
      return status;
    } catch (error) {
      setCertificateError(readableError(error));
      return null;
    } finally {
      setIsCertificateBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshNetworkInfo();
  }, [refreshNetworkInfo]);

  useEffect(() => {
    void refreshCertificateStatus();
  }, [refreshCertificateStatus]);

  useEffect(() => {
    if (bindMode !== "lan") {
      return;
    }

    void refreshNetworkInfo();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshNetworkInfo();
      }
    };
    const interval = window.setInterval(refreshWhenVisible, 5_000);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [bindMode, refreshNetworkInfo]);

  const orderedFlows = useMemo(
    () => orderedFlowIds.map((flowId) => flowsById[flowId]),
    [flowsById, orderedFlowIds],
  );

  const visibleFlows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orderedFlows.filter((flow) => flowMatchesSearch(flow, query));
  }, [orderedFlows, searchQuery]);

  const selectedFlow = selectedFlowId
    ? (flowsById[selectedFlowId] ?? null)
    : null;
  const proxyActive = [
    "starting",
    "running",
    "pausing",
    "paused",
    "resuming",
    "stopping",
  ].includes(capture.status);
  const certificateNeedsAttention =
    certificateStatus === null || certificateStatus.state !== "ready";

  const performStart = async () => {
    const config: CaptureConfig = {
      host: bindMode === "lan" ? "0.0.0.0" : "127.0.0.1",
      port,
      bodyLimit: 1_000_000,
    };

    setIsBusy(true);
    setActionError(null);
    setViewingSession(null);
    setCheckedFlowIds(new Set());
    clearFlows();
    try {
      setCapture(await startCapture(config));
      const status = await refreshCertificateStatus();
      if (status?.state === "changed" || status?.state === "setup_required") {
        setIsCertificateOpen(true);
      }
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleStart = () => {
    try {
      if (window.localStorage.getItem(CAPTURE_CONSENT_KEY) === "accepted") {
        void performStart();
        return;
      }
    } catch {
      // Consent still applies for this run if persistent storage is unavailable.
    }
    setIsConsentOpen(true);
  };

  const handleConsent = () => {
    try {
      window.localStorage.setItem(CAPTURE_CONSENT_KEY, "accepted");
    } catch {
      // The user can continue after acknowledging the warning for this run.
    }
    setIsConsentOpen(false);
    void performStart();
  };

  const handleStop = async () => {
    setIsBusy(true);
    setActionError(null);
    try {
      setCapture(await stopCapture());
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handlePause = async () => {
    setIsBusy(true);
    setActionError(null);
    try {
      setCapture(await pauseCapture());
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleResume = async () => {
    setIsBusy(true);
    setActionError(null);
    try {
      setCapture(await resumeCapture());
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleAcknowledgeCertificate = async () => {
    setIsCertificateBusy(true);
    setCertificateError(null);
    try {
      setCertificateStatus(await acknowledgeCertificate());
    } catch (error) {
      setCertificateError(readableError(error));
    } finally {
      setIsCertificateBusy(false);
    }
  };

  const handleRevealCertificate = async () => {
    setIsCertificateBusy(true);
    setCertificateError(null);
    try {
      setCertificateStatus(await revealCertificate());
    } catch (error) {
      setCertificateError(readableError(error));
    } finally {
      setIsCertificateBusy(false);
    }
  };

  const handleOpenLogs = async () => {
    try {
      await revealDiagnosticLog();
    } catch (error) {
      setActionError(readableError(error));
    }
  };

  const handleClear = () => {
    setCheckedFlowIds(new Set());
    clearFlows();
  };

  const handleOpenHistory = () => {
    setCheckedFlowIds(new Set());
    setIsHistoryOpen(true);
  };

  const handleToggleChecked = (flowId: string) => {
    setCheckedFlowIds((current) => {
      const next = new Set(current);
      if (next.has(flowId)) {
        next.delete(flowId);
      } else {
        next.add(flowId);
      }
      return next;
    });
  };

  const handleToggleAllVisible = () => {
    setCheckedFlowIds((current) => {
      const next = new Set(current);
      const allVisibleChecked =
        visibleFlows.length > 0 &&
        visibleFlows.every((flow) => next.has(flow.id));
      visibleFlows.forEach((flow) => {
        if (allVisibleChecked) {
          next.delete(flow.id);
        } else {
          next.add(flow.id);
        }
      });
      return next;
    });
  };

  const handleExport = async (scope: "selected" | "all") => {
    const flowsToExport =
      scope === "selected"
        ? orderedFlows.filter((flow) => checkedFlowIds.has(flow.id))
        : orderedFlows;
    if (flowsToExport.length === 0) {
      return;
    }

    setIsExporting(true);
    setActionError(null);
    try {
      const exportedAt = new Date();
      const content = serializeHar(flowsToExport, exportedAt);
      await saveNetworkArchive(
        content,
        suggestHarFileName(scope, exportedAt),
      );
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setIsExporting(false);
    }
  };

  const statusMessage = actionError ?? capture.message ?? backendWarning;

  return (
    <main className="network-app">
      <CaptureToolbar
        bindMode={bindMode}
        capture={capture}
        certificateNeedsAttention={certificateNeedsAttention}
        isBusy={isBusy}
        port={port}
        searchQuery={searchQuery}
        onBindModeChange={setBindMode}
        onClear={handleClear}
        onCertificate={() => {
          setIsCertificateOpen(true);
          void refreshCertificateStatus();
        }}
        onHistory={handleOpenHistory}
        onOpenLogs={() => void handleOpenLogs()}
        onPause={() => void handlePause()}
        onPortChange={(nextPort) => {
          if (Number.isFinite(nextPort)) {
            setPort(Math.min(65535, Math.max(1, Math.round(nextPort))));
          }
        }}
        onSearchChange={setSearchQuery}
        onResume={() => void handleResume()}
        onStart={handleStart}
        onStop={() => void handleStop()}
      />

      {bindMode === "lan" ? (
        <>
          <LanProxyBanner
            capture={capture}
            isScanning={isScanningNetwork}
            networkError={networkInfoError}
            networkInfo={networkInfo}
            port={proxyActive ? capture.port : port}
            onRefresh={() => void refreshNetworkInfo()}
          />
          {!proxyActive ? (
            <div className="notice notice-warning" role="status">
              LAN mode exposes the proxy to devices on this network. Use it only
              on a trusted network.
            </div>
          ) : null}
        </>
      ) : null}

      {statusMessage ? (
        <div className="notice notice-error notice-with-action" role="alert">
          <span>{statusMessage}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => void handleOpenLogs()}
          >
            Open logs
          </button>
        </div>
      ) : null}

      {viewingSession ? (
        <div className="notice history-notice" role="status">
          Viewing saved session: {viewingSession}
        </div>
      ) : null}

      <section
        className={`workspace ${isResizing ? "is-resizing" : ""}`}
        ref={workspaceRef}
        style={{
          gridTemplateColumns: `${splitPercent}% 6px calc(${100 - splitPercent}% - 6px)`,
        }}
      >
        <NetworkTable
          checkedFlowIds={checkedFlowIds}
          flows={visibleFlows}
          isExporting={isExporting}
          selectedFlowId={selectedFlowId}
          totalFlowCount={orderedFlows.length}
          onExportAll={() => void handleExport("all")}
          onExportSelected={() => void handleExport("selected")}
          onSelect={setSelectedFlowId}
          onToggleAllVisible={handleToggleAllVisible}
          onToggleChecked={handleToggleChecked}
        />
        <div
          className={`workspace-resizer ${isResizing ? "resizing" : ""}`}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleResetSplit}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize panels (Double-click to reset)"
        />
        <RequestDetails key={selectedFlow?.id ?? "empty"} flow={selectedFlow} />
      </section>

      <ConsentDialog
        open={isConsentOpen}
        onCancel={() => setIsConsentOpen(false)}
        onConfirm={handleConsent}
      />
      <CertificatePanel
        open={isCertificateOpen}
        status={certificateStatus}
        isBusy={isCertificateBusy}
        error={certificateError}
        proxyActive={proxyActive}
        onAcknowledge={() => void handleAcknowledgeCertificate()}
        onClose={() => setIsCertificateOpen(false)}
        onRefresh={() => void refreshCertificateStatus()}
        onReveal={() => void handleRevealCertificate()}
      />
      <HistoryPanel
        open={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onOpenSession={async (session: SessionSummary) => {
          setActionError(null);
          setCheckedFlowIds(new Set());
          try {
            const events = await loadSessionEvents(session.id);
            clearFlows();
            events.forEach(useFlowStore.getState().upsertBridgeEvent);
            setViewingSession(
              session.name ??
                new Date(session.startedAt * 1_000).toLocaleString(),
            );
            setIsHistoryOpen(false);
          } catch (error) {
            setActionError(readableError(error));
          }
        }}
      />
    </main>
  );
}

export default App;
