import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserStorage } from "./browser/storage.mjs";
import { BrowserHost } from "./browser/host.mjs";
import { createBrowserBridge } from "./browser/bridge.mjs";
import { parseOutboundProxy, webUrl } from "./browser/policy.mjs";
const cookie = (value = "secret") => ({
  name: "auth",
  value,
  domain: "example.org",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
});
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), "moa-browser-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function fakeLauncher({ goto } = {}) {
  const counters = { launches: 0, closed: 0, contexts: 0 };
  return {
    counters,
    launch: async () => {
      counters.launches++;
      const browser = new EventEmitter();
      browser.close = async () => {
        counters.closed++;
        browser.emit("disconnected");
      };
      browser.newContext = async (opts) => {
        counters.contexts++;
        let cookies = structuredClone(opts.storageState.cookies),
          open = true;
        return {
          addInitScript: async () => {},
          routeWebSocket: async () => {},
          route: async () => {},
          cookies: async () => cookies,
          storageState: async () => ({ cookies, origins: [] }),
          addCookies: async (values) => {
            for (const c of values) {
              cookies = cookies.filter(
                (x) =>
                  x.name !== c.name ||
                  x.domain !== c.domain ||
                  x.path !== c.path,
              );
              cookies.push(c);
            }
          },
          clearCookies: async (filter) => {
            cookies = filter
              ? cookies.filter((x) =>
                  Object.entries(filter).some(([k, v]) => x[k] !== v),
                )
              : [];
          },
          close: async () => {
            if (open) {
              open = false;
              counters.contexts--;
            }
          },
          newPage: async () => {
            const page = new EventEmitter();
            let url = "";
            Object.assign(page, {
              goto: async (target) => {
                url = target;
                await goto?.();
                if (!open) throw Error("closed");
              },
              url: () => url,
              title: async () => "fixture",
              route: async () => {},
              unroute: async () => {},
              evaluate: async () => 42,
              close: async () => {},
            });
            return page;
          },
        };
      };
      return browser;
    },
  };
}
async function fixture(t, options = {}) {
  const fake = fakeLauncher(options),
    host = new BrowserHost({
      launch: fake.launch,
      proxy: async () => ({ proxy: undefined, close() {} }),
      idleMs: 30,
      pageMs: 500,
      ...options,
    });
  t.after(() => host.close());
  return { host, fake, scope: host.scope(await directory(t)) };
}
test("encrypted state survives restart, is private and separates proxies", async (t) => {
  const dir = await directory(t),
    storage = new BrowserStorage(dir);
  await storage.save({ cookies: [cookie()], origins: [] });
  assert.equal(
    (await new BrowserStorage(dir).read()).cookies[0].value,
    "secret",
  );
  assert.equal(
    (await readFile(storage.file)).includes(Buffer.from("secret")),
    false,
  );
  assert.equal((await stat(storage.file)).mode & 0o777, 0o600);
  assert.deepEqual(
    await new BrowserStorage(dir, "http://proxy.example:80").read(),
    { cookies: [], origins: [] },
  );
});
test("cookies do not launch a browser, remain scoped and honor domain/path/expiry", async (t) => {
  const { host, scope, fake } = await fixture(t);
  await host.call(scope, {
    method: "cookies.set",
    url: "https://example.org/",
    cookie: cookie(),
  });
  assert.equal(fake.counters.launches, 0);
  assert.equal(
    (
      await host.call(scope, {
        method: "cookies.get",
        url: "https://example.org/a",
      })
    ).cookies.length,
    1,
  );
  assert.equal(
    (
      await host.call(scope, {
        method: "cookies.get",
        url: "https://sub.example.org/",
      })
    ).cookies.length,
    0,
  );
  const other = host.scope(await directory(t));
  assert.equal(
    (
      await host.call(other, {
        method: "cookies.get",
        url: "https://example.org/",
      })
    ).cookies.length,
    0,
  );
  await assert.rejects(
    host.call(scope, {
      method: "cookies.set",
      url: "https://wrong.example/",
      cookie: cookie(),
    }),
    /cookie_invalid/,
  );
  await host.call(scope, {
    method: "cookies.set",
    url: "https://example.org/",
    cookie: { ...cookie(), expires: 1 },
  });
  assert.equal(
    (
      await host.call(scope, {
        method: "cookies.get",
        url: "https://example.org/",
      })
    ).cookies.length,
    0,
  );
});
test("navigation/evaluation share a page; destroy frees the slot, warm browser is reused then idles", async (t) => {
  const { host, scope, fake } = await fixture(t),
    id = randomUUID();
  await host.call(scope, {
    method: "load",
    id,
    url: "https://example.org",
    javascript: true,
  });
  assert.equal(
    (await host.call(scope, { method: "evaluate", id, script: "21*2" })).json,
    "42",
  );
  assert.equal(host.status().contexts, 1);
  await host.call(scope, { method: "destroy", id });
  assert.equal(host.status().contexts, 0);
  await host.call(scope, {
    method: "load",
    id: randomUUID(),
    url: "https://example.org",
    javascript: true,
  });
  assert.equal(fake.counters.launches, 1);
  await host.release(scope);
  await delay(60);
  assert.equal(fake.counters.closed, 1);
  assert.equal(host.status().running, false);
});
test("global admission is bounded and waiting cancellation does not start Chromium", async (t) => {
  const { host, scope, fake } = await fixture(t, { limit: 1 });
  const id = randomUUID();
  await host.call(scope, { method: "load", id, url: "https://example.org" });
  const other = host.scope(await directory(t)),
    abort = new AbortController();
  const waiting = host.call(
    other,
    { method: "load", id: randomUUID(), url: "https://example.org" },
    abort.signal,
  );
  abort.abort();
  await assert.rejects(waiting);
  assert.equal(fake.counters.contexts, 1);
  await host.call(scope, { method: "destroy", id });
  assert.equal(host.status().contexts, 0);
});
test("page lifetime is bounded even when an extension forgets destroy", async (t) => {
  const { host, scope } = await fixture(t, { pageMs: 20 });
  await host.call(scope, {
    method: "load",
    id: randomUUID(),
    url: "https://example.org",
  });
  await delay(60);
  assert.equal(host.status().pages, 0);
  assert.equal(host.status().contexts, 0);
});
test("reverse RPC authenticates each JVM generation and revokes on release", async (t) => {
  const { host, fake } = await fixture(t),
    bridge = await createBrowserBridge(host);
  t.after(() => bridge.close());
  const registered = bridge.register(await directory(t));
  const call = (token) =>
    fetch(registered.url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        method: "cookies.get",
        url: "https://example.org",
      }),
    });
  assert.equal((await call("wrong")).status, 403);
  assert.equal((await call(registered.token)).status, 200);
  assert.equal(fake.counters.launches, 0);
  await bridge.release(registered.token);
  assert.equal((await call(registered.token)).status, 403);
});
test("source URLs and proxy configuration cannot select arbitrary protocols or credentials", () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.org",
    "https://user:pass@example.org",
  ])
    assert.throws(() => webUrl(url));
  for (const proxy of [
    "file:///tmp",
    "https://proxy.example",
    "socks5://user:pass@example.org",
    "http://example.org/path",
  ])
    assert.throws(() => parseOutboundProxy(proxy));
  assert.equal(
    parseOutboundProxy("socks5://127.0.0.1:1080"),
    "socks5://127.0.0.1:1080",
  );
});

test("release during browser startup closes its context before admitting a replacement", async (t) => {
  const fake = fakeLauncher();
  let start;
  const gate = new Promise((r) => (start = r));
  const host = new BrowserHost({
    launch: async () => {
      await gate;
      return fake.launch();
    },
    proxy: async () => ({ close() {} }),
    limit: 1,
    idleMs: 30,
  });
  t.after(() => host.close());
  const scope = host.scope(await directory(t));
  const pending = host.call(scope, {
    method: "load",
    id: randomUUID(),
    url: "https://example.org",
  });
  const failure = assert.rejects(pending);
  await delay(10);
  assert.equal(host.status().contexts, 1);
  const release = host.release(scope);
  start();
  await release;
  await failure;
  assert.equal(host.status().contexts, 0);
  assert.equal(fake.counters.contexts, 0);
  const replacement = host.scope(await directory(t));
  await host.call(replacement, {
    method: "load",
    id: randomUUID(),
    url: "https://example.org",
  });
  assert.equal(host.status().contexts, 1);
  await host.release(replacement);
});
