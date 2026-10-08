# Inline HLS compatibility

An extension may return a finite HLS media playlist in the existing `SourceVideo.url` field as `data:application/vnd.apple.mpegurl;base64,...`. The `data://` spelling is also accepted for the outer URL. No new extension runtime or metadata fields are required.

This implementation accepts UTF-8 media playlists up to 512 KiB, 10,000 segment references, and 32 distinct inline AES-128 keys. Each key must use `data:application/octet-stream;base64,...` and decode to exactly 16 bytes. Segment and map URLs must be absolute HTTPS; existing network address validation and the source's configured proxy still apply. IVs and media sequence numbers are preserved. METHOD=NONE transitions are supported.

Master playlists, nested data playlists, live playlists, HLS variables, non-identity encryption, arbitrary data resources and remote key URIs in an inline playlist are deliberately unsupported. Extensions must first select an appropriate media rendition and resolve its keys. Ordinary HTTPS streams and EDL remain unchanged.

The server rewrites inline keys and remote resources to existing profile-scoped playback session URLs. Keys stay in memory, responses are private/no-store, and session removal/expiration drops the assets. Inline input is not passed directly to the web player. This is not a claim that all media-kit/mpv platforms support the same syntax.

Source discovery admits only data playlists that pass the same parser used for playback. `Cookie` and `Authorization` headers are forwarded only to the HTTPS origin declared in `SourceVideo.originalUrl`; they are removed for other origins or when that field is missing/invalid. Non-credential headers such as Referer and User-Agent remain available. `originalUrl` does not resolve relative playlist URLs.

Validation: inline parser tests, profile isolation and expiry, range/header/proxy forwarding, and the existing source/playback lifecycle tests. Real app installation or platform compatibility requires separate validation.

PR checks include the real JS runtime → Sources.videos → playback creation integration test. Empty video results retain `no-streams`; non-empty results containing no admitted stream return `unsupported-stream-format`. Mixed results keep supported streams. Errors never include rejected URLs, playlist contents or headers. Rejected APK results release their lease before returning the format error.
