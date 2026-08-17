import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsWorkspace } from "./AnalyticsWorkspace";
import type { NetworkFlow } from "../../types/events";

const mockFlows: NetworkFlow[] = [
  {
    id: "flow-1",
    url: "https://app-measurement.com/a",
    method: "POST",
    statusCode: 200,
    websocketMessages: [],
    state: "completed",
    analysis: {
      providerId: "firebase",
      providerLabel: "Firebase",
      serviceId: "analytics",
      serviceLabel: "Analytics",
      protocol: "firebase-native-protobuf",
      confidence: 0.99,
      status: "decoded",
      parserVersion: "1.0.0",
      tags: ["firebase", "analytics"],
      warnings: [],
      bundles: [
        {
          appId: "com.vna.ios.app",
          appInstanceId: "262CDCFCB90D4B92A9F5E1E77032DBB8",
          firebaseInstanceId: "fd4L71M5LEkP1eETKNGsfg",
          gmpAppId: "1:886720318531:ios:f3bfaa98ccc56fce8118f6",
          platform: "ios",
          osVersion: "26.0.1",
          deviceModel: "iPhone15,4",
          userProperties: {
            user_id: "user_123",
            ga_session_id: "1786940051",
            ga_session_number: 10,
          },
          consent: {
            ad_storage: "granted",
            consent_signals: "G1--",
          },
          shared: {
            app_id: "com.vna.ios.app",
            platform: "ios",
            os_version: "26.0.1",
            device_model: "iPhone15,4",
          },
          events: [
            {
              name: "search_flight",
              origin: "app+gtm",
              appId: "com.vna.ios.app",
              sessionId: "1786940051",
              sessionNum: 10,
              parameters: {
                _o: "app+gtm",
                _sid: "1786940051",
                trip_type: "round_trip",
                origin: "HAN",
                destination: "SGN",
              },
              systemParameters: {
                _o: "app+gtm",
                _sid: "1786940051",
              },
              items: [
                {
                  item_id: "VN123",
                  item_name: "Flight HAN-SGN",
                  price: 2500000,
                },
              ],
            },
          ],
        },
      ],
    },
  },
];

describe("AnalyticsWorkspace", () => {
  it("renders the event list and detail accordions", () => {
    const html = renderToStaticMarkup(
      <AnalyticsWorkspace activeProvider="firebase" flows={mockFlows} />,
    );

    expect(html).toContain("search_flight");
    expect(html).toContain("com.vna.ios.app");
    expect(html).toContain("Overview");
    expect(html).toContain("Event Data");
    expect(html).toContain("Ecommerce");
    expect(html).toContain("trip_type");
    expect(html).toContain("round_trip");
    expect(html).toContain("262CDCFCB90D4B92A9F5E1E77032DBB8");
    expect(html).toContain("fd4L71M5LEkP1eETKNGsfg");
  });

  it("renders empty placeholder when no flows are present", () => {
    const html = renderToStaticMarkup(
      <AnalyticsWorkspace activeProvider="firebase" flows={[]} />,
    );

    expect(html).toContain("Waiting for mobile analytics traffic...");
    expect(html).toContain("No Analytics Event Selected");
  });
});
