import { useState } from "react";

type ObjectTreeViewerProps = {
  data: unknown;
  label?: string;
  defaultExpanded?: boolean;
  depth?: number;
};

export function ObjectTreeViewer({
  data,
  label,
  defaultExpanded = true,
  depth = 0,
}: ObjectTreeViewerProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(
    depth === 0 ? defaultExpanded : depth < 2,
  );

  if (data === null) {
    return (
      <div className="tree-node leaf-node" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {label ? <span className="tree-key">{label} : </span> : null}
        <span className="tree-val-null">null</span>
      </div>
    );
  }

  if (typeof data === "undefined") {
    return (
      <div className="tree-node leaf-node" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {label ? <span className="tree-key">{label} : </span> : null}
        <span className="tree-val-null">undefined</span>
      </div>
    );
  }

  if (typeof data === "boolean") {
    return (
      <div className="tree-node leaf-node" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {label ? <span className="tree-key">{label} : </span> : null}
        <span className="tree-val-bool">{data ? "true" : "false"}</span>
      </div>
    );
  }

  if (typeof data === "number") {
    return (
      <div className="tree-node leaf-node" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {label ? <span className="tree-key">{label} : </span> : null}
        <span className="tree-val-number">{data}</span>
      </div>
    );
  }

  if (typeof data === "string") {
    return (
      <div className="tree-node leaf-node" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {label ? <span className="tree-key">{label} : </span> : null}
        <span className="tree-val-string">"{data}"</span>
      </div>
    );
  }

  if (Array.isArray(data)) {
    const count = data.length;
    return (
      <div className="tree-node-group">
        <div
          className="tree-node branch-node"
          onClick={() => setIsExpanded((prev) => !prev)}
          style={{ paddingLeft: `${depth * 1.1}rem` }}
        >
          <span className="tree-arrow">{isExpanded ? "▼" : "▶"}</span>
          {label ? <span className="tree-key">{label} : </span> : null}
          <span className="tree-type-array">Array({count})</span>
          {!isExpanded && count > 0 ? (
            <span className="tree-preview"> [...]</span>
          ) : null}
        </div>
        {isExpanded && (
          <div className="tree-children">
            {data.map((item, idx) => (
              <ObjectTreeViewer
                key={idx}
                data={item}
                defaultExpanded={false}
                depth={depth + 1}
                label={String(idx)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    const count = entries.length;
    return (
      <div className="tree-node-group">
        <div
          className="tree-node branch-node"
          onClick={() => setIsExpanded((prev) => !prev)}
          style={{ paddingLeft: `${depth * 1.1}rem` }}
        >
          <span className="tree-arrow">{isExpanded ? "▼" : "▶"}</span>
          {label ? <span className="tree-key">{label} : </span> : null}
          <span className="tree-type-object">Object</span>
          {!isExpanded && count > 0 ? (
            <span className="tree-preview">
              {" "}
              &#123; {entries.slice(0, 3).map(([k]) => k).join(", ")}
              {count > 3 ? ", ..." : ""} &#125;
            </span>
          ) : null}
        </div>
        {isExpanded && (
          <div className="tree-children">
            {entries.map(([key, value]) => (
              <ObjectTreeViewer
                key={key}
                data={value}
                defaultExpanded={depth < 1}
                depth={depth + 1}
                label={key}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tree-node leaf-node" style={{ paddingLeft: `${depth * 1.1}rem` }}>
      {label ? <span className="tree-key">{label} : </span> : null}
      <span>{String(data)}</span>
    </div>
  );
}
