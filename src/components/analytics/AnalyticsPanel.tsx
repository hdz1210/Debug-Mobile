import { useMemo, useState } from "react";
import type {
  AnalysisValue,
  FlowAnalysis,
  FlowAnalysisBundle,
  FlowAnalysisEvent,
} from "../../types/events";
import {
  analysisLabel,
  formatAnalysisValue,
  humanizeAnalysisStatus,
} from "./analytics-format";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconCopy,
  IconSearch,
} from "../common/Icons";

type AnalyticsPanelProps = {
  analysis: FlowAnalysis;
};

type EventCategory = "ecommerce" | "screen_view" | "engagement" | "session" | "custom";

function formatConfidence(confidence: number): string {
  const percentage = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(Math.max(0, Math.min(100, percentage)))}%`;
}

function formatEventTimestamp(event: FlowAnalysisEvent): string | null {
  if (event.timestampMs !== undefined) {
    return new Date(event.timestampMs).toLocaleTimeString();
  }
  if (event.timestampMicros !== undefined) {
    return new Date(event.timestampMicros / 1_000).toLocaleTimeString();
  }
  return null;
}

function formatFullTimestamp(event: FlowAnalysisEvent): string | null {
  if (event.timestampMs !== undefined) {
    return new Date(event.timestampMs).toLocaleString();
  }
  if (event.timestampMicros !== undefined) {
    return new Date(event.timestampMicros / 1_000).toLocaleString();
  }
  return null;
}

function getEventCategory(name: string): {
  category: EventCategory;
  label: string;
} {
  const lower = name.toLowerCase();
  if (lower === "_vs" || lower.includes("screen")) {
    return { category: "screen_view", label: "Screen View" };
  }
  if (
    [
      "view_item",
      "view_item_list",
      "add_to_cart",
      "remove_from_cart",
      "view_cart",
      "begin_checkout",
      "purchase",
      "add_payment_info",
      "add_shipping_info",
      "refund",
    ].includes(lower)
  ) {
    return { category: "ecommerce", label: "E-Commerce" };
  }
  if (["_s", "session_start", "first_open", "app_open"].includes(lower)) {
    return { category: "session", label: "Session" };
  }
  if (["_e", "user_engagement", "app_exception", "app_update"].includes(lower)) {
    return { category: "engagement", label: "Engagement" };
  }
  return { category: "custom", label: "Custom Event" };
}

function getHeroChips(
  parameters: Record<string, AnalysisValue>,
): Array<{ key: string; label: string; value: string }> {
  const chips: Array<{ key: string; label: string; value: string }> = [];

  const heroKeys: Array<{ key: string; label: string }> = [
    { key: "screen_type", label: "Screen" },
    { key: "screen_name", label: "Screen" },
    { key: "firebase_screen", label: "Screen" },
    { key: "_sn", label: "Screen Name" },
    { key: "_pn", label: "Prev Screen" },
    { key: "item_category", label: "Category" },
    { key: "item_category2", label: "Sub-cat" },
    { key: "location_id", label: "Location" },
    { key: "cart_type", label: "Cart" },
    { key: "currency", label: "Currency" },
    { key: "value", label: "Value" },
    { key: "item_name", label: "Item" },
    { key: "item_id", label: "SKU" },
    { key: "user_id", label: "User" },
  ];

  for (const { key, label } of heroKeys) {
    if (key in parameters) {
      const raw = parameters[key];
      if (raw !== null && raw !== undefined && raw !== "") {
        chips.push({
          key,
          label,
          value: String(raw),
        });
      }
    }
  }

  return chips.slice(0, 5);
}

function ObjectTable({
  values,
  emptyMessage,
}: {
  values: Record<string, AnalysisValue>;
  emptyMessage: string;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const entries = Object.entries(values);

  if (!entries.length) {
    return <p className="analytics-empty-inline">{emptyMessage}</p>;
  }

  const handleCopy = async (key: string, val: AnalysisValue) => {
    try {
      const text =
        typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <table className="key-value-table analytics-value-table">
      <tbody>
        {entries.map(([name, value]) => (
          <tr key={name}>
            <th className="param-name-cell">
              <span>{name}</span>
            </th>
            <td
              className="param-value-cell"
              title="Click to copy value"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void handleCopy(name, value);
                }
              }}
              onClick={() => void handleCopy(name, value)}
            >
              <div className="param-value-wrap">
                <pre>{formatAnalysisValue(value)}</pre>
                {copiedKey === name ? (
                  <span className="copy-tag">
                    <IconCheck size={11} />
                    <span>Copied!</span>
                  </span>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BundleMetadata({ bundle }: { bundle: FlowAnalysisBundle }) {
  const metadata = [
    ["App ID", bundle.appId],
    ["App name", bundle.appName],
    ["App version", bundle.appVersion],
    ["Platform", bundle.platform],
    ["Measurement ID", bundle.measurementId],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  if (!metadata.length) return null;

  return (
    <dl className="analytics-metadata">
      {metadata.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventCard({
  event,
  index,
  isOpen,
  onToggle,
}: {
  event: FlowAnalysisEvent;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const timeStr = formatEventTimestamp(event);
  const fullTime = formatFullTimestamp(event);
  const { category, label: categoryLabel } = getEventCategory(event.name);
  const heroChips = getHeroChips(event.parameters);
  const paramCount = Object.keys(event.parameters).length;

  const copyEventJson = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const data = JSON.stringify(event, null, 2);
      await navigator.clipboard.writeText(data);
      setCopyStatus("Copied!");
      setTimeout(() => setCopyStatus(null), 1500);
    } catch {
      setCopyStatus("Failed");
    }
  };

  return (
    <article
      className="analytics-event-card"
      data-category={category}
      data-open={isOpen}
    >
      <header className="event-card-header" onClick={onToggle}>
        <div className="event-header-left">
          <span className="event-index-pill tabular-nums">#{index + 1}</span>
          <h4 className="event-title">{event.name}</h4>
          <span className="event-category-badge" data-category={category}>
            {categoryLabel}
          </span>
        </div>

        <div className="event-header-right">
          {event.origin ? (
            <span className="event-meta-pill origin-pill" title="Event origin">
              {event.origin}
            </span>
          ) : null}

          {timeStr ? (
            <time className="event-meta-pill time-pill tabular-nums" title={fullTime ?? ""}>
              {timeStr}
            </time>
          ) : null}

          <span className="event-meta-pill param-count-pill tabular-nums">
            {paramCount} {paramCount === 1 ? "param" : "params"}
          </span>

          {event.items.length ? (
            <span className="event-meta-pill items-count-pill tabular-nums">
              {event.items.length} {event.items.length === 1 ? "item" : "items"}
            </span>
          ) : null}

          <button
            type="button"
            className="event-copy-btn"
            title="Copy full event JSON"
            onClick={copyEventJson}
          >
            {copyStatus ? (
              <>
                <IconCheck size={11} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <IconCopy size={11} />
                <span>Copy JSON</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="event-toggle-btn"
            aria-label={isOpen ? "Collapse event" : "Expand event"}
            aria-expanded={isOpen}
          >
            {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        </div>
      </header>

      {/* Hero chips row */}
      {heroChips.length > 0 ? (
        <div className="event-hero-chips" onClick={onToggle}>
          {heroChips.map((chip) => (
            <span key={chip.key} className="hero-chip">
              <strong className="chip-label">{chip.label}:</strong>{" "}
              <span className="chip-value">{chip.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <div className="event-card-body">
          <div className="event-details-section">
            <h5 className="section-label">
              Parameters ({paramCount})
            </h5>
            <ObjectTable
              values={event.parameters}
              emptyMessage="No event parameters were decoded."
            />
          </div>

          {event.items.length ? (
            <div className="event-details-section items-section">
              <h5 className="section-label">
                Items ({event.items.length})
              </h5>
              <div className="analytics-items-grid">
                {event.items.map((item, itemIndex) => (
                  <section key={itemIndex} className="analytics-item-card">
                    <header className="item-card-header">
                      <h6>Item #{itemIndex + 1}</h6>
                    </header>
                    <ObjectTable values={item} emptyMessage="This item is empty." />
                  </section>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function BundleCard({
  bundle,
  index,
}: {
  bundle: FlowAnalysisBundle;
  index: number;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [openStates, setOpenStates] = useState<Record<number, boolean>>({});
  const [defaultAllOpen, setDefaultAllOpen] = useState(true);

  const title =
    bundle.appName ?? bundle.appId ?? bundle.measurementId ?? `Bundle ${index + 1}`;

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return bundle.events;

    return bundle.events.filter((event) => {
      if (event.name.toLowerCase().includes(query)) return true;
      if (event.origin && event.origin.toLowerCase().includes(query)) return true;
      // Search inside parameters
      for (const [k, v] of Object.entries(event.parameters)) {
        if (k.toLowerCase().includes(query)) return true;
        if (String(v).toLowerCase().includes(query)) return true;
      }
      // Search inside items
      for (const item of event.items) {
        for (const [k, v] of Object.entries(item)) {
          if (k.toLowerCase().includes(query)) return true;
          if (String(v).toLowerCase().includes(query)) return true;
        }
      }
      return false;
    });
  }, [bundle.events, searchQuery]);

  const handleToggleEvent = (eventIndex: number) => {
    setOpenStates((prev) => {
      const current = prev[eventIndex] ?? defaultAllOpen;
      return { ...prev, [eventIndex]: !current };
    });
  };

  const handleToggleAll = (expand: boolean) => {
    setDefaultAllOpen(expand);
    const nextStates: Record<number, boolean> = {};
    bundle.events.forEach((_, idx) => {
      nextStates[idx] = expand;
    });
    setOpenStates(nextStates);
  };

  return (
    <article className="analytics-bundle">
      <header className="analytics-bundle-header">
        <div>
          <p className="eyebrow">Bundle #{index + 1}</p>
          <h3>{title}</h3>
        </div>
        <span className="bundle-events-pill tabular-nums">
          {bundle.events.length} {bundle.events.length === 1 ? "event" : "events"}
        </span>
      </header>

      <BundleMetadata bundle={bundle} />

      {Object.keys(bundle.userProperties).length > 0 ? (
        <details className="analytics-property-section">
          <summary>
            User properties ({Object.keys(bundle.userProperties).length})
          </summary>
          <ObjectTable
            values={bundle.userProperties}
            emptyMessage="No user properties were decoded."
          />
        </details>
      ) : null}

      {Object.keys(bundle.consent).length > 0 ? (
        <details className="analytics-property-section">
          <summary>
            Consent ({Object.keys(bundle.consent).length})
          </summary>
          <ObjectTable
            values={bundle.consent}
            emptyMessage="No consent state was decoded."
          />
        </details>
      ) : null}

      {bundle.events.length ? (
        <div className="analytics-events-container">
          <div className="analytics-events-toolbar">
            <div className="events-search-wrap">
              <IconSearch size={13} className="search-icon" />
              <input
                type="search"
                className="events-search-input"
                placeholder="Search events by name or parameter..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery("")}
                >
                  <IconClose size={12} />
                </button>
              ) : null}
            </div>

            <div className="events-actions-wrap">
              <span className="events-counter-badge tabular-nums">
                {filteredEvents.length === bundle.events.length
                  ? `${bundle.events.length} events`
                  : `${filteredEvents.length} of ${bundle.events.length} events`}
              </span>
              <button
                type="button"
                className="action-pill-btn"
                onClick={() => handleToggleAll(true)}
              >
                Expand all
              </button>
              <button
                type="button"
                className="action-pill-btn"
                onClick={() => handleToggleAll(false)}
              >
                Collapse all
              </button>
            </div>
          </div>

          {filteredEvents.length > 0 ? (
            <div className="analytics-events-list">
              {filteredEvents.map((event) => {
                const originalIndex = bundle.events.indexOf(event);
                const isCardOpen =
                  openStates[originalIndex] ?? defaultAllOpen;

                return (
                  <EventCard
                    event={event}
                    index={originalIndex}
                    isOpen={isCardOpen}
                    onToggle={() => handleToggleEvent(originalIndex)}
                    key={`${event.name}:${originalIndex}`}
                  />
                );
              })}
            </div>
          ) : (
            <p className="analytics-empty-inline search-no-results">
              No events matched &ldquo;{searchQuery}&rdquo;.
            </p>
          )}
        </div>
      ) : (
        <p className="analytics-empty-inline">
          No analytics events were decoded from this bundle.
        </p>
      )}
    </article>
  );
}

export function AnalyticsPanel({ analysis }: AnalyticsPanelProps) {
  const eventCount = analysis.bundles.reduce(
    (count, bundle) => count + bundle.events.length,
    0,
  );
  const normalizedStatus = analysis.status.toLowerCase();
  const unavailable = ["unsupported", "failed", "error"].includes(
    normalizedStatus,
  );

  // Filter out harmless internal schema notices
  const visibleWarnings = analysis.warnings.filter(
    (w) =>
      !w.includes("bundle contains unsupported field") &&
      !w.includes("App identifiers and versions are omitted"),
  );

  return (
    <section className="analytics-panel" aria-label="Analytics analysis">
      <header className="analytics-summary">
        <div>
          <p className="eyebrow">Analysis</p>
          <h3>{analysisLabel(analysis)}</h3>
          <p className="analytics-protocol-line">
            {analysis.protocol} · parser {analysis.parserVersion}
            {analysis.platform ? ` · ${analysis.platform}` : ""}
          </p>
        </div>
        <div className="analytics-summary-stats">
          <span className="summary-stat-pill">
            <strong className="tabular-nums">{analysis.bundles.length}</strong> bundles
          </span>
          <span className="summary-stat-pill">
            <strong className="tabular-nums">{eventCount}</strong> events
          </span>
          <span className="summary-stat-pill">
            <strong className="tabular-nums">{formatConfidence(analysis.confidence)}</strong> confidence
          </span>
          <span className="analysis-status-badge" data-status={normalizedStatus}>
            {humanizeAnalysisStatus(analysis.status)}
          </span>
        </div>
      </header>

      {analysis.tags.length ? (
        <div className="analytics-tags" aria-label="Analysis tags">
          {analysis.tags.map((tag) => (
            <span key={tag} className="analytics-tag-pill">{tag}</span>
          ))}
        </div>
      ) : null}

      {visibleWarnings.length ? (
        <section className="analytics-warnings" role="status">
          <strong>Decoder warnings</strong>
          <ul>
            {visibleWarnings.map((warning, index) => (
              <li key={`${warning}:${index}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {analysis.bundles.length ? (
        <div className="analytics-bundles">
          {analysis.bundles.map((bundle, index) => (
            <BundleCard
              bundle={bundle}
              index={index}
              key={bundle.appId ?? bundle.measurementId ?? index}
            />
          ))}
        </div>
      ) : (
        <div className="analytics-empty-state" data-status={normalizedStatus}>
          <h3>
            {unavailable
              ? "Analytics payload is not available"
              : "No analytics events decoded"}
          </h3>
          <p>
            {unavailable
              ? "The request was identified, but this payload format or schema is not supported by the current parser. The raw payload is still available in the Payload tab."
              : "The request was identified as analytics traffic, but it did not contain a decoded event bundle. Check the decoder warnings or inspect the raw payload."}
          </p>
        </div>
      )}
    </section>
  );
}
