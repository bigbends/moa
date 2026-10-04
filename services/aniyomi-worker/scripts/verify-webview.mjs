import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { BrowserHost } from "../browser/host.mjs";
import { createBrowserBridge } from "../browser/bridge.mjs";
import { openSourceBrowserProxy } from "../browser/proxy.mjs";
import assert from "node:assert/strict";
const server = createServer((req, res) => {
  if (req.url === "/slow") return;
  res.setHeader("content-type", "text/html");
  res.end(
    req.url === "/read"
      ? "<title>read</title>"
      : '<title>fixture</title><script>localStorage.setItem("saved","yes");setTimeout(()=>document.cookie="browser=ready; Path=/",300)</script>',
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
// Only this test-created origin is allowed. The production broker has no private-origin grant.
const host = new BrowserHost({
  idleMs: 500,
  proxy: (scope, signal) =>
    openSourceBrowserProxy({ ...scope, privateOrigins: [origin] }, signal),
});
const bridge = await createBrowserBridge(host),
  root = "/data/webview-fixture";
await mkdir(root, { recursive: true });
const scope = bridge.register(root);
const usage = async () => ({
  bytes: Number(await readFile("/sys/fs/cgroup/memory.current", "utf8")),
  anon: Number(
    (await readFile("/sys/fs/cgroup/memory.stat", "utf8")).match(
      /^anon (\d+)/m,
    )?.[1] || 0,
  ),
});
const before = await usage();
let peak = before;
const sampling = setInterval(
  () =>
    void usage().then((v) => {
      peak = {
        bytes: Math.max(peak.bytes, v.bytes),
        anon: Math.max(peak.anon, v.anon),
      };
    }),
  100,
);
const report = { before };
const started = performance.now();
try {
  assert.equal(host.status().running, false);
  const child = spawn(
    "java",
    [
      "-Xmx128m",
      "-cp",
      "/app/test-classes:/app/build/target/apk-worker-0.1.0.jar:/app/build/dependencies/*",
      "WebViewFixture",
      origin + "/",
    ],
    {
      env: {
        ...process.env,
        MOA_WEBVIEW_URL: scope.url,
        MOA_WEBVIEW_TOKEN: scope.token,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error(output.slice(-2500));
  assert.match(output, /passed/);
  report.javaCallbacks = true;
  report.coldJavaFlowMs = Math.round(performance.now() - started);
  report.browserLaunches = host.status().launches;
  assert.equal(report.browserLaunches, 1);
  await bridge.release(scope.token);
  const first = host.scope(root),
    otherRoot = "/data/webview-other";
  await mkdir(otherRoot, { recursive: true });
  const other = host.scope(otherRoot);
  const load = async (scope, path = "/read") => {
    const id = randomUUID();
    await host.call(scope, {
      method: "load",
      id,
      url: origin + path,
      javascript: true,
      domStorage: true,
    });
    return id;
  };
  const warmStart = performance.now();
  const firstId = await load(first);
  report.warmNavigationMs = Math.round(performance.now() - warmStart);
  const otherId = await load(other);
  const inspect = async (scope, id) =>
    JSON.parse(
      (
        await host.call(scope, {
          method: "evaluate",
          id,
          script:
            "({saved:localStorage.getItem('saved'),cookie:document.cookie})",
        })
      ).json,
    );
  const persisted = await inspect(first, firstId),
    isolated = await inspect(other, otherId);
  assert.equal(persisted.saved, "yes");
  assert.match(persisted.cookie, /browser=ready/);
  assert.equal(isolated.saved, null);
  assert.equal(isolated.cookie, "");
  report.persistenceAndIsolation = true;
  await host.release(first);
  await host.release(other);
  const blocked = host.scope(otherRoot);
  await assert.rejects(
    host.call(blocked, {
      method: "load",
      id: randomUUID(),
      url: "http://127.0.0.1:1/",
      javascript: true,
    }),
  );
  await host.release(blocked);
  report.privateNetworkBlocked = true;
  const abortScope = bridge.register(otherRoot),
    abort = new AbortController();
  const pending = fetch(abortScope.url, {
    method: "POST",
    headers: {
      authorization: "Bearer " + abortScope.token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      method: "load",
      id: randomUUID(),
      url: origin + "/slow",
      javascript: true,
      domStorage: true,
    }),
    signal: abort.signal,
  });
  const cancelled = assert.rejects(pending);
  await new Promise((r) => setTimeout(r, 600));
  abort.abort();
  await cancelled;
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(host.status().contexts, 0);
  await bridge.release(abortScope.token);
  report.cancellationReleased = true;
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(host.status().running, false);
  assert.equal(host.status().contexts, 0);
  report.idleClosed = true;
  clearInterval(sampling);
  report.peak = peak;
  report.after = await usage();
  console.log(JSON.stringify(report));
  await writeFile("/data/webview-report.json", JSON.stringify(report, null, 2));
} finally {
  clearInterval(sampling);
  await bridge.close();
  server.closeAllConnections();
  server.close();
}
