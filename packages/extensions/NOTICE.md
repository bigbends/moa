# License and dependencies

The QuickJS host (`src/vendor`), Mangayomi compatibility modules and outbound
proxy (`src/proxy.ts`) are MOA-authored code licensed under GPL-3.0-or-later.
The complete license is included as `LICENSE` and at the repository root.

The package provides video dispatch (`getVideoList`), public-network-only
invocations, request/response limits, repository parsing and proxy transports.

Source extension JavaScript is downloaded separately from the repository chosen
by the user; it is not bundled into this package. QuickJS, its WASM/wrappers,
LinkeDOM and the proxy dependencies retain their original package licenses.
Full dependency notices and source release requirements are in
[THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md).
