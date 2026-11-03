import type {
  AnalysisValue,
  FlowAnalysisBundle,
  FlowAnalysisEvent,
  HeaderEntry,
} from "../types/events";

export type SessionEventSource = {
  flowId: string;
  flowUrl: string;
  appName: string | null;
  sessionId: string | null;
  sessionNum: string | null;
  screenName: string;
  timestamp: number;
  event: FlowAnalysisEvent;
  bundle: FlowAnalysisBundle;
};

const GENERIC_USER_AGENT_PRODUCTS = new Set([
  "cfnetwork",
  "dalvik",
  "darwin",
  "mozilla",
  "okhttp",
]);

// iOS apps send "<CFBundleName>/<build> CFNetwork/... Darwin/..." as User-Agent.
export function appNameFromHeaders(headers: HeaderEntry[] | undefined): string | null {
  const userAgent = headers?.find(([name]) => name.toLowerCase() === "user-agent")?.[1];
  const product = userAgent?.trim().split(/\s+/)[0]?.split("/")[0];
  if (!product || GENERIC_USER_AGENT_PRODUCTS.has(product.toLowerCase())) {
    return null;
  }
  try {
    return decodeURIComponent(product);
  } catch {
    return product;
  }
}

function scalarString(value: AnalysisValue | undefined): string | null {
  if (value === null || value === undefined || typeof value === "object") {
    return null;
  }
  const text = String(value);
  return text ? text : null;
}

export function eventTimestampMs(
  event: FlowAnalysisEvent,
  requestStartedAtSeconds: number | undefined,
): number {
  return (
    event.timestampMs ||
    (event.timestampMicros ? Math.floor(event.timestampMicros / 1000) : 0) ||
    // requestStartedAt is in seconds (mitmproxy); GA4 web hits carry no own timestamp.
    (requestStartedAtSeconds ? Math.round(requestStartedAtSeconds * 1000) : 0)
  );
}

export function resolveSessionId(
  event: FlowAnalysisEvent,
  bundle: FlowAnalysisBundle,
): string | null {
  const params = event.parameters || {};
  const userProps = bundle.userProperties || {};
  return (
    scalarString(event.sessionId) ??
    scalarString(bundle.sessionId) ??
    scalarString(params._sid) ??
    scalarString(params.ga_session_id) ??
    scalarString(userProps._sid) ??
    scalarString(userProps.ga_session_id) ??
    // GA4 web (gtag) sends the session as "sid".
    scalarString(params.sid)
  );
}

export function resolveSessionNum(
  event: FlowAnalysisEvent,
  bundle: FlowAnalysisBundle,
): string | null {
  const params = event.parameters || {};
  const userProps = bundle.userProperties || {};
  return (
    scalarString(event.sessionNum) ??
    scalarString(bundle.sessionNum) ??
    scalarString(params._sno) ??
    scalarString(params.ga_session_number) ??
    scalarString(userProps._sno) ??
    scalarString(userProps.ga_session_number) ??
    scalarString(params.sct)
  );
}

export function sessionKey(appId: string | undefined, sessionId: string | null): string {
  return `${appId ?? "unknown-app"}::${sessionId ?? "no-session"}`;
}

function firstDefined<T>(values: Array<T | undefined | null>): T | null {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

export function buildSessionExport(events: SessionEventSource[], exportedAt: Date) {
  const sorted = [...events].sort((left, right) => left.timestamp - right.timestamp);
  const bundles = sorted.map((item) => item.bundle);
  const latestBundle = bundles[bundles.length - 1];
  const screens = Array.from(new Set(sorted.map((item) => item.screenName)));
  const first = sorted[0]?.timestamp;
  const last = sorted[sorted.length - 1]?.timestamp;

  return {
    exportedAt: exportedAt.toISOString(),
    generator: "App Network Debugger",
    app: {
      name: firstDefined(sorted.map((item) => item.appName)),
      appId: firstDefined(bundles.map((bundle) => bundle.appId)),
      appVersion: firstDefined(bundles.map((bundle) => bundle.appVersion)),
      platform: firstDefined(bundles.map((bundle) => bundle.platform)),
      osVersion: firstDefined(bundles.map((bundle) => bundle.osVersion)),
      deviceModel: firstDefined(bundles.map((bundle) => bundle.deviceModel)),
      gmpAppId: firstDefined(bundles.map((bundle) => bundle.gmpAppId)),
      appInstanceId: firstDefined(bundles.map((bundle) => bundle.appInstanceId)),
      firebaseInstanceId: firstDefined(bundles.map((bundle) => bundle.firebaseInstanceId)),
      measurementId: firstDefined(bundles.map((bundle) => bundle.measurementId)),
    },
    session: {
      id: firstDefined(sorted.map((item) => item.sessionId)),
      number: firstDefined(sorted.map((item) => item.sessionNum)),
      startedAt: first ? new Date(first).toISOString() : null,
      endedAt: last ? new Date(last).toISOString() : null,
      durationMs: first && last ? last - first : null,
      eventCount: sorted.length,
      uploadCount: new Set(sorted.map((item) => item.flowId)).size,
      screens,
    },
    userProperties: latestBundle?.userProperties ?? {},
    events: sorted.map((item, index) => ({
      index,
      name: item.event.name,
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : null,
      timestampMs: item.timestamp || null,
      origin: item.event.origin ?? null,
      screen: item.screenName,
      parameters: item.event.parameters || {},
      items: item.event.items || [],
      trackingEndpoint: item.flowUrl,
      flowId: item.flowId,
    })),
  };
}

export function suggestSessionFileName(
  appLabel: string | null,
  sessionId: string | null,
  exportedAt: Date,
): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const stamp = exportedAt.toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
  const parts = [
    "firebase-session",
    appLabel ? safe(appLabel) : null,
    sessionId ? safe(sessionId) : "no-session",
    stamp,
  ].filter(Boolean);
  return `${parts.join("_")}.json`;
}
