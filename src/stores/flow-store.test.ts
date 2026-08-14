import { beforeEach, describe, expect, it } from "vitest";
import { useFlowStore } from "./flow-store";
import type { BridgeEvent } from "../types/events";

const requestStarted: BridgeEvent = {
  event: "request_started",
  flowId: "flow-1",
  method: "POST",
  url: "https://api.example.com/login?source=mobile",
  host: "api.example.com",
  port: 443,
  scheme: "https",
  httpVersion: "HTTP/2.0",
  headers: [["content-type", "application/json"]],
  startedAt: 100,
};

describe("flow store", () => {
  beforeEach(() => {
    useFlowStore.getState().reset();
  });

  it("creates a row as soon as request_started arrives", () => {
    useFlowStore.getState().upsertBridgeEvent(requestStarted);

    const state = useFlowStore.getState();
    expect(state.orderedFlowIds).toEqual(["flow-1"]);
    expect(state.flowsById["flow-1"]).toMatchObject({
      method: "POST",
      host: "api.example.com",
      path: "/login?source=mobile",
      state: "requesting",
    });
  });

  it("merges lifecycle events into the same flow", () => {
    const events: BridgeEvent[] = [
      requestStarted,
      {
        event: "request_completed",
        flowId: "flow-1",
        body: {
          format: "text",
          contentType: "application/json",
          data: "{}",
          size: 2,
          truncated: false,
        },
        endedAt: 100.1,
      },
      {
        event: "response_started",
        flowId: "flow-1",
        statusCode: 200,
        reason: "OK",
        httpVersion: "HTTP/2.0",
        headers: [["content-type", "application/json"]],
        startedAt: 100.2,
      },
      {
        event: "response_completed",
        flowId: "flow-1",
        statusCode: 200,
        body: {
          format: "text",
          contentType: "application/json",
          data: '{"ok":true}',
          size: 11,
          truncated: false,
        },
        endedAt: 100.3,
        durationMs: 300,
      },
    ];

    events.forEach(useFlowStore.getState().upsertBridgeEvent);

    const state = useFlowStore.getState();
    expect(state.orderedFlowIds).toHaveLength(1);
    expect(state.flowsById["flow-1"]).toMatchObject({
      statusCode: 200,
      durationMs: 300,
      state: "completed",
    });
  });

  it("merges request analysis into live and replayed flows", () => {
    const analysis = {
      providerId: "firebase",
      providerLabel: "Firebase",
      serviceId: "analytics",
      serviceLabel: "Firebase Analytics",
      protocol: "firebase-native",
      platform: "ios",
      confidence: 0.98,
      status: "decoded",
      parserVersion: "1",
      tags: ["analytics", "firebase"],
      bundles: [
        {
          appId: "com.example.app",
          userProperties: { plan: "pro" },
          consent: { analytics_storage: "granted" },
          events: [
            {
              name: "view_item",
              parameters: { currency: "VND" },
              items: [{ item_id: "sku-1" }],
            },
          ],
        },
      ],
      warnings: [],
    } satisfies NonNullable<
      Extract<BridgeEvent, { event: "request_completed" }>["analysis"]
    >;

    [
      requestStarted,
      {
        event: "request_completed" as const,
        flowId: "flow-1",
        body: null,
        endedAt: 100.1,
        analysis,
      },
    ].forEach(useFlowStore.getState().upsertBridgeEvent);

    expect(useFlowStore.getState().flowsById["flow-1"].analysis).toEqual(
      analysis,
    );
  });

  it("records WebSocket messages and failed flows", () => {
    useFlowStore.getState().upsertBridgeEvent({
      event: "websocket_message",
      flowId: "ws-flow",
      direction: "server_to_client",
      format: "text",
      data: "pong",
      size: 4,
      timestamp: 200,
    });
    useFlowStore.getState().upsertBridgeEvent({
      event: "flow_error",
      flowId: "failed-flow",
      message: "TLS handshake failed",
    });

    const state = useFlowStore.getState();
    expect(state.flowsById["ws-flow"].websocketMessages[0]).toMatchObject({
      data: "pong",
      size: 4,
    });
    expect(state.flowsById["failed-flow"]).toMatchObject({
      error: "TLS handshake failed",
      state: "failed",
    });
  });
});
