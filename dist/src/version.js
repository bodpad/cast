import { createRequire } from 'node:module';
/** From package.json, which ships with the plugin (dist/src → ../../package.json). */
export const VERSION = createRequire(import.meta.url)('../../package.json').version;
