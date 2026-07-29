import type { NetworkFlow } from "../../types/events";

type NetworkTableProps = {
  flows: NetworkFlow[];
  selectedFlowId: string | null;
  onSelect: (flowId: string) => void;
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
  selectedFlowId,
  onSelect,
}: NetworkTableProps) {
  return (
    <section className="request-list" aria-label="Network requests">
      <div className="panel-heading">
        <div>
          <h2>Network requests</h2>
          <p>{flows.length} captured</p>
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
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
                <td className="empty-state" colSpan={7}>
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
                  <td className="method">{flow.method ?? "—"}</td>
                  <td className="request-name" title={flow.url}>
                    {flow.path ?? flow.url ?? flow.id}
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
