import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import type {
  BridgeEvent,
  CapturedBody,
  CaptureConfig,
  CaptureStatusSnapshot,
  DiagnosticLogInfo,
  NetworkInfo,
  SessionSummary,
} from "../types/events";

export function startCapture(
  config: CaptureConfig,
): Promise<CaptureStatusSnapshot> {
  return invoke("start_capture", { config });
}

export function stopCapture(): Promise<CaptureStatusSnapshot> {
  return invoke("stop_capture");
}

export function restartCapture(
  config: CaptureConfig,
): Promise<CaptureStatusSnapshot> {
  return invoke("restart_capture", { config });
}

export function getCaptureStatus(): Promise<CaptureStatusSnapshot> {
  return invoke("get_capture_status");
}

export function getNetworkInfo(): Promise<NetworkInfo> {
  return invoke("get_network_info");
}

export function getDiagnosticLogInfo(): Promise<DiagnosticLogInfo> {
  return invoke("get_diagnostic_log_info");
}

export function revealDiagnosticLog(): Promise<DiagnosticLogInfo> {
  return invoke("reveal_diagnostic_log");
}

export function writeFrontendDiagnostic(
  level: "info" | "warn" | "error",
  message: string,
): Promise<void> {
  return invoke("write_frontend_diagnostic", { level, message });
}

export async function saveCapturedBody(
  body: CapturedBody,
  suggestedFileName: string,
): Promise<boolean> {
  const extension = suggestedFileName.includes(".")
    ? (suggestedFileName.split(".").pop() ?? "bin")
    : "bin";
  const path = await save({
    title: "Save captured body",
    defaultPath: suggestedFileName,
    filters: [{ name: "Captured body", extensions: [extension] }],
  });
  if (!path) {
    return false;
  }

  await invoke("save_captured_body", {
    path,
    data: body.data,
    format: body.format,
  });
  return true;
}

export function listSessions(): Promise<SessionSummary[]> {
  return invoke("list_sessions");
}

export function loadSessionEvents(sessionId: string): Promise<BridgeEvent[]> {
  return invoke("load_session_events", { sessionId });
}

export function renameSession(sessionId: string, name: string): Promise<void> {
  return invoke("rename_session", { sessionId, name });
}

export function deleteSession(sessionId: string): Promise<void> {
  return invoke("delete_session", { sessionId });
}

export function listenForBridgeEvents(
  callback: (event: BridgeEvent) => void,
): Promise<UnlistenFn> {
  return listen<BridgeEvent>("bridge-event", (event) => callback(event.payload));
}

export function listenForCaptureStatus(
  callback: (snapshot: CaptureStatusSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<CaptureStatusSnapshot>("capture-status", (event) =>
    callback(event.payload),
  );
}

export function listenForBackendWarnings(
  callback: (message: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("backend-warning", (event) => callback(event.payload));
}
