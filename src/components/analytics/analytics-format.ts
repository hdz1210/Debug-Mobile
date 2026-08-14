import type { AnalysisValue, FlowAnalysis } from "../../types/events";

export function analysisLabel(analysis: FlowAnalysis): string {
  const provider = analysis.providerLabel.trim();
  const service = analysis.serviceLabel.trim();

  if (!provider) return service || analysis.serviceId;
  if (!service) return provider;
  if (service.toLowerCase().includes(provider.toLowerCase())) return service;
  return `${provider} ${service}`;
}

export function formatAnalysisValue(value: AnalysisValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

export function humanizeAnalysisStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
