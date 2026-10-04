import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { BrowserHost } from "./host.mjs";

/** Loopback reverse RPC. Each JVM generation gets an unguessable, revocable scope. */
export async function createBrowserBridge(host = new BrowserHost()) {
  const scopes = new Map();
  const server = createServer(async (req, res) => {
    const scope = scopes.get(
      (req.headers.authorization || "").replace(/^Bearer /, ""),
    );
    const send = (status, value) => {
      if (!res.destroyed) {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      }
    };
    if (req.method !== "POST" || req.url !== "/webview" || !scope) {
      req.resume();
      send(403, { error: "source_browser_denied" });
      return;
    }
    const abort = new AbortController();
    const disconnected = () => {
      if (!res.writableEnded) {
        abort.abort();
        void host.closeContext(scope);
      }
    };
    res.once("close", disconnected);
    try {
      const parts = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024) throw Error("source_body_limit");
        parts.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(parts));
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw Error("source_request_invalid");
      const result = await host.call(scope, input, abort.signal);
      send(200, { result });
    } catch (error) {
      send(502, {
        error: /^source_[a-z_]+$/.test(error.message)
          ? error.message
          : "source_browser_failed",
      });
    } finally {
      res.removeListener("close", disconnected);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 5000;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  server.unref();
  return {
    host,
    register(directory) {
      const token = randomBytes(32).toString("hex");
      scopes.set(token, host.scope(directory));
      return {
        token,
        url: `http://127.0.0.1:${server.address().port}/webview`,
      };
    },
    async release(token) {
      const scope = scopes.get(token);
      scopes.delete(token);
      if (scope) await host.release(scope);
    },
    async close() {
      server.close();
      server.closeAllConnections();
      await host.close();
      scopes.clear();
    },
  };
}
