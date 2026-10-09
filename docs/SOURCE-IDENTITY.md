# Source identity across numbered domain changes

Mangayomi scripts continue returning ordinary `link` and chapter `url` fields. No source-specific ID option or new extension API is required.

The host first looks for the original exact URL-derived ID. When it is absent, an indexed identity lookup can reuse an existing work ID within the same installed source, or an episode ID within the same work. Only an unambiguous match is reused. Existing progress, watchlists, subtitle associations and URLs embedded in client links keep their IDs.

For a source's own hostname family, a numeric suffix before a domain separator is normalized (for example `example12.test` and `example13.test`). The path, query and fragment remain significant. Different hostname families, ports, source installations, query values and fragments are isolated. Opaque extension identifiers are retained exactly. Titles and episode numbers alone are never used to merge content.

The additive identity mapping tables are backfilled at startup; old IDs and user data are not rewritten. Subsequent source responses update the network URL separately from the preserved ID. Ambiguous pre-existing duplicates are not deleted or automatically reconciled.

This does not infer arbitrary domain or path changes, different TLDs, source-repository migrations or unrelated host aliases. It cannot make a script follow a new domain if the script itself has no address resolver. It also does not combine duplicate rows that already have conflicting histories.

Upstream comparison: Mangayomi's models use independent database IDs. At commit `e479d28ac601594b6768ff343035ed6486babc17`, `lib/modules/manga/detail/providers/update_manga_detail_providers.dart` compares chapter URLs without their domains and updates matched chapter URLs while retaining their IDs; it additionally contains chapter-recognition fallbacks. MOA deliberately limits automatic matching to the source's own numbered-host family and does not copy title-based matching.

Validation: the source identity integration test reopens a pre-index database, changes the numbered host, and checks unchanged work/episode IDs, two profile positions and a watchlist, plus ambiguous and foreign-host cases. Existing source and APK tests remain applicable.

## Direct resume after a domain change

The host remembers numbered origins supplied by the installed extension metadata or its work responses, separately for each source and hostname family. It never probes or invents a numbered domain. A higher observed suffix can replace the origin of an old absolute work/episode URL when opening details or starting playback directly from home. Paths, query strings and fragments are retained, and relative or opaque identifiers are passed through unchanged. No new extension API or per-source configuration is required.

Playback does not fetch a catalogue or refresh details just to resume. It reads the current episode mapping within the source queue and uses the known origin. If extraction with the changed URL throws or returns no videos, the original URL is tried once; the database URL is updated only after a usable result. Saved progress and episode IDs do not change. An extension that already rebases its own URLs continues to work.

This is not independent domain discovery: until installed metadata or a source response provides a new address, the host passes the stored address through. Returning to a lower numbered domain is not inferred automatically. Existing extension resolvers still handle those cases. The normal detailed-page cache policy remains unchanged.

Additional regression coverage starts a real host playback session against a synthetic extension without first refreshing details, both after a metadata update and after another work exposes the new origin. It checks the original episode ID, watchlist and resume position; failed/empty extraction falls back with a bounded call count. These tests do not contact external sites.
