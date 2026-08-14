import { useCallback, useEffect, useMemo, useState } from "react";
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
  startCapture,
  stopCapture,
} from "./lib/ipc";
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

  const visibleFlows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orderedFlowIds
      .map((flowId) => flowsById[flowId])
      .filter((flow) => {
        if (!query) {
          return true;
        }
        return [
          flow.method,
          flow.url,
          flow.host,
          flow.path,
          flow.statusCode,
          flow.requestBody?.format === "text"
            ? flow.requestBody.data
            : undefined,
          flow.responseBody?.format === "text"
            ? flow.responseBody.data
            : undefined,
        ]
          .filter((value) => value !== undefined)
          .some((value) => String(value).toLowerCase().includes(query));
      });
  }, [flowsById, orderedFlowIds, searchQuery]);

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
        onClear={clearFlows}
        onCertificate={() => {
          setIsCertificateOpen(true);
          void refreshCertificateStatus();
        }}
        onHistory={() => setIsHistoryOpen(true)}
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

      <section className="workspace">
        <NetworkTable
          flows={visibleFlows}
          selectedFlowId={selectedFlowId}
          onSelect={setSelectedFlowId}
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
