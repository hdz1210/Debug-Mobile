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

type AnalyticsPanelProps = {
  analysis: FlowAnalysis;
};

function formatConfidence(confidence: number): string {
  const percentage = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(Math.max(0, Math.min(100, percentage)))}%`;
}

function formatEventTimestamp(event: FlowAnalysisEvent): string | null {
  if (event.timestampMs !== undefined) {
    return new Date(event.timestampMs).toLocaleString();
  }
  if (event.timestampMicros !== undefined) {
    return new Date(event.timestampMicros / 1_000).toLocaleString();
  }
  return null;
}

function ObjectTable({
  values,
  emptyMessage,
}: {
  values: Record<string, AnalysisValue>;
  emptyMessage: string;
}) {
  const entries = Object.entries(values);
  if (!entries.length) {
    return <p className="analytics-empty-inline">{emptyMessage}</p>;
  }

  return (
    <table className="key-value-table analytics-value-table">
      <tbody>
        {entries.map(([name, value]) => (
          <tr key={name}>
            <th>{name}</th>
            <td>
              <pre>{formatAnalysisValue(value)}</pre>
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
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EventCard({
  event,
  index,
}: {
  event: FlowAnalysisEvent;
  index: number;
}) {
  const timestamp = formatEventTimestamp(event);

  return (
    <article className="analytics-event-card">
      <header>
        <span className="analytics-event-index">{index + 1}</span>
        <h4>{event.name}</h4>
        {event.origin ? <span>Origin: {event.origin}</span> : null}
        {timestamp ? <time>{timestamp}</time> : null}
      </header>

      <details open>
        <summary>
          Parameters <span>{Object.keys(event.parameters).length}</span>
        </summary>
        <ObjectTable
          values={event.parameters}
          emptyMessage="No event parameters were decoded."
        />
      </details>

      {event.items.length ? (
        <details open>
          <summary>
            Items <span>{event.items.length}</span>
          </summary>
          <div className="analytics-items">
            {event.items.map((item, itemIndex) => (
              <section key={itemIndex} className="analytics-item">
                <h5>Item {itemIndex + 1}</h5>
                <ObjectTable values={item} emptyMessage="This item is empty." />
              </section>
            ))}
          </div>
        </details>
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
  const title =
    bundle.appName ?? bundle.appId ?? bundle.measurementId ?? `Bundle ${index + 1}`;

  return (
    <article className="analytics-bundle">
      <header className="analytics-bundle-header">
        <div>
          <p className="eyebrow">Bundle {index + 1}</p>
          <h3>{title}</h3>
        </div>
        <span>{bundle.events.length} events</span>
      </header>

      <BundleMetadata bundle={bundle} />

      <details className="analytics-property-section">
        <summary>
          User properties <span>{Object.keys(bundle.userProperties).length}</span>
        </summary>
        <ObjectTable
          values={bundle.userProperties}
          emptyMessage="No user properties were decoded."
        />
      </details>

      <details className="analytics-property-section">
        <summary>
          Consent <span>{Object.keys(bundle.consent).length}</span>
        </summary>
        <ObjectTable
          values={bundle.consent}
          emptyMessage="No consent state was decoded."
        />
      </details>

      {bundle.events.length ? (
        <div className="analytics-events">
          {bundle.events.map((event, eventIndex) => (
            <EventCard
              event={event}
              index={eventIndex}
              key={`${event.name}:${eventIndex}`}
            />
          ))}
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

  return (
    <section className="analytics-panel" aria-label="Analytics analysis">
      <header className="analytics-summary">
        <div>
          <p className="eyebrow">Analysis</p>
          <h3>{analysisLabel(analysis)}</h3>
          <p>
            {analysis.protocol} · parser {analysis.parserVersion}
            {analysis.platform ? ` · ${analysis.platform}` : ""}
          </p>
        </div>
        <div className="analytics-summary-stats">
          <span>
            <strong>{analysis.bundles.length}</strong> bundles
          </span>
          <span>
            <strong>{eventCount}</strong> events
          </span>
          <span>
            <strong>{formatConfidence(analysis.confidence)}</strong> confidence
          </span>
          <span className="analysis-status" data-status={normalizedStatus}>
            {humanizeAnalysisStatus(analysis.status)}
          </span>
        </div>
      </header>

      {analysis.tags.length ? (
        <div className="analytics-tags" aria-label="Analysis tags">
          {analysis.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}

      {analysis.warnings.length ? (
        <section className="analytics-warnings" role="status">
          <strong>Decoder warnings</strong>
          <ul>
            {analysis.warnings.map((warning, index) => (
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
