# Source and binary provenance

MOA's optional gate, relay, JSONL worker and lifecycle code are GPL-3.0-or-later
(repository LICENSE). Existing browser proxy/address/policy modules are imported
unchanged from services/aniyomi-worker/browser; see its NOTICE.md.

InvisiblePlaywright 0.26.1: MIT wrapper and bundled Apache-2.0 Playwright facade.
Invisible-core 36.32.0: MIT. Installed wheels retain their LICENSE files and
dist-info metadata, including each transitive dependency's notice. Socks 2.8.10
is MIT, with its dependencies/notices retained in node_modules.

Firefox engine: firefox-36, upstream 151.0, Linux amd64 BuildID 20261004151457.
Archive SHA256: 11ca348364ba704f5414edd919a99c9be6e16ea7edae4766edc7892f25cb844d.
Pinned core seal source commit: 4726a22fbd23174a3e572cf1929e4e7ab372f99a.
Source: https://github.com/feder-cr/firefox_antidetect_patch/tree/4726a22fbd23174a3e572cf1929e4e7ab372f99a
The engine retains Mozilla's license.html and component notices; the source
tree's LICENSE directs readers to toolkit/content/license.html. Mozilla
trademark rights are not granted by the code licenses. This recipe ships the
unmodified upstream engine and preserves its complete archive contents.

The small challenge waiter was written for this service after reviewing Byparr
v3.0.4's locator-only checkbox approach (GPL-3.0):
https://github.com/ThePhaseless/Byparr/blob/v3.0.4/src/challenge.py
No Byparr server, solver module or playwright-captcha code is vendored. The
reviewed algorithm informs the widget dimensions/cooldown; attribution is kept
here and all MOA adaptations remain available under GPL-3.0-or-later.

Official package sources:
https://github.com/feder-cr/invisible_playwright
https://github.com/feder-cr/invisible_core
