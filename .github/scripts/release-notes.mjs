// Prints the CHANGELOG.md section of one version as GitHub release notes.
// Usage: node .github/scripts/release-notes.mjs 0.7.0
import { readFileSync } from "node:fs";

const version = process.argv[2];
const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
const start = lines.findIndex((line) => line.startsWith(`## ${version} `) || line === `## ${version}`);
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end < 0) end = lines.length;
const notes = lines.slice(start + 1, end).join("\n").trim();
console.log(`${notes}\n\nUpdate: \`/plugin marketplace update cosmotools\`, \`/plugin update cast@cosmotools\`, \`/reload-plugins\`.`);
