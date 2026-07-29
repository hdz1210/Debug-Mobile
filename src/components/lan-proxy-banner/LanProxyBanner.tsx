import { useState } from "react";
import type {
  CaptureStatusSnapshot,
  NetworkInfo,
} from "../../types/events";

type LanProxyBannerProps = {
  capture: CaptureStatusSnapshot;
  isScanning: boolean;
  networkError: string | null;
  networkInfo: NetworkInfo | null;
  port: number;
  onRefresh: () => void;
};

export function LanProxyBanner({
  capture,
  isScanning,
  networkError,
  networkInfo,
  port,
  onRefresh,
}: LanProxyBannerProps) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const address = networkInfo?.recommendedAddress ?? null;
  const recommendedInterface = networkInfo?.addresses.find(
    (entry) => entry.address === address,
  );
  const alternateAddresses =
    networkInfo?.addresses.filter((entry) => entry.address !== address) ?? [];
  const isRunning = capture.status === "running";

  const copyAddress = async () => {
    if (!address) {
      return;
    }
    try {
      await navigator.clipboard.writeText(address);
      setCopyMessage("IP copied");
    } catch {
      setCopyMessage("Copy failed");
    }
    window.setTimeout(() => setCopyMessage(null), 1_800);
  };

  return (
    <section className="lan-proxy-banner" aria-label="Mobile proxy connection">
      <div className="lan-proxy-summary">
        <span className="eyebrow">Connect mobile device</span>
        <strong>
          {address
            ? `${address}:${port}`
            : isScanning
              ? "Scanning local network…"
              : "No usable LAN IPv4 found"}
        </strong>
        <span>
          {recommendedInterface
            ? `${recommendedInterface.interfaceName} · auto-detected`
            : networkError ?? "Connect this computer to Wi-Fi or Ethernet."}
        </span>
      </div>

      <div className="lan-proxy-field">
        <span>Host / IP</span>
        <code className="lan-proxy-address">{address ?? "—"}</code>
      </div>
      <div className="lan-proxy-field">
        <span>Port</span>
        <code>{port}</code>
      </div>

      <div className="lan-proxy-actions">
        <button
          className="button"
          type="button"
          disabled={!address}
          onClick={() => void copyAddress()}
        >
          Copy IP
        </button>
        <button
          className="button"
          type="button"
          disabled={isScanning}
          onClick={onRefresh}
        >
          {isScanning ? "Scanning…" : "Scan again"}
        </button>
      </div>

      <div className="lan-proxy-help">
        <span data-running={isRunning}>
          {isRunning
            ? "Proxy is running. Set the phone Wi-Fi proxy to Manual."
            : "Start capture, then set the phone Wi-Fi proxy to Manual."}
        </span>
        {copyMessage ? <span role="status">{copyMessage}</span> : null}
        {alternateAddresses.length > 0 ? (
          <details>
            <summary>{alternateAddresses.length} other local IP(s)</summary>
            <ul>
              {alternateAddresses.map((entry) => (
                <li key={`${entry.interfaceName}-${entry.address}`}>
                  <code>{entry.address}</code> — {entry.interfaceName}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </section>
  );
}
