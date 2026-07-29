import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  getCaptureStatus,
  listenForBackendWarnings,
  listenForBridgeEvents,
  listenForCaptureStatus,
  writeFrontendDiagnostic,
} from "../lib/ipc";
import { useFlowStore } from "../stores/flow-store";

export function useBackendEvents(): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    const store = useFlowStore.getState();
    const recordFrontendError = (message: string) => {
      void writeFrontendDiagnostic("error", message).catch(() => undefined);
    };
    const handleWindowError = (event: ErrorEvent) => {
      recordFrontendError(`Unhandled window error: ${event.message}`);
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      recordFrontendError(`Unhandled promise rejection: ${reason}`);
    };
    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    void writeFrontendDiagnostic("info", "Frontend initialized.").catch(
      () => undefined,
    );

    const register = async () => {
      try {
        const listeners = await Promise.all([
          listenForBridgeEvents((event) =>
            useFlowStore.getState().upsertBridgeEvent(event),
          ),
          listenForCaptureStatus((snapshot) =>
            useFlowStore.getState().setCapture(snapshot),
          ),
          listenForBackendWarnings((message) =>
            useFlowStore.getState().setBackendWarning(message),
          ),
        ]);

        if (cancelled) {
          listeners.forEach((unlisten) => unlisten());
          return;
        }
        unlisteners.push(...listeners);

        const snapshot = await getCaptureStatus();
        if (!cancelled) {
          useFlowStore.getState().setCapture(snapshot);
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : "Cannot connect to the desktop backend.";
          store.setBackendWarning(message);
          recordFrontendError(`Backend event registration failed: ${message}`);
        }
      }
    };

    void register();
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, []);
}
