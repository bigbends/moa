import { openSourceBrowserProxy } from "./proxy.mjs";
import { BrowserStorage } from "./storage.mjs";
import { webUrl, parseOutboundProxy } from "./policy.mjs";

// MOA browser lifecycle/session management; GPL-3.0-or-later.
// APK pages stay alive across loadUrl/evaluate/cookie calls until destroy or a hard deadline.
export class BrowserHost {
  constructor({
    launch,
    proxy = openSourceBrowserProxy,
    idleMs = 120000,
    pageMs = 45000,
    limit = 2,
  } = {}) {
    this.launcher =
      launch ||
      (async () => {
        const { chromium } = await import("patchright");
        return chromium.launch({
          headless: true,
          args: [
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--disable-dev-shm-usage",
          ],
          ...(process.env.MOA_APK_BROWSER_EXECUTABLE
            ? { executablePath: process.env.MOA_APK_BROWSER_EXECUTABLE }
            : {}),
        });
      });
    this.proxy = proxy;
    this.idleMs = idleMs;
    this.pageMs = pageMs;
    this.limit = limit;
    this.scopes = new Set();
    this.active = new Set();
    this.waiters = new Set();
    this.closed = false;
    this.launchCount = 0;
  }
  scope(directory) {
    const scope = {
      directory,
      pages: new Map(),
      abort: new AbortController(),
      proxy: undefined,
    };
    this.scopes.add(scope);
    return scope;
  }
  async state(scope, proxy) {
    if (scope.abort.signal.aborted || this.closed)
      throw Error("source_browser_closed");
    const normalized = parseOutboundProxy(proxy);
    if (scope.statePromise && scope.proxy !== normalized) {
      await this.closeContext(scope);
      scope.statePromise = undefined;
    }
    scope.proxy = normalized;
    if (!scope.statePromise) {
      scope.storage = new BrowserStorage(scope.directory, normalized);
      scope.statePromise = scope.storage
        .read()
        .then((state) => (scope.state = state));
    }
    return scope.statePromise;
  }
  async browser() {
    clearTimeout(this.idle);
    if (!this.browserPromise)
      this.browserPromise = this.launcher()
        .then((b) => {
          this.launchCount++;
          b.on("disconnected", () => {
            if (this.browserPromise === promise) {
              this.browserPromise = undefined;
              for (const scope of this.scopes) void this.closeContext(scope);
            }
          });
          return b;
        })
        .catch((e) => {
          this.browserPromise = undefined;
          throw e;
        });
    const promise = this.browserPromise;
    return promise;
  }
  async context(scope, input, signal) {
    if (scope.session) return scope.session.promise;
    const session = { abort: new AbortController() };
    scope.session = session;
    const run = async () => {
      const deadline = AbortSignal.any([
        scope.abort.signal,
        session.abort.signal,
        signal,
        AbortSignal.timeout(22000),
      ]);
      try {
        await new Promise((resolve, reject) => {
          const check = () => {
            if (deadline.aborted) {
              cleanup();
              reject(Error("source_request_timeout"));
            } else if (
              this.active.size < this.limit &&
              ![...this.active].some((s) => s.directory === scope.directory)
            ) {
              this.active.add(scope);
              cleanup();
              resolve();
            }
          };
          const cleanup = () => {
            this.waiters.delete(check);
            deadline.removeEventListener("abort", check);
          };
          this.waiters.add(check);
          deadline.addEventListener("abort", check, { once: true });
          check();
        });
        const browser = await this.browser();
        deadline.throwIfAborted();
        session.transport = await this.proxy(
          { outboundProxy: scope.proxy },
          session.abort.signal,
        );
        deadline.throwIfAborted();
        const context = await browser.newContext({
          serviceWorkers: "block",
          acceptDownloads: false,
          storageState: scope.state,
          proxy: session.transport.proxy,
          javaScriptEnabled: Boolean(input.javascript),
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
          viewport: { width: 390, height: 844 },
        });
        session.context = context;
        scope.context = context;
        if (!input.domStorage)
          await context.addInitScript(() => {
            for (const key of ["localStorage", "sessionStorage"])
              Object.defineProperty(window, key, {
                get() {
                  throw new DOMException(
                    "Storage is disabled",
                    "SecurityError",
                  );
                },
                configurable: false,
              });
          });
        deadline.throwIfAborted();
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.route("**/*", async (route) => {
          try {
            webUrl(route.request().url());
            await route.continue();
          } catch {
            await route.abort("blockedbyclient").catch(() => {});
          }
        });
        return context;
      } catch (e) {
        await this.disposeSession(scope, session);
        throw e;
      }
    };
    session.promise = run();
    return session.promise;
  }
  async snapshot(scope) {
    if (scope.context) {
      const data = await scope.context.storageState();
      scope.state = {
        cookies: data.cookies.slice(-512),
        origins: data.origins.slice(-32),
      };
    }
    if (scope.state) {
      scope.save = (scope.save || Promise.resolve())
        .catch(() => {})
        .then(() => scope.storage.save(scope.state));
      await scope.save;
    }
  }
  async cookies(scope, url) {
    webUrl(url);
    if (scope.context) {
      scope.state.cookies = await scope.context.cookies();
    }
    const u = new URL(url),
      now = Date.now() / 1000;
    return scope.state.cookies
      .filter((c) => {
        const d = c.domain.replace(/^\./, "");
        return (
          (c.domain.startsWith(".")
            ? u.hostname === d || u.hostname.endsWith("." + d)
            : u.hostname === d) &&
          (u.pathname === c.path ||
            u.pathname.startsWith(
              c.path.endsWith("/") ? c.path : c.path + "/",
            )) &&
          (!c.secure || u.protocol === "https:") &&
          (c.expires === -1 || c.expires > now)
        );
      })
      .sort((a, b) => b.path.length - a.path.length);
  }
  async call(scope, input, signal = new AbortController().signal) {
    signal.throwIfAborted();
    await this.state(scope, input.proxy);
    const id = input.id;
    if (input.method === "cookies.get")
      return { cookies: await this.cookies(scope, input.url) };
    if (input.method === "cookies.set") {
      const c = input.cookie,
        u = new URL(webUrl(input.url));
      if (
        !c ||
        typeof c.name !== "string" ||
        typeof c.value !== "string" ||
        typeof c.domain !== "string" ||
        typeof c.path !== "string" ||
        !c.path.startsWith("/") ||
        !Number.isFinite(c.expires) ||
        JSON.stringify(c).length > 8192
      )
        throw Error("source_cookie_invalid");
      const d = c.domain.replace(/^\./, "");
      if (u.hostname !== d && !u.hostname.endsWith("." + d))
        throw Error("source_cookie_invalid");
      scope.state.cookies = scope.state.cookies.filter(
        (x) =>
          !(x.name === c.name && x.domain === c.domain && x.path === c.path),
      );
      if (c.expires === -1 || c.expires > Date.now() / 1000) {
        scope.state.cookies.push(c);
        scope.state.cookies = scope.state.cookies.slice(-512);
        if (scope.context) await scope.context.addCookies([c]);
      } else if (scope.context)
        await scope.context.clearCookies({
          name: c.name,
          domain: c.domain,
          path: c.path,
        });
      await this.snapshot(scope);
      return {};
    }
    if (input.method === "cookies.flush") {
      await this.snapshot(scope);
      return {};
    }
    if (input.method === "cookies.clear") {
      scope.state.cookies = [];
      if (scope.context) await scope.context.clearCookies();
      await this.snapshot(scope);
      return {};
    }
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw Error("source_page_invalid");
    if (input.method === "destroy") {
      const entry = scope.pages.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        scope.pages.delete(id);
        await entry.page.close().catch(() => {});
      }
      if (!scope.pages.size) await this.closeContext(scope);
      return {};
    }
    if (input.method === "load") {
      const url = webUrl(input.url);
      if (scope.pages.size >= 2 && !scope.pages.has(id))
        throw Error("source_browser_busy");
      if (
        input.userAgent !== undefined &&
        (typeof input.userAgent !== "string" || input.userAgent.length > 1024)
      )
        throw Error("source_request_invalid");
      const context = await this.context(scope, input, signal);
      signal.throwIfAborted();
      for (const cookie of input.cookies || []) {
        if (!cookie || JSON.stringify(cookie).length > 8192)
          throw Error("source_cookie_invalid");
      }
      if ((input.cookies || []).length > 512)
        throw Error("source_cookie_invalid");
      if (input.cookies?.length) await context.addCookies(input.cookies);
      let entry = scope.pages.get(id);
      if (!entry) {
        const page = await context.newPage();
        entry = { page };
        scope.pages.set(id, entry);
        page.on("popup", (p) => void p.close().catch(() => {}));
      }
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        void this.call(scope, {
          method: "destroy",
          id,
          proxy: scope.proxy,
        }).catch(() => {});
      }, this.pageMs);
      entry.timer.unref();
      const page = entry.page;
      await page.unroute("**/*");
      await page.route("**/*", async (route) => {
        try {
          const request = route.request(),
            target = new URL(webUrl(request.url()));
          if (target.origin === new URL(url).origin) {
            const headers = await request.allHeaders();
            for (const [key, value] of Object.entries(input.headers || {}))
              if (
                !/^(host|content-length|connection|cookie|user-agent)$/i.test(
                  key,
                )
              )
                headers[key.toLowerCase()] = value;
            await route.continue({ headers });
          } else await route.continue();
        } catch {
          await route.abort("blockedbyclient").catch(() => {});
        }
      });
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 22000 });
        // Android onPageFinished is delivered even for HTTP error/challenge pages.
        await this.snapshot(scope);
        return {
          url: page.url(),
          title: await page.title(),
          cookies: scope.state.cookies,
        };
      } catch (e) {
        await this.call(scope, { method: "destroy", id, proxy: scope.proxy });
        throw e;
      }
    }
    const entry = scope.pages.get(id);
    if (!entry) throw Error("source_page_closed");
    if (input.method === "evaluate") {
      if (typeof input.script !== "string" || input.script.length > 256 * 1024)
        throw Error("source_request_invalid");
      let timer;
      try {
        const result = await Promise.race([
          entry.page.evaluate(input.script, undefined, false),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              void this.call(scope, {
                method: "destroy",
                id,
                proxy: scope.proxy,
              }).catch(() => {});
              reject(Error("source_request_timeout"));
            }, 10000);
          }),
        ]);
        const json = JSON.stringify(result ?? null);
        if (Buffer.byteLength(json) > 1024 * 1024)
          throw Error("source_body_limit");
        await this.snapshot(scope);
        return { json, cookies: scope.state.cookies };
      } finally {
        clearTimeout(timer);
      }
    }
    throw Error("source_method_unsupported");
  }
  async disposeSession(scope, session) {
    if (session.closing) return session.closing;
    session.closing = (async () => {
      for (const entry of scope.pages.values()) clearTimeout(entry.timer);
      scope.pages.clear();
      const context = session.context;
      if (context) {
        try {
          await this.snapshot(scope);
        } catch {}
        await context.close().catch(() => {});
      }
      session.transport?.close();
      if (scope.session === session) {
        scope.context = undefined;
        scope.session = undefined;
      }
      this.active.delete(scope);
      for (const next of [...this.waiters]) next();
      if (!this.active.size) {
        clearTimeout(this.idle);
        this.idle = setTimeout(() => void this.closeBrowser(), this.idleMs);
        this.idle.unref();
      }
    })();
    return session.closing;
  }
  async closeContext(scope) {
    const session = scope.session;
    if (!session) return;
    session.abort.abort();
    await session.promise?.catch(() => {});
    await this.disposeSession(scope, session);
  }
  async release(scope) {
    scope.abort.abort();
    await this.closeContext(scope);
    await scope.save?.catch(() => {});
    this.scopes.delete(scope);
  }
  async closeBrowser() {
    const promise = this.browserPromise;
    this.browserPromise = undefined;
    if (promise) await promise.then((b) => b.close()).catch(() => {});
  }
  status() {
    return {
      running: Boolean(this.browserPromise),
      contexts: this.active.size,
      pages: [...this.scopes].reduce((n, s) => n + s.pages.size, 0),
      launches: this.launchCount,
    };
  }
  async close() {
    this.closed = true;
    clearTimeout(this.idle);
    await Promise.all([...this.scopes].map((s) => this.release(s)));
    clearTimeout(this.idle);
    await this.closeBrowser();
  }
}
