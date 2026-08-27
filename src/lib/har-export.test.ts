import { describe, expect, it } from "vitest";
import type { NetworkFlow } from "../types/events";
import {
  buildHar,
  formatHarTimestamp,
  serializeHar,
  suggestHarFileName,
  type HarRoot,
} from "./har-export";

const sampleFlow: NetworkFlow = {
  id: "flow-1",
  method: "POST",
  url: "https://api.example.com/v1/resource?id=123&filter=active&filter=recent",
  path: "/v1/resource?id=123&filter=active&filter=recent",
  host: "api.example.com",
  port: 443,
  scheme: "https",
  httpVersion: "HTTP/1.1",
  statusCode: 200,
  reason: "OK",
  requestHeaders: [
    ["Host", "api.example.com"],
    ["Accept", "application/json"],
    ["Accept", "text/plain"],
    ["Cookie", "session=xyz789; theme=dark"],
  ],
  responseHeaders: [
    ["Content-Type", "application/json; charset=utf-8"],
    ["Set-Cookie", "token=abc123; Path=/; Secure; HttpOnly"],
    ["Set-Cookie", "visited=true; Path=/"],
    ["Location", "https://api.example.com/v1/resource/123"],
  ],
  requestBody: {
    format: "text",
    contentType: "application/json",
    data: JSON.stringify({ name: "test-item" }),
    size: 20,
    truncated: false,
  },
  responseBody: {
    format: "text",
    contentType: "application/json",
    data: JSON.stringify({ id: 123, name: "test-item" }),
    size: 30,
    truncated: false,
  },
  requestStartedAt: 1770000000.0,
  requestEndedAt: 1770000000.05,
  responseStartedAt: 1770000000.15,
  responseEndedAt: 1770000000.25,
  durationMs: 250,
  websocketMessages: [],
  state: "completed",
};

const binaryFlow: NetworkFlow = {
  id: "flow-binary",
  method: "GET",
  url: "https://images.example.com/avatar.png",
  path: "/avatar.png",
  host: "images.example.com",
  port: 443,
  scheme: "https",
  httpVersion: "HTTP/2",
  statusCode: 200,
  reason: "OK",
  requestHeaders: [["Host", "images.example.com"]],
  responseHeaders: [["Content-Type", "image/png"]],
  requestBody: {
    format: "base64",
    contentType: "application/octet-stream",
    data: "AQIDBA==",
    size: 4,
    truncated: true,
  },
  responseBody: {
    format: "base64",
    contentType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    size: 70,
    truncated: true,
  },
  requestStartedAt: 1770000001.0,
  responseEndedAt: 1770000001.1,
  durationMs: 100,
  websocketMessages: [],
  state: "completed",
};

const pendingFlow: NetworkFlow = {
  id: "flow-pending",
  method: "GET",
  url: "https://api.example.com/stream",
  path: "/stream",
  host: "api.example.com",
  port: 443,
  scheme: "https",
  requestHeaders: [["Host", "api.example.com"]],
  requestStartedAt: 1770000002.0,
  websocketMessages: [],
  state: "requesting",
};

const errorFlow: NetworkFlow = {
  id: "flow-error",
  method: "CONNECT",
  url: "https://unreachable.host.internal:8443",
  path: "/",
  host: "unreachable.host.internal",
  port: 8443,
  scheme: "https",
  requestStartedAt: 1770000003.0,
  error: "Connection refused (os error 111)",
  websocketMessages: [],
  state: "failed",
};

