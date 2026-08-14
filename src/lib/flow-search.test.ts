import { describe, expect, it } from "vitest";
import type { NetworkFlow } from "../types/events";
import { flowMatchesSearch } from "./flow-search";

const flow: NetworkFlow = {
  id: "analytics-flow",
  method: "POST",
  url: "https://app-measurement.com/a",
  host: "app-measurement.com",
  path: "/a",
  websocketMessages: [],
  state: "completed",
  analysis: {
    providerId: "firebase",
    providerLabel: "Firebase",
    serviceId: "analytics",
    serviceLabel: "Analytics",
    protocol: "firebase-native",
    confidence: 1,
    status: "decoded",
    parserVersion: "1",
    tags: ["ecommerce"],
    bundles: [
      {
        appId: "com.example.app",
        appName: "Example App",
        userProperties: {},
        consent: {},
        events: [
          {
            name: "view_item",
            origin: "app",
            parameters: {},
            items: [],
          },
        ],
      },
    ],
    warnings: [],
  },
};

describe("flowMatchesSearch", () => {
  it.each(["firebase analytics", "ecommerce", "view_item", "Example App"])(
    "matches analysis metadata for %s",
    (query) => {
      expect(flowMatchesSearch(flow, query)).toBe(true);
    },
  );

  it("does not match unrelated analysis text", () => {
    expect(flowMatchesSearch(flow, "crashlytics")).toBe(false);
  });
});
