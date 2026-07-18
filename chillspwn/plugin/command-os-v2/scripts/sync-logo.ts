import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

const EXPECTED = "0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955";
const source = resolve(import.meta.dir, "../../webapp/public/Logo.svg");
const destination = resolve(import.meta.dir, "../public/Logo.svg");
const verifyOnly = process.argv.includes("--verify-only");

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (!existsSync(source)) throw new Error(`Canonical legacy logo is missing: ${source}`);
if (digest(source) !== EXPECTED) throw new Error("Canonical legacy Logo.svg hash changed; refusing to build V2");

if (!verifyOnly) {
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

if (!existsSync(destination)) throw new Error("V2 Logo.svg is missing; run bun run logo:sync");
if (digest(destination) !== EXPECTED) throw new Error("V2 Logo.svg does not match the canonical legacy asset");
console.log(`Logo.svg verified: ${EXPECTED}`);
