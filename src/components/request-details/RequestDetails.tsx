import { useState } from "react";
import type { NetworkFlow } from "../../types/events";
import { AnalyticsPanel } from "../analytics/AnalyticsPanel";
import { BodyViewer } from "./body-viewer";
import { IconCheck, IconCopy } from "../common/Icons";

type RequestDetailsProps = {
  flow: NetworkFlow | null;
};

type DetailTab =
  | "overview"
  | "analytics"
  | "headers"
  | "query"
  | "payload"
  | "response"
  | "timing"
  | "websocket";

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Analytics" },
  { id: "headers", label: "Headers" },
  { id: "query", label: "Query" },
  { id: "payload", label: "Payload" },
  { id: "response", label: "Response" },
  { id: "timing", label: "Timing" },
  { id: "websocket", label: "WebSocket" },
];

function formatTimestamp(timestamp?: number | null): string {
  if (timestamp === undefined || timestamp === null) return "—";
  return new Date(timestamp * 1_000).toLocaleString();
}

function CopyButton({
  text,
  label = "Copy raw",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <button
      className="text-button copy-feedback-btn"
      type="button"
      disabled={!text}
      onClick={handleCopy}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

function OverviewPanel({ flow }: { flow: NetworkFlow }) {
  const details = [
    ["Full URL", flow.url ?? "—"],
    ["Host", flow.host ?? "—"],
    ["Port", String(flow.port ?? "—")],
    ["Scheme", flow.scheme ?? "—"],
    ["Method", flow.method ?? "—"],
    ["Status code", flow.error ? "Failed" : String(flow.statusCode ?? "Pending")],
    ["HTTP version", flow.httpVersion ?? "—"],
    ["Start time", formatTimestamp(flow.requestStartedAt)],
    ["End time", formatTimestamp(flow.responseEndedAt)],
    [
      "Duration",
      flow.durationMs === undefined || flow.durationMs === null
        ? "Pending"
        : `${flow.durationMs.toFixed(2)} ms`,
    ],
    ["Request size", `${flow.requestBody?.size ?? 0} bytes`],
    ["Response size", `${flow.responseBody?.size ?? 0} bytes`],
    ["Error", flow.error ?? "—"],
  ];

  return (
    <dl className="overview-list">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={label === "Duration" || label === "Status code" ? "tabular-nums" : ""}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function HeaderSection({
  title,
  headers,
}: {
  title: string;
  headers?: [string, string][];
}) {
  const raw = headers?.map(([name, value]) => `${name}: ${value}`).join("\n") ?? "";

  return (
    <section className="detail-section">
      <div className="section-title">
        <h3>{title}</h3>
        <CopyButton text={raw} />
      </div>
      {headers?.length ? (
        <table className="key-value-table">
          <tbody>
            {headers.map(([name, value], index) => (
              <tr key={`${name}:${index}`}>
                <th>{name}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="detail-empty">No headers captured.</p>
      )}
    </section>
  );
}

function HeadersPanel({ flow }: { flow: NetworkFlow }) {
  return (
    <div className="detail-stack">
      <HeaderSection title="Request headers" headers={flow.requestHeaders} />
      <HeaderSection title="Response headers" headers={flow.responseHeaders} />
    </div>
  );
}

function QueryPanel({ flow }: { flow: NetworkFlow }) {
  let rawQuery = "";
  let entries: Array<[string, string]> = [];
  try {
    const parsed = new URL(flow.url ?? "");
    rawQuery = parsed.search.slice(1);
    entries = Array.from(parsed.searchParams.entries());
  } catch {
    rawQuery = "";
  }

  if (!entries.length) {
    return <p className="detail-empty">This request has no query parameters.</p>;
  }

  return (
    <section className="detail-section">
      <div className="section-title">
        <h3>Query parameters</h3>
        <CopyButton text={rawQuery} />
      </div>
      <table className="key-value-table">
        <tbody>
          {entries.map(([name, value], index) => (
            <tr key={`${name}:${index}`}>
              <th>{name}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <pre className="raw-block">{rawQuery}</pre>
    </section>
  );
}

function TimingPanel({ flow }: { flow: NetworkFlow }) {
  const requestStart = flow.requestStartedAt;
  const relative = (timestamp?: number | null): string => {
    if (
      requestStart === undefined ||
      timestamp === undefined ||
      timestamp === null
    ) {
      return "—";
    }
    return `${((timestamp - requestStart) * 1_000).toFixed(2)} ms`;
  };

  const rows = [
    ["Request start", formatTimestamp(flow.requestStartedAt), "0.00 ms"],
    [
      "Request ended",
      formatTimestamp(flow.requestEndedAt),
      relative(flow.requestEndedAt),
    ],
    [
      "Response started",
      formatTimestamp(flow.responseStartedAt),
      relative(flow.responseStartedAt),
    ],
    [
      "Response ended",
      formatTimestamp(flow.responseEndedAt),
      relative(flow.responseEndedAt),
    ],
  ];

  return (
    <table className="timing-table">
      <thead>
        <tr>
          <th>Phase</th>
          <th>Timestamp</th>
          <th>Relative</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([phase, timestamp, offset]) => (
          <tr key={phase}>
            <th>{phase}</th>
            <td className="tabular-nums">{timestamp}</td>
            <td className="tabular-nums">{offset}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WebSocketPanel({ flow }: { flow: NetworkFlow }) {
  if (!flow.websocketMessages.length) {
    return <p className="detail-empty">No WebSocket messages recorded.</p>;
  }

  return (
    <div className="websocket-messages">
      {flow.websocketMessages.map((message, index) => (
        <article
          key={`${message.timestamp}:${index}`}
          className="websocket-message"
          data-from-client={message.direction === "client_to_server"}
        >
          <header>
            <span className="direction">
              {message.direction === "client_to_server" ? "Client → Server" : "Server → Client"}
            </span>
            <span className="type">{message.format}</span>
            <time className="tabular-nums">{formatTimestamp(message.timestamp)}</time>
          </header>
          <pre>{message.data ?? `[Binary payload: ${message.size} bytes]`}</pre>
        </article>
      ))}
    </div>
  );
}

export function RequestDetails({ flow }: RequestDetailsProps) {
  const isAnalyticsFlow =
    flow?.analysis?.serviceId === "analytics" ||
    flow?.analysis?.serviceId === "attribution";

  const [activeTab, setActiveTab] = useState<DetailTab>(() =>
    isAnalyticsFlow ? "analytics" : "overview",
  );

  if (!flow) {
    return (
      <aside className="request-details" aria-label="Request details">
        <div className="empty-state">
          <div className="empty-state-content">
            <p className="empty-state-title">No request selected</p>
            <p className="empty-state-hint">
              Select a request from the table to inspect payload, headers, timings, and decoded analytics.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const requestFileName = `${flow.id}-request.bin`;
  const responseFileName = `${flow.id}-response.bin`;

  const visibleTabs = tabs.filter(
    (tab) => tab.id !== "analytics" || isAnalyticsFlow,
  );

  const currentTab = visibleTabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : isAnalyticsFlow
      ? "analytics"
      : "overview";

  return (
    <aside className="request-details" aria-label="Request details">
      <div className="details-header">
        <div className="details-header-title">
          <span className="method-pill" data-method={flow.method ?? ""}>
            {flow.method ?? "HTTP"}
          </span>
          <h2 title={flow.url}>{flow.path ?? flow.url ?? flow.id}</h2>
        </div>
        <CopyButton text={flow.url ?? ""} label="Copy URL" />
      </div>

      <nav className="details-tabs" role="tablist" aria-label="Request detail sections">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            className={`details-tab ${currentTab === tab.id ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "websocket" && flow.websocketMessages.length
              ? ` (${flow.websocketMessages.length})`
              : ""}
          </button>
        ))}
      </nav>

      <div className="tab-panel" role="tabpanel">
        {currentTab === "overview" && <OverviewPanel flow={flow} />}
        {currentTab === "analytics" && flow.analysis && (
          <AnalyticsPanel analysis={flow.analysis} />
        )}
        {currentTab === "headers" && <HeadersPanel flow={flow} />}
        {currentTab === "query" && <QueryPanel flow={flow} />}
        {currentTab === "payload" && (
          <BodyViewer
            body={flow.requestBody}
            emptyMessage="This request has no captured payload."
            suggestedFileName={requestFileName}
          />
        )}
        {currentTab === "response" && (
          <BodyViewer
            body={flow.responseBody}
            emptyMessage={
              flow.state === "completed"
                ? "This response has no captured body."
                : "The response body is still pending."
            }
            imagePreview
            suggestedFileName={responseFileName}
          />
        )}
        {currentTab === "timing" && <TimingPanel flow={flow} />}
        {currentTab === "websocket" && <WebSocketPanel flow={flow} />}
      </div>
    </aside>
  );
}
