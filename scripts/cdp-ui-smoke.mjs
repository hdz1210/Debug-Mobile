import { spawnSync } from "node:child_process";

const [cdpPort = "19333", proxyPort = "8080", targetUrl, mode = "full"] =
  process.argv.slice(2);

if (!targetUrl) {
  throw new Error("Usage: cdp-ui-smoke.mjs <cdp-port> <proxy-port> <target-url>");
}

const cdpBaseUrl = `http://127.0.0.1:${cdpPort}`;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findTarget() {
  const deadline = Date.now() + 20_000;
  let lastObservation = "debug endpoint did not respond";
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`${cdpBaseUrl}/json/list`).then((response) =>
        response.json(),
      );
      lastObservation = JSON.stringify(
        targets.map(({ title, type, url }) => ({ title, type, url })),
      );
      const target = targets.find(
        (candidate) =>
          candidate.type === "page" &&
          candidate.webSocketDebuggerUrl &&
          (candidate.title.includes("App Network Debugger") ||
            candidate.url.includes("tauri.localhost") ||
            candidate.url.includes("tauri://localhost")),
      );
      if (target) {
        return target;
      }
    } catch {
      // WebView2 has not opened the debugging endpoint yet.
    }
    await delay(200);
  }
  throw new Error(
    `Timed out waiting for the App Network Debugger WebView. Last observation: ${lastObservation}`,
  );
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextCommandId = 1;
const pendingCommands = new Map();

socket.addEventListener("message", (message) => {
  const response = JSON.parse(message.data);
  if (!response.id) {
    return;
  }
  const pending = pendingCommands.get(response.id);
  if (!pending) {
    return;
  }
  pendingCommands.delete(response.id);
  if (response.error) {
    pending.reject(new Error(response.error.message));
  } else {
    pending.resolve(response.result);
  }
});

function command(method, params = {}) {
  const id = nextCommandId;
  nextCommandId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pendingCommands.set(id, { resolve, reject });
  });
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text,
    );
  }
  return response.result.value;
}

async function waitFor(expression, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) {
      return;
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function clickButtonExpression(label) {
  return `(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

function runProxiedCurl(url, extraArguments = []) {
  const curl = spawnSync(
    "curl.exe",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--proxy",
      `http://127.0.0.1:${proxyPort}`,
      ...extraArguments,
      url,
    ],
    {
      env: { ...process.env, NO_PROXY: "", no_proxy: "" },
      stdio: "ignore",
    },
  );
  if (curl.status !== 0) {
    throw new Error(`curl failed with exit code ${curl.status}`);
  }
}

let captureStarted = false;

try {
  await command("Runtime.enable");
  await waitFor(
    "document.querySelector('.network-app') !== null",
    "the application shell",
  );

  await evaluate(
    `(() => {
      const select = document.querySelector(".proxy-settings select");
      if (!select) return false;
      select.value = "lan";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await waitFor(
    `(() => {
      const address = document.querySelector(".lan-proxy-address")?.textContent?.trim();
      return Boolean(address && address !== "—" && address !== "127.0.0.1");
    })()`,
    "an automatically detected LAN IPv4 address",
  );
  const detectedLanIp = await evaluate(
    "document.querySelector('.lan-proxy-address')?.textContent?.trim()",
  );

  await evaluate(
    `localStorage.removeItem("appdbg.capture-consent.v1"); ${clickButtonExpression("Start capture")}`,
  );
  await waitFor(
    "document.querySelector('[role=\"dialog\"]') !== null",
    "the authorization dialog",
  );
  await evaluate(clickButtonExpression("I understand, start capture"));
  await waitFor(
    "document.querySelector('.status-dot')?.dataset.status === 'running'",
    "capture to enter running state",
  );
  captureStarted = true;

  if (mode === "start-only") {
    process.stdout.write(
      `${JSON.stringify({ captureStarted: true, detectedLanIp })}\n`,
    );
    captureStarted = false;
    socket.close();
    process.exit(0);
  }

  runProxiedCurl(targetUrl);
  runProxiedCurl(`${targetUrl}&step=redacted`, [
    "--header",
    "Authorization: Bearer smoke-secret",
  ]);
  runProxiedCurl(`${targetUrl}&step=after-redacted`);

  await waitFor(
    "document.querySelectorAll('tbody tr[data-state]').length >= 3",
    "three captured request rows, including one after a redacted header",
  );
  await evaluate(
    `(() => {
      const row = document.querySelectorAll("tbody tr[data-state]")[1];
      if (!row) return false;
      row.click();
      return true;
    })()`,
  );
  await waitFor(
    "document.querySelector('.overview-list')?.textContent?.includes('README.md') === true",
    "the selected request overview",
  );

  await evaluate(clickButtonExpression("Headers"));
  await waitFor(
    `(() => {
      const text = document.querySelector(".detail-content")?.textContent ?? "";
      return text.includes("Request headers") &&
        text.includes("••••••••") &&
        !text.includes("smoke-secret");
    })()`,
    "the redacted authorization header",
  );
  await evaluate(clickButtonExpression("Query"));
  await waitFor(
    "document.querySelector('.detail-content')?.textContent?.includes('ui-smoke') === true",
    "the query tab",
  );
  await evaluate(clickButtonExpression("Response"));
  await waitFor(
    "document.querySelector('.body-content')?.textContent?.includes('App Network Debugger') === true",
    "the captured response body",
  );

  const rowCount = await evaluate(
    "document.querySelectorAll('tbody tr[data-state]').length",
  );
  const selectedUrl = await evaluate(
    `Array.from(document.querySelectorAll(".overview-list dd"))
      .map((node) => node.textContent)
      .find((value) => value?.includes("README.md"))`,
  );

  await evaluate(clickButtonExpression("Stop"));
  await waitFor(
    "document.querySelector('.status-dot')?.dataset.status === 'stopped'",
    "capture to stop",
  );
  captureStarted = false;

  await evaluate(clickButtonExpression("History"));
  await waitFor(
    "document.querySelector('.history-card') !== null",
    "the saved session in capture history",
  );
  await evaluate(
    `(() => {
      const session = document.querySelector(".history-main");
      if (!session) return false;
      session.click();
      return true;
    })()`,
  );
  await waitFor(
    "document.querySelector('.history-notice') !== null && document.querySelectorAll('tbody tr[data-state]').length > 0",
    "the saved session to reload",
  );

  process.stdout.write(
    `${JSON.stringify({
      captureStarted: true,
      detectedLanIp,
      capturedRows: rowCount,
      selectedUrl,
      verifiedTabs: ["overview", "headers", "query", "response"],
      encodingRecoveryVerified: rowCount >= 3,
      captureStopped: true,
      historyReloaded: true,
    })}\n`,
  );
} finally {
  if (captureStarted) {
    try {
      await evaluate(clickButtonExpression("Stop"));
      await waitFor(
        "document.querySelector('.status-dot')?.dataset.status === 'stopped'",
        "capture cleanup",
        5_000,
      );
    } catch {
      // The PowerShell harness also terminates only processes created by it.
    }
  }
  socket.close();
}
