// GPL-3.0-or-later. The authenticated host chooses scope and outbound proxy.
import { timingSafeEqual, createHash } from 'node:crypto';
import { parseOutboundProxy } from '../aniyomi-worker/browser/policy.mjs';
import { isPublicSourceAddress } from '../aniyomi-worker/browser/address.mjs';
import { isIP } from 'node:net';

export const REQUEST_LIMIT = 512 * 1024;
export const RESPONSE_LIMIT = 4 * 1024 * 1024;
export const MAX_TIMEOUT = 90_000;
const deniedHeaders = /^(host|connection|proxy-.*|forwarded|x-forwarded-.*|upgrade|transfer-encoding|content-length|te|trailer)$/i;
export function authorized(header, secret) {
  if (typeof header !== 'string') return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function validateRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.scope !== 'string' || !/^[a-zA-Z0-9._:-]{1,256}$/.test(input.scope) ||
      typeof input.proxy !== 'string' || typeof input.script !== 'string' ||
      !input.script.trim() || !Number.isInteger(input.timeoutMs) ||
      input.timeoutMs < 1 || input.timeoutMs > MAX_TIMEOUT) throw Error('source_request_invalid');
  let url, proxy;
  try { url = new URL(input.url); } catch { throw Error('source_url_denied'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (typeof input.url !== 'string' || input.url.length > 8192 || url.protocol !== 'https:' ||
      url.username || url.password || (isIP(host) && !isPublicSourceAddress(host))) throw Error('source_url_denied');
  // Fragments never reach the network. CONNECT policy checks every destination
  // (including redirects/subresources) and connects to its validated address.
  try { proxy = parseOutboundProxy(input.proxy) ?? ''; } catch { throw Error('source_proxy_invalid'); }
  const headers = input.headers ?? {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > 64)
    throw Error('source_headers_invalid');
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || deniedHeaders.test(name) ||
        typeof value !== 'string' || value.length > 16384 || /[\x00-\x1f\x7f]/.test(value)) throw Error('source_headers_invalid');
  }
  return { scope: input.scope, proxy, url: url.href, headers, script: input.script, timeoutMs: input.timeoutMs };
}
export function sessionKey(request) {
  return createHash('sha256').update(JSON.stringify([request.scope, request.proxy])).digest('hex');
}
export function safeError(error) {
  return /^source_[a-z_]+$/.test(error?.message ?? '') ? error.message : 'source_browser_failed';
}
