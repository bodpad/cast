#!/usr/bin/env node
import { briefList } from './format.js';
import { finishClosedLogins } from './logins.js';
import { resolvePaths } from './paths.js';
import { loadProfiles } from './registry.js';

async function main(argv: string[]): Promise<number> {
  const [command, ...flags] = argv;
  if (command !== 'list') {
    console.error('usage: cast list [--brief]');
    return 2;
  }
  let profiles;
  try {
    const paths = resolvePaths();
    // A user window closed after its Claude session ended: save its sites now.
    await finishClosedLogins(paths);
    profiles = loadProfiles(paths);
  } catch (e) {
    // Runs in the SessionStart hook: tell Claude, but never fail the session.
    console.log(`cast: cannot read browser profiles: ${(e as Error).message}`);
    return 0;
  }
  if (flags.includes('--brief')) {
    const text = briefList(profiles);
    if (text) console.log(text);
  } else {
    console.log(JSON.stringify(profiles, null, 2));
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
