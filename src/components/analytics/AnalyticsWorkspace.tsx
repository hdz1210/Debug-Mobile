import { useMemo, useState } from "react";
import type { FlowAnalysisBundle, FlowAnalysisEvent, NetworkFlow } from "../../types/events";
import { ObjectTreeViewer } from "./ObjectTreeViewer";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFlame,
  IconSearch,
  IconTrash,
} from "../common/Icons";

type ViewMode = "flat" | "batch" | "screen";
export type ProviderTab = "firebase" | "branch" | "all";

type FlattenedEvent = {
  id: string;
  globalIndex: number;
  flowId: string;
  flowUrl: string;
  providerId: string;
  event: FlowAnalysisEvent;
  bundle: FlowAnalysisBundle;
  screenName: string;
  timestamp: number;
};

type AnalyticsWorkspaceProps = {
  flows: NetworkFlow[];
  activeProvider: ProviderTab;
  onSelectProvider?: (provider: ProviderTab) => void;
  onClearFlows?: () => void;
};

const SYSTEM_KEYS = new Set([
  "_o",
  "_sc",
  "_si",
  "_sn",
  "_sno",
  "_sid",
  "_lte",
  "_se",
  "_fi",
  "_fot",
  "_id",
  "_previousTimestampMs",
  "firebase_event_origin",
  "firebase_screen",
  "firebase_screen_class",
  "firebase_screen_id",
]);

