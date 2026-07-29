import type { CapturedBody } from "../../types/events";

export function formatBodyText(body: CapturedBody): {
  data: string;
  label: string;
  formEntries?: Array<[string, string]>;
} {
  const mediaType = (body.contentType ?? "").split(";", 1)[0].toLowerCase();
  if (mediaType.includes("json") || mediaType.endsWith("+json")) {
    try {
      return {
        data: JSON.stringify(JSON.parse(body.data), null, 2),
        label: "Pretty JSON",
      };
    } catch {
      return { data: body.data, label: "Invalid JSON · Raw text" };
    }
  }
  if (mediaType === "application/x-www-form-urlencoded") {
    return {
      data: body.data,
      label: "Form URL encoded",
      formEntries: Array.from(new URLSearchParams(body.data).entries()),
    };
  }
  if (mediaType.includes("xml") || mediaType.endsWith("+xml")) {
    return { data: body.data, label: "XML text" };
  }
  if (mediaType === "text/html") {
    return { data: body.data, label: "HTML text" };
  }
  return { data: body.data, label: "Raw text" };
}
