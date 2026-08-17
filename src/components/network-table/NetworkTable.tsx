import type { NetworkFlow } from "../../types/events";
import { analysisLabel } from "../analytics/analytics-format";

type NetworkTableProps = {
  flows: NetworkFlow[];
  totalFlowCount: number;
  selectedFlowId: string | null;
  checkedFlowIds: ReadonlySet<string>;
  isExporting: boolean;
  onSelect: (flowId: string) => void;
  onToggleChecked: (flowId: string, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onExportSelected: () => void;
  onExportAll: () => void;
};

function contentType(flow: NetworkFlow): string {
  const value =
    flow.responseBody?.contentType ?? flow.requestBody?.contentType ?? "";
  const mediaType = value.split(";", 1)[0].toLowerCase();
  if (flow.websocketMessages.length > 0) return "websocket";
  if (mediaType.includes("json")) return "json";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("text/html")) return "document";
  if (mediaType.startsWith("text/")) return "text";
  if (mediaType) return mediaType;
  return "other";
}

function formatBytes(size?: number): string {
  if (size === undefined) return "—";
  if (size < 1_000) return `${size} B`;
  if (size < 1_000_000) return `${(size / 1_000).toFixed(1)} KB`;
  return `${(size / 1_000_000).toFixed(1)} MB`;
}

function formatDuration(duration?: number | null): string {
  if (duration === undefined || duration === null) return "Pending";
  if (duration < 1_000) return `${Math.round(duration)} ms`;
  return `${(duration / 1_000).toFixed(2)} s`;
}

export function NetworkTable({
  flows,
  totalFlowCount,
  selectedFlowId,
  checkedFlowIds,
  isExporting,
  onSelect,
  onToggleChecked,
  onToggleAllVisible,
  onExportSelected,
  onExportAll,
}: NetworkTableProps) {
  const checkedVisibleCount = flows.reduce(
    (count, flow) => count + (checkedFlowIds.has(flow.id) ? 1 : 0),
    0,
  );
  const allVisibleChecked =
    flows.length > 0 && checkedVisibleCount === flows.length;
  const someVisibleChecked =
    checkedVisibleCount > 0 && !allVisibleChecked;

  return (
    <section className="request-list" aria-label="Network requests">
      <div className="panel-heading">
        <div>
          <h2>Network requests</h2>
          <p>
            {flows.length === totalFlowCount
              ? `${totalFlowCount} captured`
              : `${flows.length} of ${totalFlowCount} shown`}
          </p>
        </div>
        <div className="network-export-actions" aria-busy={isExporting}>
          <button
            className="button"
            type="button"
            disabled={isExporting || checkedFlowIds.size === 0}
            onClick={onExportSelected}
          >
            Export selected ({checkedFlowIds.size})
          </button>
          <button
            className="button"
            type="button"
            disabled={isExporting || totalFlowCount === 0}
            onClick={onExportAll}
          >
            Export all ({totalFlowCount})
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="selection-column">
                <input
                  type="checkbox"
                  aria-label="Select all visible requests"
                  aria-checked={
                    someVisibleChecked ? "mixed" : allVisibleChecked
                  }
                  checked={allVisibleChecked}
                  disabled={isExporting || flows.length === 0}
                  ref={(checkbox) => {
                    if (checkbox) {
                      checkbox.indeterminate = someVisibleChecked;
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    onToggleAllVisible(event.currentTarget.checked)
                  }
                />
              </th>
              <th>Method</th>
              <th>Name</th>
              <th>Domain</th>
              <th>Status</th>
              <th>Type</th>
              <th>Size</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {flows.length === 0 ? (
              <tr>
                <td className="empty-state" colSpan={8}>
                  Start capture, configure the target to use this proxy, then
                  make a request.
                </td>
              </tr>
            ) : (
              flows.map((flow) => (
                <tr
                  key={flow.id}
                  className={selectedFlowId === flow.id ? "selected" : ""}
                  data-state={flow.state}
                  onClick={() => onSelect(flow.id)}
                >
                  <td className="selection-cell">
                    <input
                      type="checkbox"
                      aria-label={`Select request ${flow.path ?? flow.url ?? flow.id}`}
                      checked={checkedFlowIds.has(flow.id)}
                      disabled={isExporting}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onToggleChecked(flow.id, event.currentTarget.checked)
                      }
                    />
                  </td>
                  <td className="method" data-method={flow.method ?? ""}>
                    {flow.method ?? "—"}
                  </td>
                  <td className="request-name" title={flow.url}>
                    <div className="request-name-content">
                      <span>{flow.path ?? flow.url ?? flow.id}</span>
                      {flow.analysis ? (
                        <span
                          className="service-badge"
                          data-service={flow.analysis.serviceId}
                          title={`${analysisLabel(flow.analysis)} · ${flow.analysis.status}`}
                        >
                          {analysisLabel(flow.analysis)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>{flow.host ?? "—"}</td>
                  <td>
                    <span
                      className="status-code"
                      data-status={
                        flow.error
                          ? "failed"
                          : String(flow.statusCode ?? "pending")
                      }
                    >
                      {flow.error ? "Failed" : (flow.statusCode ?? "Pending")}
                    </span>
                  </td>
                  <td>{contentType(flow)}</td>
                  <td>
                    {formatBytes(
                      flow.responseBody?.size ?? flow.requestBody?.size,
                    )}
                  </td>
                  <td>{formatDuration(flow.durationMs)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
