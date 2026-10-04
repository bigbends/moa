/** Offline assertions over an authored synthetic catalog. */
import assert from 'node:assert/strict';
import fixture from '../test/fixtures/search-grouping.json' with { type: 'json' };
import { fixtureCatalog } from '../test/fixtures/catalog.js';

const { db, sources, groups } = fixtureCatalog(fixture);
try {
  for (const search of fixture.searches) {
    const ids = search.groups.flatMap(group => group.ids);
    const cards = groups.resolve(ids, 'fixture', search.query);
    assert.equal(cards.length, search.expectedGroups, search.query);
    console.log(JSON.stringify({ query: search.query, records: ids.length, groups: cards.length }));
  }
} finally { await sources.close(); db.close(); }
