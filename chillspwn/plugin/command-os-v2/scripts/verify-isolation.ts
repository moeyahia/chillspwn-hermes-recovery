import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sourceRoot = resolve(root, "src");
const forbidden = [
  /from\s+["'][^"']*webapp\/src\//,
  /from\s+["'][^"']*pages\/(ChatPage|AgentCockpitPage|MissionBoardPage)/,
  /from\s+["'][^"']*LegacyDesktop/,
  /chillspwn-(sessions|windows|active-session)/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const violations: string[] = [];
for (const path of files(sourceRoot).filter((entry) => /\.(?:ts|tsx|css)$/.test(entry))) {
  const text = readFileSync(path, "utf8");
  for (const pattern of forbidden) if (pattern.test(text)) violations.push(`${path.slice(root.length + 1)} matches ${pattern}`);
}
if (violations.length) throw new Error(`Command OS V2 isolation check failed:\n${violations.join("\n")}`);
console.log("Command OS V2 source isolation verified");
