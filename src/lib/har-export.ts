import type {
  CapturedBody,
  HeaderEntry,
  NetworkFlow,
} from "../types/events";

export type HarCreator = {
  name: string;
  version: string;
  comment?: string;
};

export type HarPage = {
  startedDateTime: string;
  id: string;
  title: string;
  pageTimings: {
    onContentLoad?: number;
    onLoad?: number;
    comment?: string;
  };
  comment?: string;
};

export type HarHeader = {
  name: string;
  value: string;
  comment?: string;
};

export type HarQueryParam = {
  name: string;
  value: string;
  comment?: string;
};

export type HarCookie = {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  comment?: string;
};

export type HarPostData = {
  mimeType: string;
  text?: string;
  params?: Array<{
    name: string;
    value?: string;
    fileName?: string;
    contentType?: string;
    comment?: string;
  }>;
  comment?: string;
  encoding?: string;
};

export type HarRequest = {
  method: string;
  url: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  queryString: HarQueryParam[];
  postData?: HarPostData;
  headersSize: number;
  bodySize: number;
  comment?: string;
};

export type HarResponseContent = {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
  encoding?: string;
  comment?: string;
};

export type HarResponse = {
  status: number;
  statusText: string;
  httpVersion: string;
  cookies: HarCookie[];
  headers: HarHeader[];
  content: HarResponseContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  comment?: string;
};

export type HarTimings = {
  blocked?: number;
  dns?: number;
  connect?: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
  comment?: string;
};

export type HarWebSocketMessage = {
  type: "send" | "receive";
  time: number;
  opcode: number;
  data: string;
  size: number;
};

export type HarEntry = {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, unknown>;
  timings: HarTimings;
  serverIPAddress?: string;
  connection?: string;
  comment?: string;
  _error?: string;
  _state?: string;
  _webSocketMessages?: HarWebSocketMessage[];
  _analysis?: unknown;
  _firebaseAnalytics?: unknown;
};

export type HarLog = {
  version: "1.2";
  creator: HarCreator;
  pages: HarPage[];
  entries: HarEntry[];
  comment?: string;
};

export type HarRoot = {
  log: HarLog;
};

function parseRequestCookies(headers: HeaderEntry[] = []): HarCookie[] {
  const cookies: HarCookie[] = [];
  for (const [name, value] of headers) {
    if (name.toLowerCase() === "cookie") {
      const parts = value.split(";");
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          cookies.push({
            name: trimmed.slice(0, eqIdx).trim(),
            value: trimmed.slice(eqIdx + 1).trim(),
          });
        } else {
          cookies.push({
            name: trimmed,
            value: "",
          });
        }
      }
    }
  }
  return cookies;
}

function parseResponseCookies(headers: HeaderEntry[] = []): HarCookie[] {
  const cookies: HarCookie[] = [];
  for (const [name, value] of headers) {
    if (name.toLowerCase() === "set-cookie") {
      const parts = value.split(";").map((p) => p.trim());
      const first = parts[0];
      if (first) {
        const eqIdx = first.indexOf("=");
        const cookieName = eqIdx !== -1 ? first.slice(0, eqIdx).trim() : first;
        const cookieVal = eqIdx !== -1 ? first.slice(eqIdx + 1).trim() : "";
        const cookie: HarCookie = { name: cookieName, value: cookieVal };
        for (let i = 1; i < parts.length; i++) {
          const attr = parts[i];
          const attrEq = attr.indexOf("=");
          const attrName = (
            attrEq !== -1 ? attr.slice(0, attrEq) : attr
          ).toLowerCase().trim();
          const attrVal = attrEq !== -1 ? attr.slice(attrEq + 1).trim() : "";
          if (attrName === "path") cookie.path = attrVal;
          else if (attrName === "domain") cookie.domain = attrVal;
          else if (attrName === "expires") cookie.expires = attrVal;
          else if (attrName === "httponly") cookie.httpOnly = true;
          else if (attrName === "secure") cookie.secure = true;
        }
        cookies.push(cookie);
      }
    }
  }
  return cookies;
}

