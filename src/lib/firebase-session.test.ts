import { describe, expect, it } from "vitest";
import type { FlowAnalysisBundle, FlowAnalysisEvent } from "../types/events";
import {
  appNameFromHeaders,
  buildSessionExport,
  eventTimestampMs,
  resolveSessionId,
  suggestSessionFileName,
} from "./firebase-session";

function bundle(overrides: Partial<FlowAnalysisBundle> = {}): FlowAnalysisBundle {
  return {
    appId: "com.vna.superapp.dev",
    appVersion: "1.0.0",
    platform: "ios",
    userProperties: { _sid: 1793679294, _sno: 1 },
    consent: {},
    events: [],
    ...overrides,
  };
}

function event(name: string, timestampMs: number): FlowAnalysisEvent {
  return { name, timestampMs, parameters: { _sn: "Home" }, items: [] };
}

describe("appNameFromHeaders", () => {
  it("reads the iOS bundle name from the User-Agent", () => {
    expect(
      appNameFromHeaders([
        ["user-agent", "VietnamAirline/2611021 CFNetwork/3860.100.1 Darwin/25.0.0"],
      ]),
    ).toBe("VietnamAirline");
    expect(appNameFromHeaders([["User-Agent", "My%20App/12 CFNetwork/1 Darwin/1"]])).toBe(
      "My App",
    );
  });

  it("ignores generic HTTP client user agents", () => {
    expect(appNameFromHeaders([["user-agent", "Dalvik/2.1.0 (Linux; U; Android 14)"]])).toBeNull();
    expect(appNameFromHeaders(undefined)).toBeNull();
  });
});

describe("eventTimestampMs", () => {
  it("converts the request start time from seconds when the event has no timestamp", () => {
    const gaEvent: FlowAnalysisEvent = { name: "page_view", parameters: {}, items: [] };
    expect(eventTimestampMs(gaEvent, 1_793_693_864.468)).toBe(1_793_693_864_468);
    expect(eventTimestampMs(event("_e", 1_793_679_854_871), 1)).toBe(1_793_679_854_871);
  });
});

describe("resolveSessionId", () => {
  it("reads the GA4 web session from sid", () => {
    expect(
      resolveSessionId(
        { name: "page_view", parameters: { sid: "1793693865" }, items: [] },
        bundle({ userProperties: {} }),
      ),
    ).toBe("1793693865");
  });

  it("falls back to the bundle user property _sid", () => {
    expect(resolveSessionId(event("_e", 1), bundle())).toBe("1793679294");
  });
});

describe("buildSessionExport", () => {
  it("orders events by time and summarises the session", () => {
    const b = bundle();
    const exported = buildSessionExport(
      [
        {
          flowId: "f2",
          flowUrl: "https://app-analytics-services-att.com/a",
          appName: "VietnamAirline",
          sessionId: "1793679294",
          sessionNum: "1",
          screenName: "Home",
          timestamp: 2_000,
          event: event("view_promotion", 2_000),
          bundle: b,
        },
        {
          flowId: "f1",
          flowUrl: "https://app-analytics-services-att.com/a",
          appName: "VietnamAirline",
          sessionId: "1793679294",
          sessionNum: "1",
          screenName: "Home",
          timestamp: 1_000,
          event: event("_vs", 1_000),
          bundle: b,
        },
      ],
      new Date("2026-11-03T07:00:00Z"),
    );

    expect(exported.app.name).toBe("VietnamAirline");
    expect(exported.app.appId).toBe("com.vna.superapp.dev");
    expect(exported.session.id).toBe("1793679294");
    expect(exported.session.eventCount).toBe(2);
    expect(exported.session.uploadCount).toBe(2);
    expect(exported.session.durationMs).toBe(1_000);
    expect(exported.events.map((item) => item.name)).toEqual(["_vs", "view_promotion"]);
  });
});

describe("suggestSessionFileName", () => {
  it("builds a filesystem-safe name", () => {
    expect(
      suggestSessionFileName("Vietnam Airline", "1793679294", new Date("2026-11-03T07:00:00Z")),
    ).toBe("firebase-session_Vietnam-Airline_1793679294_2026-11-03T07-00-00.json");
  });
});
