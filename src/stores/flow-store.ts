import { create } from "zustand";
import type {
  BridgeEvent,
  CaptureStatusSnapshot,
  NetworkFlow,
} from "../types/events";

const stoppedSnapshot: CaptureStatusSnapshot = {
  status: "stopped",
  pid: null,
  host: "127.0.0.1",
  port: 8080,
  message: null,
};

type FlowStore = {
  flowsById: Record<string, NetworkFlow>;
  orderedFlowIds: string[];
  selectedFlowId: string | null;
  searchQuery: string;
  capture: CaptureStatusSnapshot;
  backendWarning: string | null;
  upsertBridgeEvent: (event: BridgeEvent) => void;
  setCapture: (snapshot: CaptureStatusSnapshot) => void;
  setBackendWarning: (message: string | null) => void;
  setSelectedFlowId: (flowId: string | null) => void;
  setSearchQuery: (query: string) => void;
  clearFlows: () => void;
  reset: () => void;
};

type FlowState = Pick<
  FlowStore,
  | "flowsById"
  | "orderedFlowIds"
  | "selectedFlowId"
  | "searchQuery"
  | "capture"
  | "backendWarning"
>;

const initialState = (): FlowState => ({
  flowsById: {},
  orderedFlowIds: [],
  selectedFlowId: null,
  searchQuery: "",
  capture: { ...stoppedSnapshot },
  backendWarning: null,
});

function emptyFlow(flowId: string): NetworkFlow {
  return {
    id: flowId,
    websocketMessages: [],
    state: "requesting",
  };
}

function pathFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function applyEvent(flow: NetworkFlow, event: BridgeEvent): NetworkFlow {
  switch (event.event) {
    case "request_started":
      return {
        ...flow,
        method: event.method,
        url: event.url,
        host: event.host,
        port: event.port,
        scheme: event.scheme,
        path: pathFromUrl(event.url),
        httpVersion: event.httpVersion,
        requestHeaders: event.headers,
        requestStartedAt: event.startedAt,
        state: "requesting",
      };
    case "request_completed":
      return {
        ...flow,
        requestBody: event.body,
        requestEndedAt: event.endedAt,
        state: flow.state === "failed" ? "failed" : "waiting",
      };
    case "response_started":
      return {
        ...flow,
        statusCode: event.statusCode,
        reason: event.reason,
        httpVersion: event.httpVersion,
        responseHeaders: event.headers,
        responseStartedAt: event.startedAt,
        state: flow.state === "failed" ? "failed" : "waiting",
      };
    case "response_completed":
      return {
        ...flow,
        statusCode: event.statusCode,
        responseBody: event.body,
        responseEndedAt: event.endedAt,
        durationMs: event.durationMs,
        state: flow.state === "failed" ? "failed" : "completed",
      };
    case "flow_error":
      return {
        ...flow,
        error: event.message,
        state: "failed",
      };
    case "websocket_message":
      return {
        ...flow,
        websocketMessages: [
          ...flow.websocketMessages,
          {
            id: `${event.flowId}:${flow.websocketMessages.length}`,
            direction: event.direction,
            format: event.format,
            data: event.data,
            size: event.size,
            timestamp: event.timestamp,
          },
        ],
      };
  }
}

export const useFlowStore = create<FlowStore>((set) => ({
  ...initialState(),
  upsertBridgeEvent: (event) =>
    set((state) => {
      const exists = Object.prototype.hasOwnProperty.call(
        state.flowsById,
        event.flowId,
      );
      const current = state.flowsById[event.flowId] ?? emptyFlow(event.flowId);
      const updated = applyEvent(current, event);

      return {
        flowsById: {
          ...state.flowsById,
          [event.flowId]: updated,
        },
        orderedFlowIds: exists
          ? state.orderedFlowIds
          : [...state.orderedFlowIds, event.flowId],
      };
    }),
  setCapture: (capture) => set({ capture }),
  setBackendWarning: (backendWarning) => set({ backendWarning }),
  setSelectedFlowId: (selectedFlowId) => set({ selectedFlowId }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  clearFlows: () =>
    set({
      flowsById: {},
      orderedFlowIds: [],
      selectedFlowId: null,
    }),
  reset: () => set(initialState()),
}));
