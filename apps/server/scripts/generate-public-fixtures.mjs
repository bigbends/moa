// Authored synthetic catalogs, independent of provider responses or user databases.
import { writeFile } from 'node:fs/promises';

const sources = [
  { id: 'sample-kr', name: 'Sample KR', lang: 'ko' },
  { id: 'example-a', name: 'Example Source A', lang: 'ko' },
  { id: 'example-b', name: 'Example Source B', lang: 'en' },
].map(source => ({ ...source, enabled: 1, type: 'anime', live: 0, installed: 1 }));
const media = [];
const titles = [
  { kind: 'tv', id: 9001, title: '구름 정원', originalTitle: 'Cloud Garden' },
  { kind: 'tv', id: 9002, title: '하늘 탐험대', originalTitle: 'Sky Explorers' },
  { kind: 'tv', id: 9003, title: '달빛 수호대', originalTitle: 'Moonlight Guards' },
  { kind: 'tv', id: 9004, title: '별나라 탐험', originalTitle: 'Planet Adventure' },
  { kind: 'tv', id: 9005, title: '로봇 8', originalTitle: 'Robot 8' },
  { kind: 'movie', id: 9006, title: '극장판 달빛 수호대: 별빛성편' },
];
function add(id, title, source = 'sample-kr', tmdbId, season, count, type = 'anime') {
  const provider = sources.find(sourceEntry => sourceEntry.id === source);
  media.push({ id, title, type, provider: { id: source, name: provider.name, kind: 'mangayomi-js', lang: provider.lang },
    live: false, episodeCounts: count ? { [season || 1]: count } : {},
    ...(tmdbId ? { link: { kind: type === 'movie' ? 'movie' : 'tv', id: tmdbId, season: season ?? null, status: 'auto' } } : {}) });
}
add('garden-1', '구름 정원', 'sample-kr', 9001, 1, 7);
add('garden-1-en', 'Cloud Garden', 'example-b', 9001, 1, 7, 'series');
add('garden-2', '구름 정원 2기', 'sample-kr', 9001, 2, 9);
add('garden-2-en', 'Cloud Garden Season 2', 'example-b', 9001, 2, 9, 'series');
add('garden-2-duplicate', '구름 정원 시즌 2', 'sample-kr', 9001, 2, 9);
add('garden-2-dub', '구름 정원 2기 더빙판', 'example-a', 9001, 2, 9);
add('garden-2-sub', '구름 정원 2기 (자막)', 'example-b', 9001, 2, 9);
add('garden-ova', '구름 정원 OVA', 'example-a', 9001, 1, 1);
add('garden-unlinked', '구름 정원 2기', 'example-a');
add('sky-1', '하늘 탐험대 1기', 'sample-kr', 9002, 1, 4);
add('sky-2', '하늘 탐험대 2기', 'example-a', 9002, 2, 5);
add('sky-3', '하늘 탐험대 3기', 'example-a', 9002, 3, 8);
add('sky-3-p1', '하늘 탐험대 3기 파트 1', 'sample-kr', 9002, 3, 4);
add('sky-3-p2', '하늘 탐험대 3기 파트 2', 'example-b', 9002, 3, 4);
add('sky-final', '하늘 탐험대 파이널 시즌', 'sample-kr', 9002, 4, 6);
add('sky-final-p2', '하늘 탐험대 4기 The Final Season Part 2', 'example-b', 9002, 4, 3);
add('sky-final-p3', '하늘 탐험대 파이널 시즌 파트 3', 'example-a');
add('sky-oad', '하늘 탐험대 OAD1', 'example-a', 9002, 1, 1);
add('sky-special', '하늘 탐험대 특별편', 'example-a', 9002, 1, 1);
add('guard-1', '달빛 수호대', 'sample-kr', 9003, 1, 5);
add('guard-2', '달빛 수호대: 구름열차 편', 'example-a', 9003, 2, 6);
add('guard-3', '달빛 수호대: 정원 마을 편', 'example-b', 9003, 3, 7);
add('guard-movie', '극장판 달빛 수호대: 별빛성편', 'example-a', 9006, 1, 1, 'movie');
add('planet-1', '별나라 탐험', 'sample-kr', 9004, 1, 5);
add('planet-2', '별나라 탐험 2기 파트 1', 'example-a', 9004, 2, 6);
add('planet-3', '별나라 탐험 3기', 'example-b', 9004, 3, 7);
add('robot-1', '로봇 8', 'sample-kr', 9005, 1, 5);
add('robot-2', '로봇 8 2', 'example-a', 9005, null, 6);
const cases = [
  { query: '구름 정원', ids: media.filter(m => m.id.startsWith('garden')).map(m => m.id), expectedGroups: 5 },
  { query: '하늘 탐험대', ids: media.filter(m => m.id.startsWith('sky')).map(m => m.id), expectedGroups: 10 },
  { query: '달빛 수호대', ids: media.filter(m => m.id.startsWith('guard')).map(m => m.id), expectedGroups: 4 },
  { query: '별나라 탐험', ids: media.filter(m => m.id.startsWith('planet')).map(m => m.id), expectedGroups: 3 },
  { query: '로봇 8', ids: media.filter(m => m.id.startsWith('robot')).map(m => m.id), expectedGroups: 2 },
];
const provenance = 'Authored fictional catalog for offline tests; no recorded responses or database extracts.';
const common = { provenance, sources, media, titles };
const grouping = { ...common, searches: cases.map(({ ids, ...search }) => ({ ...search,
  groups: sources.map(source => ({ provider: source.name, ids: ids.filter(id => media.find(m => m.id === id).provider.id === source.id) })) })) };
const franchise = { ...common, searches: cases.map(search => ({ ...search,
  currentId: { '구름 정원': 'garden-1', '하늘 탐험대': 'sky-1', '달빛 수호대': 'guard-1', '별나라 탐험': 'planet-1', '로봇 8': 'robot-1' }[search.query],
  expectedSeasons: { '구름 정원': ['s1', 's2'], '하늘 탐험대': ['s1', 's2', 's3', 's4', 's4p2', 's4p3'],
    '달빛 수호대': ['s1', 's2', 's3'], '별나라 탐험': ['s1', 's2p1', 's3'], '로봇 8': ['s1', 's2'] }[search.query] })) };
for (const [name, fixture] of [['search-grouping', grouping], ['franchise-seasons', franchise]]) {
  await writeFile(new URL(`../test/fixtures/${name}.json`, import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
}
