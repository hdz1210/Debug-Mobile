import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FlowAnalysis, NetworkFlow } from "../../types/events";
import { RequestDetails } from "./RequestDetails";

function analysisFlow(analysis: FlowAnalysis): NetworkFlow {
  return {
    id: "analysis-flow",
    method: "POST",
    url: "https://app-measurement.com/a",
    path: "/a",
    host: "app-measurement.com",
    requestBody: {
      format: "base64",
      data: "AAEC",
      size: 3,
      truncated: false,
    },
    analysis,
    websocketMessages: [],
    state: "completed",
  };
}

const decodedAnalysis: FlowAnalysis = {
  providerId: "firebase",
  providerLabel: "Firebase",
  serviceId: "analytics",
  serviceLabel: "Analytics",
  protocol: "firebase-native",
  platform: "ios",
  confidence: 0.98,
  status: "partial",
  parserVersion: "1",
  tags: ["firebase", "analytics", "ecommerce"],
  warnings: ["One unknown protobuf field was preserved in the raw payload."],
  bundles: [
    {
      appId: "vn.com.example.store",
      appName: "Example Store",
      appVersion: "2.4.0",
      platform: "ios",
      measurementId: "G-EXAMPLE",
      userProperties: { membership_tier: "gold" },
      consent: { analytics_storage: "granted", ad_storage: "denied" },
      events: [
        {
          name: "view_item",
          timestampMicros: 1_759_210_000_000_000,
          origin: "app",
          parameters: { currency: "VND", value: 34_990_000 },
          items: [
            {
              item_id: "59258",
              item_name: "iPhone 16 Pro Max 256GB",
              price: 34_990_000,
            },
          ],
        },
        {
          name: "user_engagement",
          parameters: { engagement_time_msec: 4_389 },
          items: [],
        },
      ],
    },
    {
      appId: "vn.com.example.store.widget",
      userProperties: {},
      consent: {},
      events: [
        {
          name: "screen_view",
          timestampMs: 1_759_210_001_000,
          parameters: { firebase_screen: "Product details" },
          items: [],
        },
      ],
    },
  ],
};

describe("RequestDetails analytics tab", () => {
  it("renders multiple bundles and events with parameters, items, consent, and warnings", () => {
    const html = renderToStaticMarkup(
      <RequestDetails flow={analysisFlow(decodedAnalysis)} />,
    );

    expect(html).toContain("Analytics");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Example Store");
    expect(html).toContain("vn.com.example.store.widget");
    expect(html).toContain("view_item");
    expect(html).toContain("user_engagement");
    expect(html).toContain("screen_view");
    expect(html).toContain("membership_tier");
    expect(html).toContain("analytics_storage");
    expect(html).toContain("item_name");
    expect(html).toContain("iPhone 16 Pro Max 256GB");
    expect(html).toContain("Decoder warnings");
  });

  it("does not add an Analytics tab for other tagged Firebase services", () => {
    const html = renderToStaticMarkup(
      <RequestDetails
        flow={
          analysisFlow({
            ...decodedAnalysis,
            serviceId: "app-check",
            serviceLabel: "App Check",
            status: "decoded",
            bundles: [],
            warnings: [],
          })
        }
      />,
    );

    expect(html).not.toContain(">Analytics</button>");
    expect(html).toContain(">Overview</button>");
    expect(html).toContain(">Payload</button>");
  });

  it("explains unsupported analytics payloads and keeps the raw Payload tab", () => {
    const html = renderToStaticMarkup(
      <RequestDetails
        flow={
          analysisFlow({
            ...decodedAnalysis,
            status: "unsupported",
            bundles: [],
            warnings: ["Unsupported Firebase protobuf schema version."],
          })
        }
      />,
    );

    expect(html).toContain("Analytics payload is not available");
    expect(html).toContain("Unsupported Firebase protobuf schema version.");
    expect(html).toContain("raw payload is still available");
    expect(html).toContain(">Payload</button>");
  });
});
