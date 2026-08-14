import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { NetworkFlow } from "../../types/events";
import { NetworkTable } from "./NetworkTable";

describe("NetworkTable analysis badge", () => {
  it("shows a compact service badge without replacing the raw request path", () => {
    const flow: NetworkFlow = {
      id: "firebase-flow",
      method: "POST",
      url: "https://app-measurement.com/a?app=com.example",
      path: "/a?app=com.example",
      host: "app-measurement.com",
      websocketMessages: [],
      state: "completed",
      analysis: {
        providerId: "firebase",
        providerLabel: "Firebase",
        serviceId: "analytics",
        serviceLabel: "Analytics",
        protocol: "firebase-native",
        confidence: 0.99,
        status: "decoded",
        parserVersion: "1",
        tags: ["firebase", "analytics"],
        bundles: [],
        warnings: [],
      },
    };

    const html = renderToStaticMarkup(
      <NetworkTable
        flows={[flow]}
        selectedFlowId={null}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("/a?app=com.example");
    expect(html).toContain("Firebase Analytics");
    expect(html).toContain('data-service="analytics"');
  });
});
