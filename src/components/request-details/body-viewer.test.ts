import { describe, expect, it } from "vitest";
import type { CapturedBody } from "../../types/events";
import { formatBodyText } from "./format-body";

function textBody(data: string, contentType: string): CapturedBody {
  return {
    format: "text",
    data,
    contentType,
    size: data.length,
    truncated: false,
  };
}

describe("formatBodyText", () => {
  it("pretty prints JSON", () => {
    expect(
      formatBodyText(textBody('{"ok":true}', "application/json")).data,
    ).toBe('{\n  "ok": true\n}');
  });

  it("falls back safely for invalid JSON", () => {
    expect(
      formatBodyText(textBody("{broken", "application/json")),
    ).toEqual({
      data: "{broken",
      label: "Invalid JSON · Raw text",
    });
  });

  it("preserves duplicate form fields", () => {
    expect(
      formatBodyText(
        textBody("tag=one&tag=two", "application/x-www-form-urlencoded"),
      ).formEntries,
    ).toEqual([
      ["tag", "one"],
      ["tag", "two"],
    ]);
  });
});
