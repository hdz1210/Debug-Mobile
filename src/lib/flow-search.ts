import type { NetworkFlow } from "../types/events";

export function flowMatchesSearch(flow: NetworkFlow, searchQuery: string): boolean {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return true;

  const analysisValues = flow.analysis
    ? [
        flow.analysis.providerId,
        flow.analysis.providerLabel,
        flow.analysis.serviceId,
        flow.analysis.serviceLabel,
        `${flow.analysis.providerLabel} ${flow.analysis.serviceLabel}`,
        flow.analysis.protocol,
        flow.analysis.platform,
        flow.analysis.status,
        ...flow.analysis.tags,
        ...flow.analysis.bundles.flatMap((bundle) => [
          bundle.appId,
          bundle.appName,
          bundle.appVersion,
          bundle.measurementId,
          ...bundle.events.flatMap((event) => [event.name, event.origin]),
        ]),
      ]
    : [];

  return [
    flow.method,
    flow.url,
    flow.host,
    flow.path,
    flow.statusCode,
    flow.requestBody?.format === "text" ? flow.requestBody.data : undefined,
    flow.responseBody?.format === "text" ? flow.responseBody.data : undefined,
    ...analysisValues,
  ]
    .filter((value) => value !== undefined)
    .some((value) => String(value).toLowerCase().includes(query));
}
