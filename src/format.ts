import type { Profile } from './registry.js';

/** Compact block for the SessionStart hook; empty when there are no profiles. */
export function briefList(profiles: Profile[]): string {
  if (!profiles.length) return '';
  const lines = profiles.map(p => {
    if (!p.ready) {
      const desc = p.description ? ` — ${p.description}.` : '';
      return `- ${p.name} (project)${desc} NOT set up on this machine: ask the user to run /cast:add ${p.name}`;
    }
    let line = `- ${p.name} (${p.scope})`;
    if (p.email) line += ` ${p.email}`;
    if (p.description) line += ` — ${p.description}.`;
    if (p.sites.length) line += ` Sites: ${p.sites.join(', ')}`;
    return line;
  });
  return ['cast: browser users available (open with cast_open / browser_* tools with profile=<name>):', ...lines].join('\n');
}
