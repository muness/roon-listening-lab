#!/usr/bin/env npx tsx
/**
 * Listening Lab POC
 *
 * Minimal proof-of-concept validating the core loop:
 * 1. Connect to Roon
 * 2. Search for tracks
 * 3. Queue/play tracks
 * 4. Get LLM coaching via OpenAI Responses API
 *
 * SUCCESS CRITERIA:
 * - Can search for a track and see results
 * - Can play a track from search results
 * - Can ask the coach and get useful listening advice
 * - Can get mood-based track suggestions
 */

import 'dotenv/config';
import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import OpenAI from 'openai';

// Roon APIs (CommonJS)
import RoonApi from 'node-roon-api';
import RoonApiTransport from 'node-roon-api-transport';
import RoonApiBrowse from 'node-roon-api-browse';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const CHAIN_DESCRIPTION = process.env.CHAIN_DESCRIPTION ||
  'HQPlayer -> USB -> DAC -> Amp -> Speakers';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || process.env.LLM_API_KEY,
});

// -----------------------------------------------------------------------------
// Roon Connection
// -----------------------------------------------------------------------------

interface Zone {
  zone_id: string;
  display_name: string;
  state: string;
  now_playing?: {
    one_line: { line1: string };
    seek_position?: number;
    length?: number;
  };
}

interface BrowseItem {
  title: string;
  subtitle?: string;
  item_key?: string;
  hint?: string;
}

interface BrowseResult {
  action: string;
  list?: {
    title: string;
    count: number;
    level: number;
  };
  items?: BrowseItem[];
}

let transport: any = null;
let browse: any = null;
let zones: Map<string, Zone> = new Map();
let activeZoneId: string | null = null;

const roon = new RoonApi({
  extension_id: 'com.listeninglab.poc',
  display_name: 'Listening Lab POC',
  display_version: '0.1.0',
  publisher: 'Listening Lab',
  email: 'dev@example.com',
  log_level: 'none',
  core_paired: (core: any) => {
    console.log('\n✓ Connected to Roon Core');
    transport = core.services.RoonApiTransport;
    browse = core.services.RoonApiBrowse;

    transport.subscribe_zones((response: string, data: any) => {
      if (response === 'Subscribed' && data.zones) {
        data.zones.forEach((z: Zone) => zones.set(z.zone_id, z));
        showZones();
      } else if (response === 'Changed') {
        if (data.zones_changed) {
          data.zones_changed.forEach((z: Zone) => zones.set(z.zone_id, z));
        }
        if (data.zones_removed) {
          data.zones_removed.forEach((id: string) => zones.delete(id));
        }
      }
    });
  },
  core_unpaired: () => {
    console.log('\n✗ Disconnected from Roon Core');
    transport = null;
    browse = null;
    zones.clear();
  },
});

function showZones(): void {
  console.log('\nAvailable zones:');
  let i = 1;
  for (const [id, zone] of zones) {
    const playing = zone.now_playing ? ` [${zone.state}: ${zone.now_playing.one_line.line1}]` : '';
    console.log(`  ${i}. ${zone.display_name}${playing}`);
    i++;
  }
  if (!activeZoneId && zones.size > 0) {
    activeZoneId = zones.keys().next().value;
    console.log(`\nAuto-selected zone: ${zones.get(activeZoneId!)?.display_name}`);
  }
}

// -----------------------------------------------------------------------------
// Roon Browse/Play Functions
// -----------------------------------------------------------------------------