const analyticsFlow: NetworkFlow = {
  id: "flow-analytics",
  method: "POST",
  url: "https://app-measurement.com/a?app=com.example.app",
  path: "/a?app=com.example.app",
  host: "app-measurement.com",
  port: 443,
  scheme: "https",
  statusCode: 204,
  reason: "No Content",
  requestHeaders: [["Host", "app-measurement.com"]],
  responseHeaders: [],
  requestStartedAt: 1770000004.0,
  responseEndedAt: 1770000004.08,
  durationMs: 80,
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

const websocketFlow: NetworkFlow = {
  id: "flow-ws",
  method: "GET",
  url: "wss://stream.example.com/socket",
  path: "/socket",
  host: "stream.example.com",
  port: 443,
  scheme: "wss",
  statusCode: 101,
  reason: "Switching Protocols",
  requestHeaders: [
    ["Upgrade", "websocket"],
    ["Connection", "Upgrade"],
  ],
  responseHeaders: [
    ["Upgrade", "websocket"],
    ["Connection", "Upgrade"],
  ],
  requestStartedAt: 1770000005.0,
  websocketMessages: [
    {
      id: "ws-1",
      direction: "client_to_server",
      format: "text",
      data: '{"action":"subscribe"}',
      size: 22,
      timestamp: 1770000005.1,
    },
    {
      id: "ws-2",
      direction: "server_to_client",
      format: "text",
      data: '{"event":"subscribed"}',
      size: 22,
      timestamp: 1770000005.2,
    },
  ],
  state: "completed",
};

describe("har-export", () => {
  it("serializes valid HAR 1.2 root and preserves flow ordering", () => {
    const fixedDate = new Date("2026-08-15T09:00:00.000Z");
    const json = serializeHar([sampleFlow, binaryFlow], fixedDate);
    const har = JSON.parse(json) as HarRoot;

    expect(har.log.version).toBe("1.2");
    expect(har.log.creator.name).toBe("App Network Debugger");
    expect(har.log.creator.version).toBe("0.1.9");
    expect(har.log.pages).toEqual([]);
    expect(har.log.entries).toHaveLength(2);

    expect(har.log.entries[0].request.url).toBe(sampleFlow.url);
    expect(har.log.entries[1].request.url).toBe(binaryFlow.url);
  });

  it("preserves duplicate headers in exact order and parses cookies", () => {
    const har = buildHar([sampleFlow]);
    const entry = har.log.entries[0];

    expect(entry.request.headers).toEqual([
      { name: "Host", value: "api.example.com" },
      { name: "Accept", value: "application/json" },
      { name: "Accept", value: "text/plain" },
      { name: "Cookie", value: "session=xyz789; theme=dark" },
    ]);

    expect(entry.request.cookies).toEqual([
      { name: "session", value: "xyz789" },
      { name: "theme", value: "dark" },
    ]);

    expect(entry.response.cookies).toEqual([
      {
        name: "token",
        value: "abc123",
        path: "/",
        secure: true,
        httpOnly: true,
      },
      {
        name: "visited",
        value: "true",
        path: "/",
      },
    ]);

    expect(entry.response.redirectURL).toBe(
      "https://api.example.com/v1/resource/123",
    );
  });

  it("extracts query parameters including duplicate parameter names", () => {
    const har = buildHar([sampleFlow]);
    const entry = har.log.entries[0];

    expect(entry.request.queryString).toEqual([
      { name: "id", value: "123" },
      { name: "filter", value: "active" },
      { name: "filter", value: "recent" },
    ]);
  });

  it("handles text and base64 bodies with truncation comments", () => {
    const har = buildHar([sampleFlow, binaryFlow]);
    const sampleEntry = har.log.entries[0];
    const binaryEntry = har.log.entries[1];

    expect(sampleEntry.request.postData?.text).toBe(sampleFlow.requestBody?.data);
    expect(sampleEntry.request.postData?.encoding).toBeUndefined();
    expect(sampleEntry.response.content.text).toBe(sampleFlow.responseBody?.data);
    expect(sampleEntry.response.content.encoding).toBeUndefined();

    expect(binaryEntry.request.postData?.encoding).toBe("base64");
    expect(binaryEntry.request.postData?.comment).toContain("Body truncated");
    expect(binaryEntry.response.content.encoding).toBe("base64");
    expect(binaryEntry.response.content.comment).toContain("Body truncated");
    expect(binaryEntry.response.content.text).toBe(binaryFlow.responseBody?.data);
  });

  it("handles pending and error requests with appropriate fallback statuses", () => {
    const har = buildHar([pendingFlow, errorFlow]);
    const pendingEntry = har.log.entries[0];
    const errorEntry = har.log.entries[1];

    expect(pendingEntry.response.status).toBe(0);
    expect(pendingEntry.response.statusText).toBe("Pending");
    expect(pendingEntry._state).toBe("requesting");

    expect(errorEntry.response.status).toBe(0);
    expect(errorEntry.response.statusText).toBe("Failed");
    expect(errorEntry._error).toBe("Connection refused (os error 111)");
    expect(errorEntry._state).toBe("failed");
  });

  it("preserves WebSocket messages and Firebase Analytics metadata", () => {
    const har = buildHar([websocketFlow, analyticsFlow]);
    const wsEntry = har.log.entries[0];
    const analyticsEntry = har.log.entries[1];

    expect(wsEntry._webSocketMessages).toHaveLength(2);
    expect(wsEntry._webSocketMessages?.[0]).toEqual({
      type: "send",
      time: 1770000005.1,
      opcode: 1,
      data: '{"action":"subscribe"}',
      size: 22,
    });
    expect(wsEntry._webSocketMessages?.[1]).toEqual({
      type: "receive",
      time: 1770000005.2,
      opcode: 1,
      data: '{"event":"subscribed"}',
      size: 22,
    });

    expect(analyticsEntry._analysis).toBeDefined();
    expect(analyticsEntry._firebaseAnalytics).toBeDefined();
  });

  it("calculates timing breakdown correctly", () => {
    const har = buildHar([sampleFlow]);
    const entry = har.log.entries[0];

    expect(entry.time).toBe(250);
    expect(entry.timings.send).toBe(50);
    expect(entry.timings.wait).toBe(100);
    expect(entry.timings.receive).toBe(100);
  });

  it("suggests formatted HAR file names", () => {
    const testDate = new Date(2026, 7, 15, 9, 30, 45); // Aug 15, 2026 09:30:45
    expect(formatHarTimestamp(testDate)).toBe("20260815-093045");
    expect(suggestHarFileName("selected", testDate)).toBe(
      "network-requests-selected-20260815-093045.har",
    );
    expect(suggestHarFileName("all", testDate)).toBe(
      "network-requests-all-20260815-093045.har",
    );
  });
});
