#!/usr/bin/env npx tsx
/**
 * Direct test of search and play - no interactive TTY
 * Run: npx tsx src/test-play.ts "Radiohead Idioteque"
 */

import 'dotenv/config';
import RoonApi from 'node-roon-api';
import RoonApiTransport from 'node-roon-api-transport';
import RoonApiBrowse from 'node-roon-api-browse';

const query = process.argv[2] || 'Radiohead Idioteque';

interface BrowseItem {
  title: string;
  subtitle?: string;
  item_key?: string;
  hint?: string;
}

interface BrowseResult {
  action: string;
  list?: { title: string; count: number; level: number };
}

let transport: any = null;
let browse: any = null;
let activeZoneId: string | null = null;

const roon = new RoonApi({
  extension_id: 'com.listeninglab.poc',
  display_name: 'Listening Lab POC',
  display_version: '0.1.0',
  publisher: 'Listening Lab',
  email: 'dev@example.com',
  core_paired: async (core: any) => {
    console.log('✓ Connected to Roon Core');
    transport = core.services.RoonApiTransport;
    browse = core.services.RoonApiBrowse;

    transport.subscribe_zones((response: string, data: any) => {
      if (response === 'Subscribed' && data.zones?.length) {
        activeZoneId = data.zones[0].zone_id;
        console.log(`✓ Zone: ${data.zones[0].display_name}\n`);
        runTest();
      }
    });
  },
  core_unpaired: () => {
    console.log('✗ Disconnected');
    process.exit(1);
  },
});

function browseAsync(opts: any): Promise<BrowseResult> {
  return new Promise((resolve, reject) => {
    console.log('-> browse', JSON.stringify(opts));
    browse.browse(opts, (err: Error | null, result: BrowseResult) => {
      console.log('<- browse', JSON.stringify(result));
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function loadAsync(opts: any): Promise<{ items: BrowseItem[] }> {
  return new Promise((resolve, reject) => {
    console.log('-> load', JSON.stringify(opts));
    browse.load(opts, (err: Error | null, result: { items: BrowseItem[] }) => {
      console.log('<- load', result.items?.length, 'items');
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function searchTracks(q: string): Promise<BrowseItem[]> {
  const searchResult = await browseAsync({
    hierarchy: 'search',
    input: q,
    pop_all: true,
  });

  if (!searchResult.list?.count) {
    console.log('No results');
    return [];
  }

  const categories = await loadAsync({
    hierarchy: 'search',
    count: searchResult.list.count,
  });

  if (!categories.items?.length) {
    console.log('No categories');
    return [];
  }

  console.log('Categories:', categories.items.map(i => i.title).join(', '));

  const tracksItem = categories.items.find((item) => item.title === 'Tracks');
  if (!tracksItem?.item_key) {
    console.log('No Tracks category');
    return categories.items.filter((item) => item.hint === 'action' || item.item_key);
  }

  const tracksResult = await browseAsync({
    hierarchy: 'search',
    item_key: tracksItem.item_key,
  });

  if (tracksResult.list?.count) {
    const loaded = await loadAsync({
      hierarchy: 'search',
      count: Math.min(10, tracksResult.list.count),
    });
    return loaded.items || [];
  }

  return [];
}

async function playItem(itemKey: string): Promise<void> {
  let result = await browseAsync({
    hierarchy: 'search',
    item_key: itemKey,
  });

  let actions: BrowseItem[] = [];
  if (result.list?.count) {
    const loaded = await loadAsync({
      hierarchy: 'search',
      count: result.list.count,
    });
    actions = loaded.items || [];
  }

  console.log('Actions:', actions.map(a => `${a.title} (${a.hint})`).join(', '));

  // Version disambiguation
  if (actions.length === 1 && actions[0].hint === 'action_list' && actions[0].item_key) {
    console.log('Drilling through disambiguation...');
    result = await browseAsync({
      hierarchy: 'search',
      item_key: actions[0].item_key,
    });
    if (result.list?.count) {
      const loaded = await loadAsync({
        hierarchy: 'search',
        count: result.list.count,
      });
      actions = loaded.items || [];
    }
    console.log('Actions after drill:', actions.map(a => `${a.title} (${a.hint})`).join(', '));
  }

  const playAction = actions.find((item) => item.title === 'Play Now' || item.title === 'Play');

  if (playAction?.item_key) {
    console.log(`\n▶ Executing Play Now...`);
    await browseAsync({
      hierarchy: 'search',
      item_key: playAction.item_key,
      zone_or_output_id: activeZoneId,
    });
    console.log('✓ Play command sent');
  } else {
    console.log('✗ No Play action found');
  }
}

async function runTest() {
  try {
    console.log(`Searching: "${query}"\n`);
    const tracks = await searchTracks(query);

    if (tracks.length === 0) {
      console.log('\n✗ No tracks found');
      process.exit(1);
    }

    console.log(`\nFound ${tracks.length} tracks:`);
    tracks.slice(0, 5).forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.title} - ${t.subtitle}`);
    });

    console.log(`\nPlaying first track: ${tracks[0].title}\n`);
    await playItem(tracks[0].item_key!);

    console.log('\n✓ Test complete');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

console.log('Connecting to Roon...\n');
roon.init_services({ required_services: [RoonApiTransport, RoonApiBrowse] });
roon.start_discovery();

setTimeout(() => {
  if (!transport) {
    console.log('✗ Timeout waiting for Roon');
    process.exit(1);
  }
}, 10000);