export function AnalyticsWorkspace({
  flows,
  activeProvider,
  onClearFlows,
}: AnalyticsWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hideSystemParams, setHideSystemParams] = useState(true);
  const [eventDataTab, setEventDataTab] = useState<"params" | "user_props">("params");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Accordion open states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    overview: true,
    eventData: true,
    ecommerce: true,
    consent: false,
    audience: false,
    shared: false,
    raw: true,
  });

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Flatten all decoded analytics events
  const allFlattenedEvents = useMemo(() => {
    const list: FlattenedEvent[] = [];
    let idx = 0;

    for (const flow of flows) {
      const analysis = flow.analysis;
      if (!analysis || !analysis.bundles) continue;

      const providerId = analysis.providerId || "firebase";

      for (const bundle of analysis.bundles) {
        for (const ev of bundle.events) {
          const params = ev.parameters || {};
          const screenName = String(
            params._sn ||
              params._sc ||
              params.firebase_screen ||
              params.screen_name ||
              "(No Screen)",
          );
          const timestamp =
            ev.timestampMs ||
            (ev.timestampMicros ? Math.floor(ev.timestampMicros / 1000) : 0) ||
            flow.requestStartedAt ||
            0;

          list.push({
            id: `${flow.id}_${bundle.bundleSequentialIndex || 0}_${ev.name}_${idx}`,
            globalIndex: idx++,
            flowId: flow.id,
            flowUrl: flow.url ?? "",
            providerId,
            event: ev,
            bundle,
            screenName,
            timestamp,
          });
        }
      }
    }

    return list;
  }, [flows]);

  // Filter events by Active Provider & Search Query
  const filteredEvents = useMemo(() => {
    return allFlattenedEvents.filter((item) => {
      // 1. Filter by provider tab
      if (activeProvider !== "all" && item.providerId !== activeProvider) {
        return false;
      }

      // 2. Filter by search query
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();

      if (item.event.name.toLowerCase().includes(q)) return true;
      if (item.screenName.toLowerCase().includes(q)) return true;
      if (item.bundle.appId && item.bundle.appId.toLowerCase().includes(q)) return true;

      // Check in parameters
      const params = item.event.parameters || {};
      for (const [k, v] of Object.entries(params)) {
        if (k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
          return true;
        }
      }

      return false;
    });
  }, [allFlattenedEvents, activeProvider, searchQuery]);

  // Current selected event
  const selectedEvent = useMemo(() => {
    if (!filteredEvents.length) return null;
    if (selectedEventId) {
      const found = filteredEvents.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    return filteredEvents[filteredEvents.length - 1]; // default to latest
  }, [filteredEvents, selectedEventId]);

  // Groupings
  const groupedBatches = useMemo(() => {
    const map = new Map<string, FlattenedEvent[]>();
    for (const ev of filteredEvents) {
      if (!map.has(ev.flowId)) map.set(ev.flowId, []);
      map.get(ev.flowId)!.push(ev);
    }
    return Array.from(map.entries()).map(([flowId, events]) => ({
      flowId,
      events,
    }));
  }, [filteredEvents]);

  const groupedScreens = useMemo(() => {
    const map = new Map<string, FlattenedEvent[]>();
    for (const ev of filteredEvents) {
      if (!map.has(ev.screenName)) map.set(ev.screenName, []);
      map.get(ev.screenName)!.push(ev);
    }
    return Array.from(map.entries()).map(([screenName, events]) => ({
      screenName,
      events,
    }));
  }, [filteredEvents]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Ignore
    }
  };

  const handleExportAllJson = () => {
    const jsonStr = JSON.stringify(
      filteredEvents.map((e) => ({
        event: e.event,
        bundle: e.bundle,
        tracking_endpoint: e.flowUrl,
      })),
      null,
      2,
    );
    void handleCopy(jsonStr, "export-all");
  };

  // Extract overview parameters for selected event
  const overviewFields = useMemo(() => {
    if (!selectedEvent) return [];
    const b = selectedEvent.bundle;
    const ev = selectedEvent.event;
    const evParams = ev.parameters || {};

    const trackingEndpoint = selectedEvent.flowUrl;
    const appId = b.appId || ev.appId || evParams.app_id || "(not set)";
    const appInstanceId = b.appInstanceId || "(not set)";
    const firebaseInstanceId = b.firebaseInstanceId || "(not set)";
    const gmpAppId = b.gmpAppId || "(not set)";
    const sessionId =
      ev.sessionId ||
      b.sessionId ||
      evParams._sid ||
      evParams.ga_session_id ||
      "(not set)";
    const sessionNum =
      ev.sessionNum ??
      b.sessionNum ??
      evParams._sno ??
      evParams.ga_session_number ??
      "(not set)";

    return [
      { key: "tracking_endpoint", label: "tracking_endpoint", value: trackingEndpoint },
      { key: "app_id", label: "app_id", value: String(appId) },
      { key: "app_instance_id", label: "app_instance_id", value: String(appInstanceId) },
      { key: "firebase_instance_id", label: "firebase_instance_id", value: String(firebaseInstanceId) },
      { key: "gmp_app_id", label: "gmp_app_id", value: String(gmpAppId) },
      { key: "session_id", label: "session_id", value: String(sessionId) },
      { key: "session_num", label: "session_num", value: String(sessionNum) },
    ];
  }, [selectedEvent]);

  // Parameters filtered by Hide System toggle
  const eventParameters = useMemo(() => {
    if (!selectedEvent) return [];
    const params = selectedEvent.event.parameters || {};
    return Object.entries(params).filter(([key]) => {
      if (hideSystemParams) {
        return !SYSTEM_KEYS.has(key) && !key.startsWith("_") && !key.startsWith("firebase_");
      }
      return true;
    });
  }, [selectedEvent, hideSystemParams]);

  // User properties list
  const userPropertiesList = useMemo(() => {
    if (!selectedEvent) return [];
    const userProps = selectedEvent.bundle.userProperties || {};
    return Object.entries(userProps);
  }, [selectedEvent]);

  // Shared bundle metadata
  const sharedMetadataList = useMemo(() => {
    if (!selectedEvent) return [];
    const shared = selectedEvent.bundle.shared || {};
    return Object.entries(shared);
  }, [selectedEvent]);

  return (
    <div className="analytics-workspace-root">
      {/* Main Workspace Split Layout */}
      <div className="analytics-body-layout">
        {/* Left Sidebar: Filter, Modes & Event Stream */}
        <aside className="analytics-sidebar" aria-label="Analytics event stream">
          {/* Header Controls */}
          <div className="sidebar-header-bar">
            <div className="sidebar-filter-box">
              <IconSearch className="search-icon" size={13} />
              <input
                className="sidebar-search-input"
                placeholder="Filter events, params, app ID…"
                type="search"
                aria-label="Filter analytics events"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="sidebar-actions-row">
              <div className="view-mode-bar" role="group" aria-label="Event grouping modes">
                <button
                  className={`mode-btn ${viewMode === "flat" ? "active" : ""}`}
                  type="button"
                  aria-pressed={viewMode === "flat"}
                  onClick={() => setViewMode("flat")}
                >
                  Flat
                </button>
                <button
                  className={`mode-btn ${viewMode === "batch" ? "active" : ""}`}
                  type="button"
                  aria-pressed={viewMode === "batch"}
                  onClick={() => setViewMode("batch")}
                >
                  Batch
                </button>
                <button
                  className={`mode-btn ${viewMode === "screen" ? "active" : ""}`}
                  type="button"
                  aria-pressed={viewMode === "screen"}
                  onClick={() => setViewMode("screen")}
                >
                  Screen
                </button>
              </div>

              <div className="sidebar-util-btns">
                <button
                  className="sidebar-util-btn"
                  title="Copy all events JSON"
                  type="button"
                  aria-label="Copy all events JSON"
                  onClick={handleExportAllJson}
                >
                  {copiedKey === "export-all" ? <IconCheck size={13} /> : <IconCopy size={13} />}
                </button>
                {onClearFlows && (
                  <button
                    className="sidebar-util-btn"
                    title="Clear all events"
                    type="button"
                    aria-label="Clear all events"
                    onClick={onClearFlows}
                  >
                    <IconTrash size={13} />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Events Stream List */}
          <div className="events-stream-list" role="list" aria-label="Event timeline">
            {filteredEvents.length === 0 ? (
              <div className="empty-stream-notice">
                {flows.length === 0
                  ? "Waiting for mobile analytics traffic..."
                  : "No events match the current filter."}
              </div>
            ) : viewMode === "flat" ? (
              [...filteredEvents].reverse().map((item, revIdx) => {
                const isSelected = selectedEvent?.id === item.id;
                const indexNum = filteredEvents.length - 1 - revIdx;
                return (
                  <div
                    key={item.id}
                    className={`stream-event-item ${isSelected ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedEventId(item.id);
                      }
                    }}
                    onClick={() => setSelectedEventId(item.id)}
                  >
                    <span className="event-stream-index tabular-nums">{indexNum}</span>
                    <span className="event-stream-name" title={item.event.name}>
                      {item.event.name}
                    </span>
                    {item.bundle.appId && (
                      <span className="event-stream-app-pill" title={item.bundle.appId}>
                        {item.bundle.appId}
                      </span>
                    )}
                  </div>
                );
              })
            ) : viewMode === "batch" ? (
              groupedBatches.map((batch, bIdx) => (
                <div key={batch.flowId} className="stream-group-block">
                  <div className="stream-group-header">
                    <strong>Batch #{bIdx + 1}</strong>
                    <span className="tabular-nums">{batch.events.length} events</span>
                  </div>
                  {batch.events.map((item) => (
                    <div
                      key={item.id}
                      className={`stream-event-item ${selectedEvent?.id === item.id ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-selected={selectedEvent?.id === item.id}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedEventId(item.id);
                        }
                      }}
                      onClick={() => setSelectedEventId(item.id)}
                    >
                      <span className="event-stream-index tabular-nums">{item.globalIndex}</span>
                      <span className="event-stream-name">{item.event.name}</span>
                    </div>
                  ))}
                </div>
              ))
            ) : (
              groupedScreens.map((screenGroup) => (
                <div key={screenGroup.screenName} className="stream-group-block">
                  <div className="stream-group-header">
                    <strong>{screenGroup.screenName}</strong>
                    <span className="tabular-nums">{screenGroup.events.length} events</span>
                  </div>
                  {screenGroup.events.map((item) => (
                    <div
                      key={item.id}
                      className={`stream-event-item ${selectedEvent?.id === item.id ? "selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-selected={selectedEvent?.id === item.id}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedEventId(item.id);
                        }
                      }}
                      onClick={() => setSelectedEventId(item.id)}
                    >
                      <span className="event-stream-index tabular-nums">{item.globalIndex}</span>
                      <span className="event-stream-name">{item.event.name}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Right Panel: Detail Accordions */}
        <main className="analytics-details-panel" aria-label="Event inspector details">
          {selectedEvent ? (
            <div className="event-details-scroller">
              {/* Event Title Header */}
              <div className="event-details-hero">
                <div className="hero-title-row">
                  <h2 className="event-hero-title">{selectedEvent.event.name}</h2>
                  {selectedEvent.event.origin && (
                    <span className="event-origin-badge">
                      {selectedEvent.event.origin}
                    </span>
                  )}
                </div>
                <div className="hero-actions-row">
                  <button
                    className="hero-copy-json-btn"
                    type="button"
                    onClick={() =>
                      handleCopy(
                        JSON.stringify(selectedEvent.event, null, 2),
                        "copy-event",
                      )
                    }
                  >
                    {copiedKey === "copy-event" ? (
                      <>
                        <IconCheck size={13} />
                        <span>Copied JSON</span>
                      </>
                    ) : (
                      <>
                        <IconCopy size={13} />
                        <span>Copy JSON</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Accordion 1: Overview (7) */}
              <div className="accordion-section">
                <button
                  className="accordion-header"
                  type="button"
                  aria-expanded={openSections.overview}
                  onClick={() => toggleSection("overview")}
                >
                  <span className="accordion-title">
                    Overview ({overviewFields.length})
                  </span>
                  <span className="accordion-toggle-icon">
                    {openSections.overview ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </span>
                </button>
                {openSections.overview && (
                  <div className="accordion-content">
                    <table className="analytics-prop-table">
                      <tbody>
                        {overviewFields.map((field) => (
                          <tr key={field.key}>
                            <td className="prop-key-cell">{field.label}</td>
                            <td
                              className="prop-val-cell clickable-copy"
                              title="Click to copy"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  void handleCopy(field.value, field.key);
                                }
                              }}
                              onClick={() => void handleCopy(field.value, field.key)}
                            >
                              <span>{field.value}</span>
                              {copiedKey === field.key ? (
                                <span className="copy-check">
                                  <IconCheck size={11} />
                                  <span>Copied</span>
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Accordion 2: Event Data (with Hide System & Tabs) */}
              <div className="accordion-section">
                <div
                  className="accordion-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={openSections.eventData}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSection("eventData");
                    }
                  }}
                  onClick={() => toggleSection("eventData")}
                >
                  <div className="header-left-title">
                    <span className="accordion-title">Event Data</span>
                  </div>
                  <div
                    className="header-right-controls"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="hide-system-switch">
                      <span>Hide system</span>
                      <input
                        checked={hideSystemParams}
                        type="checkbox"
                        aria-label="Hide internal system parameters"
                        onChange={(e) => setHideSystemParams(e.target.checked)}
                      />
                    </label>
                    <span className="accordion-toggle-icon">
                      {openSections.eventData ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </span>
                  </div>
                </div>

                {openSections.eventData && (
                  <div className="accordion-content">
                    <div className="subtabs-bar" role="tablist">
                      <button
                        className={`subtab-btn ${eventDataTab === "params" ? "active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={eventDataTab === "params"}
                        onClick={() => setEventDataTab("params")}
                      >
                        Event Parameters ({eventParameters.length})
                      </button>
                      <button
                        className={`subtab-btn ${eventDataTab === "user_props" ? "active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={eventDataTab === "user_props"}
                        onClick={() => setEventDataTab("user_props")}
                      >
                        User Properties ({userPropertiesList.length})
                      </button>
                    </div>

                    {eventDataTab === "params" ? (
                      eventParameters.length === 0 ? (
                        <div className="empty-subtab-notice">
                          {hideSystemParams
                            ? "No custom business parameters (System parameters hidden)."
                            : "No event parameters recorded."}
                        </div>
                      ) : (
                        <table className="analytics-prop-table">
                          <tbody>
                            {eventParameters.map(([k, v]) => (
                              <tr key={k}>
                                <td className="prop-key-cell">{k}</td>
                                <td
                                  className="prop-val-cell clickable-copy"
                                  title="Click to copy"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      void handleCopy(String(v), k);
                                    }
                                  }}
                                  onClick={() => void handleCopy(String(v), k)}
                                >
                                  <span>{String(v)}</span>
                                  {copiedKey === k ? (
                                    <span className="copy-check">
                                      <IconCheck size={11} />
                                      <span>Copied</span>
                                    </span>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    ) : userPropertiesList.length === 0 ? (
                      <div className="empty-subtab-notice">
                        No user properties recorded.
                      </div>
                    ) : (
                      <table className="analytics-prop-table">
                        <tbody>
                          {userPropertiesList.map(([k, v]) => (
                            <tr key={k}>
                              <td className="prop-key-cell">{k}</td>
                              <td
                                className="prop-val-cell clickable-copy"
                                title="Click to copy"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    void handleCopy(String(v), k);
                                  }
                                }}
                                onClick={() => void handleCopy(String(v), k)}
                              >
                                <span>{String(v)}</span>
                                {copiedKey === k ? (
                                  <span className="copy-check">
                                    <IconCheck size={11} />
                                    <span>Copied</span>
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 3: Ecommerce Items (if any) */}
              {selectedEvent.event.items && selectedEvent.event.items.length > 0 && (
                <div className="accordion-section">
                  <button
                    className="accordion-header"
                    type="button"
                    aria-expanded={openSections.ecommerce}
                    onClick={() => toggleSection("ecommerce")}
                  >
                    <span className="accordion-title">
                      Ecommerce Items ({selectedEvent.event.items.length})
                    </span>
                    <span className="accordion-toggle-icon">
                      {openSections.ecommerce ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </span>
                  </button>
                  {openSections.ecommerce && (
                    <div className="accordion-content">
                      <div className="ecommerce-items-container">
                        {selectedEvent.event.items.map((item, iIdx) => (
                          <div key={iIdx} className="ecommerce-item-card">
                            <div className="item-card-header">
                              <strong>
                                #{iIdx + 1} {String(item.item_name || item.name || "Item")}
                              </strong>
                              {item.item_id ? (
                                <code>{String(item.item_id)}</code>
                              ) : null}
                            </div>
                            <table className="analytics-prop-table">
                              <tbody>
                                {Object.entries(item).map(([k, v]) => (
                                  <tr key={k}>
                                    <td className="prop-key-cell">{k}</td>
                                    <td className="prop-val-cell">{String(v)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Accordion 4: Shared Metadata (30) */}
              {sharedMetadataList.length > 0 && (
                <div className="accordion-section">
                  <button
                    className="accordion-header"
                    type="button"
                    aria-expanded={openSections.shared}
                    onClick={() => toggleSection("shared")}
                  >
                    <span className="accordion-title">
                      Shared Device &amp; Bundle Metadata ({sharedMetadataList.length})
                    </span>
                    <span className="accordion-toggle-icon">
                      {openSections.shared ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </span>
                  </button>
                  {openSections.shared && (
                    <div className="accordion-content">
                      <table className="analytics-prop-table">
                        <tbody>
                          {sharedMetadataList.map(([k, v]) => (
                            <tr key={k}>
                              <td className="prop-key-cell">{k}</td>
                              <td
                                className="prop-val-cell clickable-copy"
                                title="Click to copy"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    void handleCopy(String(v), k);
                                  }
                                }}
                                onClick={() => void handleCopy(String(v), k)}
                              >
                                <span>{String(v)}</span>
                                {copiedKey === k ? (
                                  <span className="copy-check">
                                    <IconCheck size={11} />
                                    <span>Copied</span>
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Accordion 5: Raw Event Tree Viewer */}
              <div className="accordion-section">
                <button
                  className="accordion-header"
                  type="button"
                  aria-expanded={openSections.raw}
                  onClick={() => toggleSection("raw")}
                >
                  <span className="accordion-title">Raw Object Tree</span>
                  <span className="accordion-toggle-icon">
                    {openSections.raw ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  </span>
                </button>
                {openSections.raw && (
                  <div className="accordion-content">
                    <div className="object-tree-root">
                      <ObjectTreeViewer data={selectedEvent.event} label="event" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="no-event-selected-placeholder">
              <span className="placeholder-icon">
                <IconFlame size={32} />
              </span>
              <h3>No Analytics Event Selected</h3>
              <p>
                Capture or select an analytics request to inspect events,
                parameters, and device metadata in detail.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
