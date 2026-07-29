import { useEffect } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  getCaptureStatus,
  listenForBackendWarnings,
  listenForBridgeEvents,
  listenForCaptureStatus,
} from "../lib/ipc";
import { useFlowStore } from "../stores/flow-store";

export function useBackendEvents(): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    const store = useFlowStore.getState();

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
          store.setBackendWarning(
            error instanceof Error
              ? error.message
              : "Cannot connect to the desktop backend.",
          );
        }
      }
    };

    void register();
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
}
