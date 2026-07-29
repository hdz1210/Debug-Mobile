export type CaptureStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed";

export type CaptureConfig = {
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  bodyLimit: number;
};

export type CaptureStatusSnapshot = {
  status: CaptureStatus;
  pid: number | null;
  host: string;
  port: number;
  message: string | null;
};

export type LanAddress = {
  interfaceName: string;
  address: string;
  prefixLength: number;
};

export type NetworkInfo = {
  recommendedAddress: string | null;
  addresses: LanAddress[];
};

export type SessionSummary = {
  id: string;
  startedAt: number;
  endedAt: number | null;
  name: string | null;
  flowCount: number;
  totalSize: number;
};

export type HeaderEntry = [string, string];

export type CapturedBody = {
  format: "text" | "base64";
  contentType?: string;
  data: string;
  size: number;
  truncated: boolean;
};

export type BridgeEvent =
  | {
      event: "request_started";
      flowId: string;
      method: string;
      url: string;
      host: string;
      port: number;
      scheme: string;
      httpVersion: string;
      headers: HeaderEntry[];
      startedAt: number;
    }
  | {
      event: "request_completed";
      flowId: string;
      body: CapturedBody | null;
      endedAt: number | null;
    }
  | {
      event: "response_started";
      flowId: string;
      statusCode: number;
      reason: string;
      httpVersion: string;
      headers: HeaderEntry[];
      startedAt: number;
    }
  | {
      event: "response_completed";
      flowId: string;
      statusCode: number;
      body: CapturedBody | null;
      endedAt: number | null;
      durationMs: number | null;
    }
  | {
      event: "flow_error";
      flowId: string;
      message: string;
    }
  | {
      event: "websocket_message";
      flowId: string;
      direction: "client_to_server" | "server_to_client";
      format: "text" | "base64";
      data: string;
      size: number;
      timestamp: number;
    };

export type WebSocketMessage = {
  id: string;
  direction: "client_to_server" | "server_to_client";
  format: "text" | "base64";
  data: string;
  size: number;
  timestamp: number;
};

export type NetworkFlow = {
  id: string;
  method?: string;
  url?: string;
  host?: string;
  port?: number;
  scheme?: string;
  path?: string;
  httpVersion?: string;
  statusCode?: number;
  reason?: string;
  requestHeaders?: HeaderEntry[];
  responseHeaders?: HeaderEntry[];
  requestBody?: CapturedBody | null;
  responseBody?: CapturedBody | null;
  requestStartedAt?: number;
  requestEndedAt?: number | null;
  responseStartedAt?: number;
  responseEndedAt?: number | null;
  durationMs?: number | null;
  error?: string;
  websocketMessages: WebSocketMessage[];
  state: "requesting" | "waiting" | "completed" | "failed";
};
