import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

function isWithin(root: string, candidate: string): boolean {
  const result = relative(root, candidate);
  return result === "" || (!result.startsWith(`..${sep}`) && result !== ".." && !isAbsolute(result));
}

function assertNoSymlinkPath(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (!isWithin(root, target)) throw new Error("Vault path escapes its configured root");
  let current = root;
  for (const segment of pathFromRoot.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("Symbolic links are not permitted in managed vault paths");
    }
  }
}

/** Restricts every vault access to one explicitly configured filesystem root. */
export class VaultPathPolicy {
  readonly allowedRoot: string;

  constructor(allowedRoot: string) {
    if (!isAbsolute(allowedRoot)) throw new TypeError("Vault sandbox root must be absolute");
    mkdirSync(allowedRoot, { recursive: true, mode: 0o700 });
    this.allowedRoot = realpathSync(allowedRoot);
  }

  resolveVault(vaultPath: string): string {
    if (!vaultPath.trim() || vaultPath.includes("\0")) throw new TypeError("Vault path is invalid");
    const candidate = resolve(this.allowedRoot, vaultPath);
    if (!isWithin(this.allowedRoot, candidate)) throw new Error("Vault path escapes its configured root");
    assertNoSymlinkPath(this.allowedRoot, candidate);
    mkdirSync(candidate, { recursive: true, mode: 0o700 });
    assertNoSymlinkPath(this.allowedRoot, candidate);
    return realpathSync(candidate);
  }

  resolveRelative(vaultRoot: string, relativePath: string, createParent = false): string {
    if (!relativePath.trim() || relativePath.includes("\0") || isAbsolute(relativePath)) {
      throw new TypeError("Vault note path must be a non-empty relative path");
    }
    const verifiedVault = realpathSync(vaultRoot);
    if (!isWithin(this.allowedRoot, verifiedVault)) throw new Error("Vault is outside its configured root");
    const target = resolve(verifiedVault, relativePath);
    if (!isWithin(verifiedVault, target)) throw new Error("Vault note path traversal is not permitted");
    assertNoSymlinkPath(verifiedVault, target);
    if (createParent) {
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      assertNoSymlinkPath(verifiedVault, dirname(target));
    }
    return target;
  }

  atomicWrite(vaultRoot: string, relativePath: string, content: string): string {
    return this.atomicWriteBytes(vaultRoot, relativePath, Buffer.from(content, "utf8"));
  }

  atomicWriteBytes(vaultRoot: string, relativePath: string, content: Uint8Array): string {
    const destination = this.resolveRelative(vaultRoot, relativePath, true);
    const temporary = `${destination}.tmp-${randomUUID()}`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, "wx", 0o600);
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, destination);
      chmodSync(destination, 0o600);
      return destination;
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }
}

export function safeVaultSegment(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 96)
    .toLowerCase();
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
}