function parseQueryParams(rawUrl?: string, path?: string): HarQueryParam[] {
  const queryParams: HarQueryParam[] = [];
  if (!rawUrl && !path) return queryParams;

  let searchStr = "";
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      searchStr = parsed.search;
    } catch {
      const qIdx = rawUrl.indexOf("?");
      if (qIdx !== -1) {
        searchStr = rawUrl.slice(qIdx);
      }
    }
  }

  if (!searchStr && path) {
    const qIdx = path.indexOf("?");
    if (qIdx !== -1) {
      searchStr = path.slice(qIdx);
    }
  }

  if (searchStr) {
    const params = new URLSearchParams(searchStr);
    params.forEach((value, name) => {
      queryParams.push({ name, value });
    });
  }

  return queryParams;
}

function getRedirectUrl(headers: HeaderEntry[] = []): string {
  const locationHeader = headers.find(
    ([name]) => name.toLowerCase() === "location",
  );
  return locationHeader ? locationHeader[1] : "";
}

function getContentType(headers: HeaderEntry[] = []): string {
  const ct = headers.find(
    ([name]) => name.toLowerCase() === "content-type",
  );
  return ct ? ct[1] : "application/octet-stream";
}

function calculateTimings(flow: NetworkFlow): {
  timings: HarTimings;
  totalTime: number;
} {
  const requestStart = flow.requestStartedAt;
  const requestEnd = flow.requestEndedAt;
  const responseStart = flow.responseStartedAt;
  const responseEnd = flow.responseEndedAt;

  let send = 0;
  let wait = 0;
  let receive = 0;

  if (requestStart !== undefined && requestStart !== null) {
    if (
      requestEnd !== undefined &&
      requestEnd !== null &&
      requestEnd >= requestStart
    ) {
      send = Math.max(0, (requestEnd - requestStart) * 1_000);
    }

    const waitStart =
      requestEnd !== undefined && requestEnd !== null
        ? requestEnd
        : requestStart;

    if (
      responseStart !== undefined &&
      responseStart !== null &&
      responseStart >= waitStart
    ) {
      wait = Math.max(0, (responseStart - waitStart) * 1_000);
    } else if (flow.durationMs !== undefined && flow.durationMs !== null) {
      wait = Math.max(0, flow.durationMs - send);
    }

    if (
      responseStart !== undefined &&
      responseStart !== null &&
      responseEnd !== undefined &&
      responseEnd !== null &&
      responseEnd >= responseStart
    ) {
      receive = Math.max(0, (responseEnd - responseStart) * 1_000);
    }
  }

  let totalTime = flow.durationMs ?? 0;
  if (
    (totalTime === 0 || totalTime === null || totalTime === undefined) &&
    requestStart &&
    responseEnd
  ) {
    totalTime = Math.max(0, (responseEnd - requestStart) * 1_000);
  }
  if (totalTime === 0 && (send > 0 || wait > 0 || receive > 0)) {
    totalTime = send + wait + receive;
  }

  return {
    timings: {
      blocked: -1,
      dns: -1,
      connect: -1,
      send: Number(send.toFixed(2)),
      wait: Number(wait.toFixed(2)),
      receive: Number(receive.toFixed(2)),
      ssl: -1,
    },
    totalTime: Number(totalTime.toFixed(2)),
  };
}

function formatPostData(
  body?: CapturedBody | null,
): HarPostData | undefined {
  if (!body) return undefined;
  const postData: HarPostData = {
    mimeType: body.contentType || "application/octet-stream",
    text: body.data,
  };
  if (body.format === "base64") {
    postData.encoding = "base64";
  }
  if (body.truncated) {
    postData.comment = `Body truncated. Original decoded size: ${body.size} bytes.`;
  }
  return postData;
}