function browseAsync(opts: any): Promise<BrowseResult> {
  return new Promise((resolve, reject) => {
    browse.browse(opts, (err: Error | null, result: BrowseResult) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function loadAsync(opts: any): Promise<{ items: BrowseItem[] }> {
  return new Promise((resolve, reject) => {
    browse.load(opts, (err: Error | null, result: { items: BrowseItem[] }) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function searchTracks(query: string): Promise<BrowseItem[]> {
  if (!browse) throw new Error('Not connected to Roon');

  // Start search
  const searchResult = await browseAsync({
    hierarchy: 'search',
    input: query,
    pop_all: true,
  });

  // Load search categories (Artists, Albums, Tracks, etc.)
  if (!searchResult.list?.count) {
    console.log('No results found');
    return [];
  }

  const categories = await loadAsync({
    hierarchy: 'search',
    count: searchResult.list.count,
  });

  if (!categories.items?.length) {
    console.log('No results found');
    return [];
  }

  // Find "Tracks" category
  const tracksItem = categories.items.find(
    (item) => item.title === 'Tracks'
  );

  if (!tracksItem?.item_key) {
    // No tracks category - maybe results are already playable items
    return categories.items.filter((item) => item.hint === 'action' || item.item_key);
  }

  // Drill into Tracks
  const tracksResult = await browseAsync({
    hierarchy: 'search',
    item_key: tracksItem.item_key,
  });

  // Load track items
  if (tracksResult.list?.count) {
    const loaded = await loadAsync({
      hierarchy: 'search',
      count: Math.min(10, tracksResult.list.count),
    });
    return loaded.items || [];
  }

  return tracksResult.items || [];
}

async function playItem(itemKey: string): Promise<void> {
  if (!browse || !activeZoneId) throw new Error('Not connected or no zone selected');

  // Get the action menu for this item
  let result = await browseAsync({
    hierarchy: 'search',
    item_key: itemKey,
  });

  // Load action menu items
  let actions: BrowseItem[] = [];
  if (result.list?.count) {
    const loaded = await loadAsync({
      hierarchy: 'search',
      count: result.list.count,
    });
    actions = loaded.items || [];
  }

  // If we got an action_list item back (version disambiguation), drill into it
  if (actions.length === 1 && actions[0].hint === 'action_list' && actions[0].item_key) {
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
  }

  // Look for Play Now action
  const playAction = actions.find(
    (item) => item.title === 'Play Now' || item.title === 'Play'
  );

  if (playAction?.item_key) {
    await browseAsync({
      hierarchy: 'search',
      item_key: playAction.item_key,
      zone_or_output_id: activeZoneId,
    });
  } else {
    console.log('Play action not found. Available actions:', actions.map(a => a.title).join(', '));
  }
}

async function queueItem(itemKey: string): Promise<void> {
  if (!browse || !activeZoneId) throw new Error('Not connected or no zone selected');

  let result = await browseAsync({
    hierarchy: 'search',
    item_key: itemKey,
  });

  // Load action menu items
  let actions: BrowseItem[] = [];
  if (result.list?.count) {
    const loaded = await loadAsync({
      hierarchy: 'search',
      count: result.list.count,
    });
    actions = loaded.items || [];
  }

  // If we got an action_list item back (version disambiguation), drill into it
  if (actions.length === 1 && actions[0].hint === 'action_list' && actions[0].item_key) {
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
  }

  const queueAction = actions.find(
    (item) => item.title === 'Queue' || item.title === 'Add Next'
  );

  if (queueAction?.item_key) {
    await browseAsync({
      hierarchy: 'search',
      item_key: queueAction.item_key,
      zone_or_output_id: activeZoneId,
    });
    console.log('Queued');
  } else {
    console.log('Queue action not found. Available actions:', actions.map(a => a.title).join(', '));
  }
}

function controlPlayback(action: 'play' | 'pause' | 'stop' | 'next'): void {
  if (!transport || !activeZoneId) {
    console.log('Not connected or no zone selected');
    return;
  }
  transport.control(activeZoneId, action);
  console.log(action.charAt(0).toUpperCase() + action.slice(1));
}

// -----------------------------------------------------------------------------
// LLM Coach (OpenAI Responses API)
// -----------------------------------------------------------------------------

const COACH_INSTRUCTIONS = `You are an expert audio coach helping audiophiles develop critical listening skills.

You have deep knowledge of:
- Digital audio: filters, oversampling, noise shaping, DAC architectures
- Analog gear: amplifiers, speakers, headphones, cables
- Audiophile test tracks and what they reveal

Your role:
- Suggest tracks that reveal specific audio characteristics
- Provide timestamped listening notes when possible
- Help users develop vocabulary for what they hear
- Be specific about what frequencies, instruments, or moments to focus on

Keep responses concise and actionable.

IMPORTANT: When you suggest tracks, end your response with a JSON block containing ONLY the tracks:
\`\`\`json
{"tracks": [{"artist": "Artist Name", "track": "Track Title"}, ...]}
\`\`\`
This allows the user to play tracks directly. Always include this JSON when mentioning specific tracks.`;

async function askCoach(userMessage: string): Promise<string> {
  const contextMessage = `User's audio chain: ${CHAIN_DESCRIPTION}\n\nUser: ${userMessage}`;

  // OpenAI Responses API
  const response = await openai.responses.create({
    model: 'gpt-4o',
    instructions: COACH_INSTRUCTIONS,
    input: contextMessage,
  });

  return response.output_text;
}

async function getTrackSuggestions(mood: string): Promise<string> {
  const prompt = `Suggest 3-5 tracks for: "${mood}"

For each track:
1. Artist - Track Name
2. What to listen for (timestamps if you know them)
3. What audio characteristic this reveals

Be specific. Format as a numbered list.`;

  return askCoach(prompt);
}

// -----------------------------------------------------------------------------
// Interactive CLI
// -----------------------------------------------------------------------------

const HISTORY_FILE = path.join(os.homedir(), '.listening-lab-history');
const MAX_HISTORY = 500;

// Load history from file
function loadHistory(): string[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return fs.readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

// Save history to file
function saveHistory(history: string[]): void {
  try {
    fs.writeFileSync(HISTORY_FILE, history.slice(-MAX_HISTORY).join('\n') + '\n');
  } catch {
    // Ignore errors
  }
}

const history = loadHistory();

let lastResults: BrowseItem[] = [];
let lastSuggestions: string[] = [];

const COMMANDS = ['zones', 'zone', 'search', 'play', 'queue', 'pause', 'stop', 'next', 'now', 'ask', 'suggest', 'help', 'exit'];
const ALIASES: Record<string, string[]> = {
  s: ['search'], p: ['play'], q: ['queue'], a: ['ask']
};

function completer(line: string): [string[], string] {
  const words = line.split(' ');
  const cmd = words[0].toLowerCase();

  if (words.length === 1) {
    // Complete command names
    const hits = [...COMMANDS, ...Object.keys(ALIASES)].filter(c => c.startsWith(cmd));
    return [hits.length ? hits : COMMANDS, cmd];
  }

  // For play/queue, suggest available numbers
  if (['play', 'p', 'queue', 'q'].includes(cmd)) {
    const count = lastSuggestions.length || lastResults.length;
    if (count > 0) {
      const nums = Array.from({ length: count }, (_, i) => String(i + 1));
      const partial = words[words.length - 1];
      const hits = nums.filter(n => n.startsWith(partial));
      return [hits, partial];
    }
  }

  return [[], line];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  history,
  historySize: MAX_HISTORY,
  removeHistoryDuplicates: true,
  completer,
});

// Handle Ctrl-D (EOF)
rl.on('close', () => {
  console.log('\nGoodbye!');
  saveHistory((rl as any).history || []);
  process.exit(0);
});

// Handle Ctrl-C
rl.on('SIGINT', () => {
  console.log('\n(Ctrl-C pressed. Type "exit" to quit, or Ctrl-D)');
  rl.prompt();
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      // Save history after each command
      saveHistory((rl as any).history || []);
      resolve(answer);
    });
  });
}

/**
 * Parse LLM output for track suggestions from JSON block.
 */
function parseSuggestions(text: string): string[] {
  // Look for JSON block in response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return [];

  try {
    const data = JSON.parse(jsonMatch[1]);
    if (Array.isArray(data.tracks)) {
      return data.tracks
        .filter((t: any) => t.artist && t.track)
        .map((t: any) => `${t.artist} ${t.track}`);
    }
  } catch {
    // JSON parse failed
  }
  return [];
}

async function handleCommand(input: string): Promise<void> {
  const [cmd, ...args] = input.trim().split(' ');
  const arg = args.join(' ');

  switch (cmd.toLowerCase()) {
    case 'zones':
      showZones();
      break;

    case 'zone':
      if (arg) {
        const num = parseInt(arg, 10);
        const zoneIds = Array.from(zones.keys());
        if (num > 0 && num <= zoneIds.length) {
          activeZoneId = zoneIds[num - 1];
          console.log(`Selected: ${zones.get(activeZoneId!)?.display_name}`);
        }
      } else {
        console.log(`Current: ${zones.get(activeZoneId!)?.display_name || 'none'}`);
      }
      break;

    case 'search':
    case 's':
      if (!arg) {
        console.log('Usage: search <query>');
        break;
      }
      console.log(`Searching "${arg}"...`);
      lastResults = await searchTracks(arg);
      if (lastResults.length === 0) {
        console.log('No tracks found');
      } else {
        console.log('\nResults:');
        lastResults.forEach((item, i) => {
          console.log(`  ${i + 1}. ${item.title}${item.subtitle ? ` - ${item.subtitle}` : ''}`);
        });
      }
      break;

    case 'play':
    case 'p':
      if (arg) {
        const num = parseInt(arg, 10);
        if (lastResults.length && num > 0 && num <= lastResults.length) {
          // Play from search results
          const item = lastResults[num - 1];
          if (item.item_key) {
            console.log(`Playing: ${item.title}`);
            await playItem(item.item_key);
          }
        } else if (lastSuggestions.length && num > 0 && num <= lastSuggestions.length) {
          // Play from LLM suggestions - search and play first result
          const suggestion = lastSuggestions[num - 1];
          console.log(`Searching for: ${suggestion}...`);
          const results = await searchTracks(suggestion);
          if (results.length && results[0].item_key) {
            console.log(`Playing: ${results[0].title}${results[0].subtitle ? ` - ${results[0].subtitle}` : ''}`);
            await playItem(results[0].item_key);
          } else {
            console.log('Track not found in library');
          }
        } else {
          console.log('Invalid number. Use search or suggest first.');
        }
      } else {
        controlPlayback('play');
      }
      break;

    case 'queue':
    case 'q':
      if (arg) {
        // Support multiple numbers: q 2 3 4 5 or q 2,3,4,5
        const nums = arg.split(/[\s,]+/).map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        for (const num of nums) {
          if (lastResults.length && num > 0 && num <= lastResults.length) {
            // Queue from search results
            const item = lastResults[num - 1];
            if (item.item_key) {
              console.log(`Queueing: ${item.title}`);
              await queueItem(item.item_key);
            }
          } else if (lastSuggestions.length && num > 0 && num <= lastSuggestions.length) {
            // Queue from LLM suggestions - search and queue first result
            const suggestion = lastSuggestions[num - 1];
            console.log(`Searching for: ${suggestion}...`);
            const results = await searchTracks(suggestion);
            if (results.length && results[0].item_key) {
              console.log(`Queueing: ${results[0].title}${results[0].subtitle ? ` - ${results[0].subtitle}` : ''}`);
              await queueItem(results[0].item_key);
            } else {
              console.log(`Track not found: ${suggestion}`);
            }
          } else {
            console.log(`Invalid number: ${num}`);
          }
        }
      } else {
        console.log('Usage: queue <n> [n2 n3 ...] or queue 2,3,4,5');
      }
      break;

    case 'pause':
      controlPlayback('pause');
      break;

    case 'stop':
      controlPlayback('stop');
      break;

    case 'next':
      controlPlayback('next');
      break;

    case 'ask':
    case 'a':
      if (!arg) {
        console.log('Usage: ask <question>');
        break;
      }
      console.log('\nThinking...\n');
      try {
        const answer = await askCoach(arg);
        // Strip JSON block from display
        const display = answer.replace(/```json[\s\S]*?```/g, '').trim();
        console.log(display);
        // Parse any track suggestions from the response
        const parsed = parseSuggestions(answer);
        if (parsed.length > 0) {
          lastSuggestions = parsed;
          lastResults = [];
          console.log(`\n(${parsed.length} tracks ready - use "play <n>" to play)`);
        }
      } catch (err) {
        console.error('Coach error:', (err as Error).message);
      }
      break;

    case 'suggest':
    case 'mood':
      if (!arg) {
        console.log('Usage: suggest <mood or purpose>');
        console.log('Examples:');
        console.log('  suggest sad set');
        console.log('  suggest show off bass');
        console.log('  suggest test imaging');
        console.log('  suggest chain weaknesses');
        break;
      }
      console.log(`\nGetting suggestions for "${arg}"...\n`);
      try {
        const suggestions = await getTrackSuggestions(arg);
        // Strip JSON block from display
        const display = suggestions.replace(/```json[\s\S]*?```/g, '').trim();
        console.log(display);
        // Parse and store suggestions for play command
        lastSuggestions = parseSuggestions(suggestions);
        lastResults = []; // Clear search results so play uses suggestions
        if (lastSuggestions.length > 0) {
          console.log(`\n(${lastSuggestions.length} tracks ready - use "play <n>" to play)`);
        }
      } catch (err) {
        console.error('Coach error:', (err as Error).message);
      }
      break;

    case 'now':
      if (activeZoneId) {
        const zone = zones.get(activeZoneId);
        if (zone?.now_playing) {
          console.log(`Now playing: ${zone.now_playing.one_line.line1}`);
          console.log(`State: ${zone.state}`);
        } else {
          console.log('Nothing playing');
        }
      }
      break;

    case 'help':
    case '?':
      console.log(`
Commands:
  zones              List available zones
  zone [n]           Select zone / show current
  search <query>     Search for tracks (alias: s)
  play [n]           Play from search/suggestions, or resume (alias: p)
  queue <n>          Queue from search/suggestions
  pause              Pause playback
  stop               Stop playback
  next               Next track
  now                Show now playing

  ask <question>     Ask the audio coach (alias: a)
  suggest <mood>     Get track suggestions (playable with play <n>)

  help               Show this help
  exit               Quit
`);
      break;

    case 'exit':
    case 'quit':
      console.log('Goodbye!');
      rl.close();
      process.exit(0);

    default:
      if (input.trim()) {
        console.log('Unknown command. Type "help" for commands.');
      }
  }
}

async function main(): Promise<void> {
  console.log('Listening Lab POC');
  console.log('==================');
  console.log('Connecting to Roon...\n');

  roon.init_services({
    required_services: [RoonApiTransport, RoonApiBrowse],
  });
  roon.start_discovery();

  // Give Roon time to connect
  await new Promise((resolve) => setTimeout(resolve, 3000));

  if (!transport) {
    console.log('Waiting for Roon connection... (approve in Roon Settings > Extensions)');
  }

  console.log('Type "help" for commands\n');

  while (true) {
    try {
      const input = await prompt('> ');
      await handleCommand(input);
    } catch (err) {
      console.error('Error:', (err as Error).message);
    }
    console.log('');
  }
}

main().catch(console.error);
