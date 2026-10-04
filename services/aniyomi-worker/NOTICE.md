# Source and build provenance

MOA's minimal Aniyomi API14/API16 runtime, Android compatibility classes,
Inspect, Filters/Preferences, supervisor, build recipe and browser bridge are
MOA-authored code licensed under GPL-3.0-or-later. This includes the browser
proxy, public-address policy, lifecycle/session management and private
JVM-to-Node RPC. Third-party build-selected sources and dependencies retain
separate licenses described below.
Patchright/Chromium are pinned by the browser package lockfile and carry their own licenses.

No Android emulator, Aniyomi application distribution or AnymeX bridge is bundled.

The build downloads **source archives with mandatory SHA-256 verification**:

- Suwayomi Server `v2.3.2243`, SHA-256
  `e70f664013e83d49fee66ab5f83b6f281d956560c5a8baeba1d00b417048efb2`.
  Only network/Rx helpers, Android preference declarations, URI/UriCodec and LruCache are selected.
  URI/UriCodec and LruCache retain their Android Open Source Project Apache-2.0 notices.
  URI canonicalization omits Android emulated-storage remapping on the server.
  Upstream license and selected source paths ship in the build output.
- Aniyomi `97414446b8a95994c72dd33c41c971a89d4d25b8` (`v0.18.2.1`), SHA-256
  `e9bae19c0387b0aa7f977e61ffc35712f0711c7ec877d606bd1bce2ff2193521`.
  Only the video source API is selected. Compose-only annotations are omitted;
  HttpServer explicitly fails as unsupported. Coroutine imports and the multiplatform
  PreferenceScreen declaration are adapted in `build.py`. Apache-2.0 license
  ships alongside `build-inventory.json`.

`dependencies.lock.json` verifies every runtime dependency JAR by hash. Maven
and the Kotlin compiler are build-time only. The generated source tree and exact
patch recipe remain available from this repository's build, including changes
to upstream MPL-covered helper files. Original source notices are preserved.

APK extension authors retain their own licenses; user-installed APKs and
converted JARs are data volumes, not part of the runtime image or Git repository.

The conversion pass redirects OkHttp `Headers.Builder.set/add` calls through
MOA's `UrlHeaders` helper. Only Unicode URL values in Referer/Origin are serialized
to ASCII; other headers and control-character rejection keep OkHttp validation.
Original signed APKs remain unchanged. Converted output is keyed by the runtime
fingerprint and is rebuilt once when this compatibility pass changes.

DEX conversion computes JVM stack-map frames (`-cf`); JVM verification remains enabled.
The RequestsKt facade also exposes suspending get/post helpers using the same
network client and cancellable awaitSuccess path.

A narrow frame-metadata pass corrects dex2jar 2.4.37 emitting the nonexistent
`java/util/Object` common-superclass fallback to `java/lang/Object`. It does not
rewrite extension class names or change method instructions.

## License boundaries and outstanding provenance

MOA-authored code is GPL-3.0-or-later. This does not replace the original licenses
of third-party copied or build-selected files.

Suwayomi-selected `androidx/preference/*.java`, `MemoryCookieJar.kt` and
`RxCoroutineBridge.kt` are **MPL-2.0**. `JsonObject.kt` has no individual header and
is conservatively treated as MPL-2.0. Preference/ListPreference/TwoStatePreference
are modified by the build recipe and remain MPL-covered.

AOSP NonNull/Nullable, Uri, LruCache and UriCodec retain Apache-2.0 headers.
Tachiyomi-derived network/Jsoup helpers carry the nested Apache notice,
Copyright 2015 Javier Tomás. The full nested notice is now retained under root
`LICENSES/Tachiyomi-Apache-2.0.txt`; its individual-file scope and UriCodec's ASF
NOTICE still need confirmation. Aniyomi's selected source API is Apache-2.0.

Authorship/copy provenance of the `mihon/core/common` Json/RequestsCompat/HttpServer
shims is **UNKNOWN**. Maven legacy/shaded JAR licensing, exact browser/native
components and complete binary Corresponding Source material remain owner release
checks. See [THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md) and
[THIRD-PARTY-SOURCES](../../docs/THIRD-PARTY-SOURCES.md).

The runtime Dockerfile preserves generated modified sources under `/app/build/src`
and full project/dependency notices. Original notices and embedded JAR notices
must remain in any redistribution; recipe links alone do not fulfill all source
and attribution requirements.
