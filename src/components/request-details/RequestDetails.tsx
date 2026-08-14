import { useState } from "react";
import type { NetworkFlow } from "../../types/events";
import { AnalyticsPanel } from "../analytics/AnalyticsPanel";
import { BodyViewer } from "./body-viewer";

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

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
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
          <dd>{value}</dd>
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
        <button
          className="text-button"
          type="button"
          disabled={!raw}
          onClick={() => void copyText(raw)}
        >
          Copy raw
        </button>
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
        <button
          className="text-button"
          type="button"
          onClick={() => void copyText(rawQuery)}
        >
          Copy raw
        </button>
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
      "Request end",
      formatTimestamp(flow.requestEndedAt),
      relative(flow.requestEndedAt),
    ],
    [
      "Response start",
      formatTimestamp(flow.responseStartedAt),
      relative(flow.responseStartedAt),
    ],
    [
      "Response end",
      formatTimestamp(flow.responseEndedAt),
      relative(flow.responseEndedAt),
    ],
    [
      "Total duration",
      flow.durationMs === undefined || flow.durationMs === null
        ? "—"
        : `${flow.durationMs.toFixed(2)} ms`,
      "",
    ],
  ];

  return (
    <table className="key-value-table timing-table">
      <tbody>
        {rows.map(([label, absolute, offset]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{absolute}</td>
            <td>{offset}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WebSocketPanel({ flow }: { flow: NetworkFlow }) {
  const [query, setQuery] = useState("");
  const messages = flow.websocketMessages.filter((message) =>
    message.data.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <section className="detail-section">
      <label className="message-search">
        <span className="visually-hidden">Search WebSocket messages</span>
        <input
          type="search"
          value={query}
          placeholder="Search messages…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {messages.length ? (
        <div className="message-list">
          {messages.map((message) => (
            <article className="message-card" key={message.id}>
              <header>
                <span data-direction={message.direction}>
                  {message.direction === "client_to_server" ? "↑ Client" : "↓ Server"}
                </span>
                <time>{formatTimestamp(message.timestamp)}</time>
                <span>{message.size} B</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void copyText(message.data)}
                >
                  Copy
                </button>
              </header>
              <pre>{message.data}</pre>
            </article>
          ))}
        </div>
      ) : (
        <p className="detail-empty">No matching WebSocket messages.</p>
      )}
    </section>
  );
}

export function RequestDetails({ flow }: RequestDetailsProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>(() =>
    flow?.analysis?.serviceId === "analytics" ? "analytics" : "overview",
  );

  if (!flow) {
    return (
      <aside className="request-details empty-details">
        <div>
          <p className="eyebrow">Request details</p>
          <h2>Select a request</h2>
          <p>Headers, payload, response, and timing are attached to each flow.</p>
        </div>
      </aside>
    );
  }

  const requestFileName = `${flow.id}-request.bin`;
  const responseFileName = `${flow.id}-response.bin`;
  const visibleTabs = tabs.filter(
    (tab) => tab.id !== "analytics" || flow.analysis?.serviceId === "analytics",
  );

  return (
    <aside className="request-details">
      <div className="details-header">
        <p className="eyebrow">{flow.method ?? "Request"}</p>
        <h2 title={flow.url}>{flow.path ?? flow.url ?? flow.id}</h2>
      </div>
      <nav className="detail-tabs" aria-label="Request detail sections">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "websocket" && flow.websocketMessages.length
              ? ` (${flow.websocketMessages.length})`
              : ""}
          </button>
        ))}
      </nav>
      <div className="detail-content">
        {activeTab === "overview" ? <OverviewPanel flow={flow} /> : null}
        {activeTab === "analytics" && flow.analysis ? (
          <AnalyticsPanel analysis={flow.analysis} />
        ) : null}
        {activeTab === "headers" ? <HeadersPanel flow={flow} /> : null}
        {activeTab === "query" ? <QueryPanel flow={flow} /> : null}
        {activeTab === "payload" ? (
          <BodyViewer
            body={flow.requestBody}
            emptyMessage="This request has no captured payload."
            suggestedFileName={requestFileName}
          />
        ) : null}
        {activeTab === "response" ? (
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
        ) : null}
        {activeTab === "timing" ? <TimingPanel flow={flow} /> : null}
        {activeTab === "websocket" ? <WebSocketPanel flow={flow} /> : null}
      </div>
    </aside>
  );
}