function formatResponseContent(
  body?: CapturedBody | null,
  headers: HeaderEntry[] = [],
): HarResponseContent {
  if (!body) {
    return {
      size: 0,
      mimeType: getContentType(headers),
    };
  }

  const content: HarResponseContent = {
    size: body.size,
    mimeType: body.contentType || getContentType(headers),
    text: body.data,
  };
  if (body.format === "base64") {
    content.encoding = "base64";
  }
  if (body.truncated) {
    content.comment = `Body truncated. Original decoded size: ${body.size} bytes.`;
  }
  return content;
}

export function flowToHarEntry(
  flow: NetworkFlow,
  exportedAt = new Date(),
): HarEntry {
  const startedDateTime = flow.requestStartedAt
    ? new Date(flow.requestStartedAt * 1_000).toISOString()
    : exportedAt.toISOString();

  const { timings, totalTime } = calculateTimings(flow);

  const requestHeaders = flow.requestHeaders ?? [];
  const responseHeaders = flow.responseHeaders ?? [];

  const requestUrl =
    flow.url ??
    (flow.host
      ? `${flow.scheme ?? "http"}://${flow.host}${flow.port ? `:${flow.port}` : ""}${flow.path ?? "/"}`
      : flow.path ?? "");

  const entry: HarEntry = {
    startedDateTime,
    time: totalTime,
    request: {
      method: flow.method ?? "GET",
      url: requestUrl,
      httpVersion: flow.httpVersion ?? "HTTP/1.1",
      cookies: parseRequestCookies(requestHeaders),
      headers: requestHeaders.map(([name, value]) => ({ name, value })),
      queryString: parseQueryParams(flow.url, flow.path),
      postData: formatPostData(flow.requestBody),
      headersSize: -1,
      bodySize: flow.requestBody ? flow.requestBody.size : 0,
    },
    response: {
      status: flow.statusCode ?? 0,
      statusText:
        flow.reason ??
        (flow.statusCode
          ? ""
          : flow.error
            ? "Failed"
            : flow.state === "completed"
              ? "OK"
              : "Pending"),
      httpVersion: flow.httpVersion ?? "HTTP/1.1",
      cookies: parseResponseCookies(responseHeaders),
      headers: responseHeaders.map(([name, value]) => ({ name, value })),
      content: formatResponseContent(flow.responseBody, responseHeaders),
      redirectURL: getRedirectUrl(responseHeaders),
      headersSize: -1,
      bodySize: flow.responseBody ? flow.responseBody.size : 0,
    },
    cache: {},
    timings,
    serverIPAddress: flow.host,
    connection:
      flow.port !== undefined && flow.port !== null
        ? String(flow.port)
        : undefined,
  };

  if (flow.error) {
    entry._error = flow.error;
  }
  if (flow.state) {
    entry._state = flow.state;
  }
  if (flow.websocketMessages && flow.websocketMessages.length > 0) {
    entry._webSocketMessages = flow.websocketMessages.map((msg) => ({
      type: msg.direction === "client_to_server" ? "send" : "receive",
      time: msg.timestamp,
      opcode: msg.format === "text" ? 1 : 2,
      data: msg.data,
      size: msg.size,
    }));
  }
  if (flow.analysis) {
    entry._analysis = flow.analysis;
    entry._firebaseAnalytics = flow.analysis;
  }

  return entry;
}

export function buildHar(
  flows: NetworkFlow[],
  exportedAt = new Date(),
): HarRoot {
  return {
    log: {
      version: "1.2",
      creator: {
        name: "App Network Debugger",
        version: "0.1.7",
      },
      pages: [],
      entries: flows.map((flow) => flowToHarEntry(flow, exportedAt)),
    },
  };
}

export function serializeHar(
  flows: NetworkFlow[],
  exportedAt = new Date(),
): string {
  const har = buildHar(flows, exportedAt);
  return JSON.stringify(har, null, 2);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatHarTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function suggestHarFileName(
  scope: "selected" | "all",
  exportedAt = new Date(),
): string {
  const timestamp = formatHarTimestamp(exportedAt);
  return `network-requests-${scope}-${timestamp}.har`;
}
