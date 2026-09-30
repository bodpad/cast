import type { WindowLook } from './chrome.js';
import type { Profile } from './registry.js';

/** Compact block for the SessionStart hook; a hint on how to add people when there are none. */
export function briefList(profiles: Profile[]): string {
  if (!profiles.length) return 'cast: no browser users yet. When a task needs a logged-in browser, ask the user to add each person with /cast:add <name>.';
  const lines = profiles.map(p => {
    if (!p.ready) {
      const desc = p.description ? ` — ${p.description}.` : '';
      return `- ${p.name} (project)${desc} NOT set up on this machine: ask the user to run /cast:add ${p.name}`;
    }
    let line = `- ${p.name} (${p.scope})`;
    if (p.email) line += ` ${p.email}`;
    line += p.description ? ` — ${p.description}.` : ' — role unknown (no description).';
    if (p.sites.length) line += ` Sites: ${p.sites.join(', ')}`;
    return line;
  });
  return ['cast: browser users available (open with cast_open / browser_* tools with profile=<name>):', ...lines].join('\n');
}

/** "Sam (vendor, Acme org) · log in · cast": the window title people see in the title bar and taskbar. */
export function windowLook(p: Profile, what?: string): WindowLook {
  const d = p.description && p.description.length > 40 ? `${p.description.slice(0, 39)}…` : p.description;
  return { title: [d ? `${p.name} (${d})` : p.name, what, 'cast'].filter(Boolean).join(' · '), color: p.color };
}
