export function sourceBrowserLimits() {
  return { bytes: 32 * 1024 * 1024, requests: 512 };
}
export function parseOutboundProxy(value) {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 2048)
    throw Error("source_proxy_invalid");
  const u = new URL(value);
  if (
    !["http:", "socks5:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !["", "/"].includes(u.pathname) ||
    u.port === "0"
  )
    throw Error("source_proxy_invalid");
  return u.href;
}
export function webUrl(value) {
  if (typeof value !== "string" || value.length > 8192)
    throw Error("source_url_denied");
  const u = new URL(value);
  if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
    throw Error("source_url_denied");
  return u.href;
}
