# Source and binary provenance

MOA's optional gate, relay, JSONL worker and lifecycle code are GPL-3.0-or-later
(repository LICENSE). Existing browser proxy/address/policy modules are imported
unchanged from services/aniyomi-worker/browser; see its NOTICE.md.

Camoufox Python 0.4.11 (MIT), Playwright 1.58.0 (Apache-2.0).
Camoufox browser 152.0.4-beta.30, Linux amd64 (Firefox-derived, MPL-2.0).
Archive SHA256: 5720d45b894ce1770543de024c6f10d514b38be560fa2dc3226b3d8586caf672.
Upstream source and release:
https://github.com/daijro/camoufox/tree/v152.0.4-beta.30
https://github.com/daijro/camoufox/releases/tag/v152.0.4-beta.30
The complete upstream archive, license.html and component notices are retained.
Installed Python wheels retain license and dist-info metadata. Socks 2.8.10
is MIT and node_modules retains dependency notices. Mozilla trademarks are not
licensed by the code licenses.

The small challenge waiter was written for this service after reviewing Byparr
v3.0.4's locator-only checkbox approach (GPL-3.0):
https://github.com/ThePhaseless/Byparr/blob/v3.0.4/src/challenge.py
No Byparr server, solver module or playwright-captcha code is vendored. The
reviewed algorithm informs the widget dimensions/cooldown; attribution is kept
here and all MOA adaptations remain available under GPL-3.0-or-later.
