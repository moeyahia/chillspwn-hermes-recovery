import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const webappRoot = resolve(import.meta.dir, "../../..");
const repositoryRoot = resolve(webappRoot, "../../..");
const manifestPath = resolve(webappRoot, "server/mcp/v2-trusted-tools.json");
const installerPath = resolve(webappRoot, "scripts/command-os-v2/manage-trusted-tool-shims.sh");
const previewUnitPath = resolve(repositoryRoot, "deployment/systemd/chillspwn-command-os-v2-preview.service");
const legacyUnitPath = resolve(repositoryRoot, "deployment/systemd/chillspwn.service");

describe("V2 trusted recon-tool provisioning contract", () => {
  test("pins only Nmap and the no-update httpx wrapper to one V2-only root-controlled directory", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      schemaVersion: number;
      pathBoundary: string;
      binPath: string;
      provenancePath: string;
      tools: Record<string, { sourcePath: string; sourceSha256: string; wrapperAsset?: string; executablePath: string; sha256: string; version: string; enforcedOptions?: string[] }>;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.pathBoundary).toBe("/usr/local/libexec/chillspwn-command-os-v2");
    expect(manifest.binPath).toBe("/usr/local/libexec/chillspwn-command-os-v2/bin");
    expect(manifest.provenancePath).toBe("/usr/local/libexec/chillspwn-command-os-v2/provenance.json");
    expect(manifest.tools.nmap).toMatchObject({
      sourcePath: "/usr/lib/nmap/nmap",
      executablePath: `${manifest.binPath}/nmap`,
      sha256: "5b42c994b6f5804be11726deae943defc868dbe91d8362b3a2686b7d5160667f",
      version: "7.99",
    });
    expect(manifest.tools["httpx-toolkit"]).toMatchObject({
      sourcePath: "/usr/bin/httpx-toolkit",
      sourceSha256: "685b5c3acd46c92be272fa648e97b91b81454acaeded3058fd47ef6c1f0194da",
      wrapperAsset: "server/mcp/trusted-shims/httpx-toolkit",
      executablePath: `${manifest.binPath}/httpx-toolkit`,
      sha256: "262c537bb8af3a5702b4d1d15cb332812dff10508a767942b93dfbdcb85f2dbf",
      version: "1.9.0",
      enforcedOptions: ["-duc"],
    });
    expect(Object.keys(manifest.tools).sort()).toEqual(["httpx-toolkit", "nmap"]);
  });

  test("keeps the private directory out of every global service PATH and scopes it in the executor", () => {
    const previewUnit = readFileSync(previewUnitPath, "utf8");
    const legacyUnit = readFileSync(legacyUnitPath, "utf8");
    const installer = readFileSync(installerPath, "utf8");
    expect(previewUnit).not.toContain("Environment=PATH=/usr/local/libexec/chillspwn-command-os-v2/bin:");
    expect(legacyUnit).not.toContain("/usr/local/libexec/chillspwn-command-os-v2/bin");
    expect(installer).toContain("mv -fT -- \"$temp\" \"$PROVENANCE_PATH\"");
    expect(installer).toContain("install requires root");
    expect(installer).toContain('verify_root_chain "$(dirname -- "$PATH_BOUNDARY")"');
    expect(installer).toContain('verify_root_chain "$BIN_PATH"');
    expect(installer).not.toMatch(/systemctl\s+(?:start|stop|restart|reload)/u);
    expect(installer).not.toMatch(/(?:chmod|chown|rm|mv|setcap)[^\n]*(?:\/usr\/bin\/nmap|\/usr\/lib\/nmap\/nmap|\/root\/go\/bin\/subfinder)/u);
    expect(installer).toContain('set(manifest.get("tools", {})) != {"httpx-toolkit", "nmap"}');
    expect(installer).toContain('verify_source "$HTTPX_SOURCE" "$HTTPX_SOURCE_SHA256" "httpx"');
    expect(installer).toContain('verify_source "$HTTPX_WRAPPER_ASSET" "$HTTPX_SHA256" "httpx wrapper asset"');
    expect(installer).toContain('mv -fT -- "$TEMP_HTTPX" "$HTTPX_DESTINATION"');
    expect(installer).not.toMatch(/(?:chmod|chown|rm|mv|setcap)[^\n]*\/usr\/bin\/httpx-toolkit/u);
  });
});
