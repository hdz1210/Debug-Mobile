import { useMemo, useState } from "react";
import type { FlowAnalysisBundle, FlowAnalysisEvent, NetworkFlow } from "../../types/events";
import { ObjectTreeViewer } from "./ObjectTreeViewer";

type ViewMode = "flat" | "batch" | "screen";
type ProviderTab = "firebase" | "branch" | "all";

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

const USER_PROP_TAGS: Record<string, string> = {
  first_open_after_install: "_fi",
  first_open_time: "_fot",
  user_id: "_id",
  member_id: "_id",
  firebase_session_id: "_sid",
  ga_session_id: "_sid",
  firebase_session_number: "_sno",
  ga_session_number: "_sno",
  lifetime_user_engagement: "_lte",
  session_user_engagement: "_se",
};

export function AnalyticsWorkspace({
  flows,
  activeProvider,
  onSelectProvider,
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
            id: `${flow.id}-${idx}`,
            globalIndex: idx,
            flowId: flow.id,
            flowUrl: flow.url || "",
            providerId,
            event: ev,
            bundle,
            screenName,
            timestamp,
          });
          idx++;
        }
      }
    }
    return list;
  }, [flows]);

  // Filter events based on active provider and search query
  const filteredEvents = useMemo(() => {
    return allFlattenedEvents.filter((item) => {
      // Provider filter
      if (activeProvider === "firebase" && item.providerId !== "firebase" && item.providerId !== "google-analytics") {
        return false;
      }
      if (activeProvider === "branch" && item.providerId !== "branch") {
        return false;
      }

      // Search query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();

      const evNameMatch = item.event.name.toLowerCase().includes(q);
      const appIdMatch = (item.bundle.appId || "").toLowerCase().includes(q);
      const screenMatch = item.screenName.toLowerCase().includes(q);

      const paramsMatch = Object.entries(item.event.parameters || {}).some(
        ([k, v]) =>
          k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q),
      );

      const userPropsMatch = Object.entries(item.bundle.userProperties || {}).some(
        ([k, v]) =>
          k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q),
      );

      return evNameMatch || appIdMatch || screenMatch || paramsMatch || userPropsMatch;
    });
  }, [allFlattenedEvents, activeProvider, searchQuery]);

  // Selected event resolution
  const selectedEvent = useMemo(() => {
    if (selectedEventId) {
      const found = filteredEvents.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    return filteredEvents.length > 0 ? filteredEvents[filteredEvents.length - 1] : null;
  }, [filteredEvents, selectedEventId]);

  // Grouping for Batch and Screen modes
  const groupedBatches = useMemo(() => {
    const map = new Map<string, FlattenedEvent[]>();
    for (const item of filteredEvents) {
      const key = item.flowId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries()).map(([flowId, events]) => ({
      flowId,
      url: events[0]?.flowUrl || "",
      appId: events[0]?.bundle.appId || "",
      events,
    }));
  }, [filteredEvents]);

  const groupedScreens = useMemo(() => {
    const map = new Map<string, FlattenedEvent[]>();
    for (const item of filteredEvents) {
      const key = item.screenName;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
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
      {/* Top Provider Bar */}
      <div className="analytics-nav-bar">
        <div className="analytics-provider-tabs">
          <button
            className={`provider-tab-btn ${activeProvider === "firebase" ? "active" : ""}`}
            type="button"
            onClick={() => onSelectProvider?.("firebase")}
          >
            <span className="tab-icon">🔥</span>
            <span>FIREBASE</span>
          </button>
          <button
            className={`provider-tab-btn ${activeProvider === "branch" ? "active" : ""}`}
            type="button"
            onClick={() => onSelectProvider?.("branch")}
          >
            <span className="tab-icon">✈️</span>
            <span>BRANCH</span>
          </button>
          <button
            className={`provider-tab-btn ${activeProvider === "all" ? "active" : ""}`}
            type="button"
            onClick={() => onSelectProvider?.("all")}
          >
            <span>ALL EVENTS</span>
          </button>
        </div>

        <div className="analytics-nav-actions">
          <button
            className="action-icon-btn"
            title="Copy all filtered events JSON"
            type="button"
            onClick={handleExportAllJson}
          >
            {copiedKey === "export-all" ? "✓ Copied" : "📋 Copy All"}
          </button>
          {onClearFlows && (
            <button
              className="action-icon-btn"
              title="Clear all events"
              type="button"
              onClick={onClearFlows}
            >
              🗑️ Clear
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Split Layout */}
      <div className="analytics-body-layout">
        {/* Left Sidebar: Filter, Modes & Event Stream */}
        <aside className="analytics-sidebar">
          <div className="sidebar-filter-box">
            <input
              className="sidebar-search-input"
              placeholder="Filter — app:... e:..."
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="view-mode-bar">
            <button
              className={`mode-btn ${viewMode === "flat" ? "active" : ""}`}
              type="button"
              onClick={() => setViewMode("flat")}
            >
              Flat
            </button>
            <button
              className={`mode-btn ${viewMode === "batch" ? "active" : ""}`}
              type="button"
              onClick={() => setViewMode("batch")}
            >
              Batch
            </button>
            <button
              className={`mode-btn ${viewMode === "screen" ? "active" : ""}`}
              type="button"
              onClick={() => setViewMode("screen")}
            >
              Screen
            </button>
          </div>

          <div className="events-stream-list">
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
                    onClick={() => setSelectedEventId(item.id)}
                  >
                    <span className="event-stream-index">{indexNum}</span>
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
                    <span>{batch.events.length} events</span>
                  </div>
                  {batch.events.map((item) => (
                    <div
                      key={item.id}
                      className={`stream-event-item ${selectedEvent?.id === item.id ? "selected" : ""}`}
                      onClick={() => setSelectedEventId(item.id)}
                    >
                      <span className="event-stream-index">{item.globalIndex}</span>
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
                    <span>{screenGroup.events.length} events</span>
                  </div>
                  {screenGroup.events.map((item) => (
                    <div
                      key={item.id}
                      className={`stream-event-item ${selectedEvent?.id === item.id ? "selected" : ""}`}
                      onClick={() => setSelectedEventId(item.id)}
                    >
                      <span className="event-stream-index">{item.globalIndex}</span>
                      <span className="event-stream-name">{item.event.name}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Right Panel: Detail Accordions */}
        <main className="analytics-details-panel">
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
                    {copiedKey === "copy-event" ? "✓ Copied JSON" : "Copy JSON"}
                  </button>
                </div>
              </div>

              {/* Accordion 1: Overview (7) */}
              <div className="accordion-section">
                <div
                  className="accordion-header"
                  onClick={() => toggleSection("overview")}
                >
                  <span className="accordion-title">
                    Overview ({overviewFields.length})
                  </span>
                  <span className="accordion-toggle-icon">
                    {openSections.overview ? "▲" : "▼"}
                  </span>
                </div>
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
                              onClick={() => handleCopy(field.value, field.key)}
                            >
                              <span>{field.value}</span>
                              {copiedKey === field.key ? (
                                <span className="copy-check">✓ Copied</span>
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
                        onChange={(e) => setHideSystemParams(e.target.checked)}
                      />
                    </label>
                    <span className="accordion-toggle-icon">
                      {openSections.eventData ? "▲" : "▼"}
                    </span>
                  </div>
                </div>

                {openSections.eventData && (
                  <div className="accordion-content">
                    <div className="subtabs-bar">
                      <button
                        className={`subtab-btn ${eventDataTab === "params" ? "active" : ""}`}
                        type="button"
                        onClick={() => setEventDataTab("params")}
                      >
                        Event Parameters ({eventParameters.length})
                      </button>
                      <button
                        className={`subtab-btn ${eventDataTab === "user_props" ? "active" : ""}`}
                        type="button"
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
                                  onClick={() => handleCopy(String(v), k)}
                                >
                                  <span>{String(v)}</span>
                                  {copiedKey === k ? (
                                    <span className="copy-check">✓ Copied</span>
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
                              <td className="prop-key-cell">
                                <span>{k}</span>
                              </td>
                              <td
                                className="prop-val-cell clickable-copy"
                                title="Click to copy"
                                onClick={() => handleCopy(String(v), k)}
                              >
                                <span>{String(v)}</span>
                                {USER_PROP_TAGS[k] && (
                                  <span className="prop-tag-badge">
                                    {USER_PROP_TAGS[k]}
                                  </span>
                                )}
                                {copiedKey === k ? (
                                  <span className="copy-check">✓ Copied</span>
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

              {/* Accordion 3: Ecommerce Items */}
              <div className="accordion-section">
                <div
                  className="accordion-header"
                  onClick={() => toggleSection("ecommerce")}
                >
                  <span className="accordion-title">
                    Ecommerce ({selectedEvent.event.items?.length || 0})
                  </span>
                  <span className="accordion-toggle-icon">
                    {openSections.ecommerce ? "▲" : "▼"}
                  </span>
                </div>
                {openSections.ecommerce && (
                  <div className="accordion-content">
                    {(!selectedEvent.event.items || selectedEvent.event.items.length === 0) ? (
                      <div className="empty-subtab-notice">
                        No ecommerce items attached to this event.
                      </div>
                    ) : (
                      <div className="ecommerce-items-stack">
                        {selectedEvent.event.items.map((item, iIdx) => (
                          <div key={iIdx} className="ecommerce-item-card">
                            <div className="item-card-title">Item #{iIdx + 1}</div>
                            <table className="analytics-prop-table">
                              <tbody>
                                {Object.entries(item).map(([ik, iv]) => (
                                  <tr key={ik}>
                                    <td className="prop-key-cell">{ik}</td>
                                    <td
                                      className="prop-val-cell clickable-copy"
                                      onClick={() => handleCopy(String(iv), `${iIdx}-${ik}`)}
                                    >
                                      <span>{String(iv)}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 4: Consent & Privacy */}
              <div className="accordion-section">
                <div
                  className="accordion-header"
                  onClick={() => toggleSection("consent")}
                >
                  <span className="accordion-title">
                    Consent & Privacy ({Object.keys(selectedEvent.bundle.consent || {}).length})
                  </span>
                  <span className="accordion-toggle-icon">
                    {openSections.consent ? "▲" : "▼"}
                  </span>
                </div>
                {openSections.consent && (
                  <div className="accordion-content">
                    {Object.keys(selectedEvent.bundle.consent || {}).length === 0 ? (
                      <div className="empty-subtab-notice">
                        No consent signals recorded.
                      </div>
                    ) : (
                      <table className="analytics-prop-table">
                        <tbody>
                          {Object.entries(selectedEvent.bundle.consent || {}).map(([ck, cv]) => (
                            <tr key={ck}>
                              <td className="prop-key-cell">{ck}</td>
                              <td className="prop-val-cell">{String(cv)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 5: Shared (30) Device & Bundle Metadata */}
              <div className="accordion-section">
                <div
                  className="accordion-header"
                  onClick={() => toggleSection("shared")}
                >
                  <span className="accordion-title">
                    Shared ({sharedMetadataList.length})
                  </span>
                  <span className="accordion-toggle-icon">
                    {openSections.shared ? "▲" : "▼"}
                  </span>
                </div>
                {openSections.shared && (
                  <div className="accordion-content">
                    {sharedMetadataList.length === 0 ? (
                      <div className="empty-subtab-notice">
                        No shared bundle metadata recorded.
                      </div>
                    ) : (
                      <table className="analytics-prop-table">
                        <tbody>
                          {sharedMetadataList.map(([sk, sv]) => (
                            <tr key={sk}>
                              <td className="prop-key-cell">{sk}</td>
                              <td
                                className="prop-val-cell clickable-copy"
                                onClick={() => handleCopy(String(sv), `shared-${sk}`)}
                              >
                                <span>{String(sv)}</span>
                                {copiedKey === `shared-${sk}` ? (
                                  <span className="copy-check">✓ Copied</span>
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

              {/* Accordion 6: Raw Interactive Object Tree */}
              <div className="accordion-section">
                <div
                  className="accordion-header"
                  onClick={() => toggleSection("raw")}
                >
                  <div className="header-left-title">
                    <span className="accordion-title">Raw</span>
                  </div>
                  <div
                    className="header-right-controls"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="raw-copy-btn"
                      title="Copy raw JSON"
                      type="button"
                      onClick={() =>
                        handleCopy(
                          JSON.stringify(
                            {
                              event: selectedEvent.event,
                              bundle: selectedEvent.bundle,
                            },
                            null,
                            2,
                          ),
                          "raw-json",
                        )
                      }
                    >
                      {copiedKey === "raw-json" ? "✓ Copied" : "≡"}
                    </button>
                    <span className="accordion-toggle-icon">
                      {openSections.raw ? "▲" : "▼"}
                    </span>
                  </div>
                </div>
                {openSections.raw && (
                  <div className="accordion-content raw-tree-container">
                    <ObjectTreeViewer
                      data={{
                        event: selectedEvent.event,
                        bundle: selectedEvent.bundle,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="no-event-selected-placeholder">
              <div className="placeholder-icon">📊</div>
              <h3>No Analytics Event Selected</h3>
              <p>
                Capture or select an analytics request to inspect events, parameters,
                and device metadata in detail.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
