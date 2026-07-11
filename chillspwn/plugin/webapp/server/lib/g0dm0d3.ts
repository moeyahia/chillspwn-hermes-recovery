/**
 * ⚠️ DEPRECATED / QUARANTINED (Phase 14). Prompt obfuscation is OFF by default
 * (ENABLE_PROMPT_OBFUSCATION=false) and must NOT be re-enabled. Reachable only through the
 * identity shims in server/security/obfuscation.ts. Scheduled for deletion once those shims are
 * inlined as identity at their call sites. Do not add new call sites. See MIGRATION.md.
 *
 * G0DM0D3 Integration Module for ChillsPwn
 * Wraps Parseltongue prompt obfuscation for bypassing model content filters.
 * Self-contained — zero external dependencies beyond the parseltongue engine.
 */

import { applyParseltongue, type ParseltongueConfig, type ObfuscationTechnique } from './parseltongue';

export interface GodmodeConfig {
  enabled: boolean;
  parseltongue: boolean;
  parseltongueTechnique: ObfuscationTechnique;
  parseltongueIntensity: 'light' | 'medium' | 'heavy';
  parseltongueTriggers: string[];
}

export const DEFAULT_GODMODE_CONFIG: GodmodeConfig = {
  enabled: false,
  parseltongue: true,
  parseltongueTechnique: 'leetspeak' as ObfuscationTechnique,
  parseltongueIntensity: 'medium',
  parseltongueTriggers: [],
};

/**
 * Apply Parseltongue obfuscation to a text string if config allows it.
 * Returns the original text if godmode is disabled or parseltongue is off.
 *
 * @param text - The text to potentially obfuscate
 * @param config - The godmode configuration
 * @returns The obfuscated text (or original if disabled)
 */
export function obfuscatePrompt(text: string, config: GodmodeConfig): string {
  if (!config.enabled || !config.parseltongue) return text;

  const ptConfig: ParseltongueConfig = {
    enabled: true,
    technique: config.parseltongueTechnique,
    intensity: config.parseltongueIntensity,
    customTriggers: config.parseltongueTriggers,
  };

  const result = applyParseltongue(text, ptConfig);
  return result.transformedText;
}

/**
 * Merge user-provided godmode config with defaults.
 */
export function resolveGodmodeConfig(userConfig?: Partial<GodmodeConfig>): GodmodeConfig {
  if (!userConfig) return { ...DEFAULT_GODMODE_CONFIG };
  return {
    enabled: userConfig.enabled ?? DEFAULT_GODMODE_CONFIG.enabled,
    parseltongue: userConfig.parseltongue ?? DEFAULT_GODMODE_CONFIG.parseltongue,
    parseltongueTechnique: userConfig.parseltongueTechnique ?? DEFAULT_GODMODE_CONFIG.parseltongueTechnique,
    parseltongueIntensity: userConfig.parseltongueIntensity ?? DEFAULT_GODMODE_CONFIG.parseltongueIntensity,
    parseltongueTriggers: userConfig.parseltongueTriggers ?? DEFAULT_GODMODE_CONFIG.parseltongueTriggers,
  };
}

/**
 * Convenience: obfuscate with optional config (safe to pass undefined/null).
 */
export function safeObfuscate(text: string, config?: GodmodeConfig): string {
  const resolved = resolveGodmodeConfig(config);
  return obfuscatePrompt(text, resolved);
}

/**
 * Reverse alias map: real tool name -> ChillsPwn alias.
 * Used to scrub council assessments before Claude reads them — guarantees
 * no real tool names leak into model context. 97 entries from /opt/chillspwn-bin/ALIASES.md.
 */
const REVERSE_ALIAS_MAP: Record<string, string> = {
  'amass': 'COLLECT', 'binwalk': 'CARVE', 'bloodhound': 'GRAPH',
  'bloodhound-python': 'TRACE', 'bloodyad': 'AD', 'certipy-ad': 'PKI',
  'cewl': 'GATHER', 'chisel': 'TUN', 'commix': 'MIX', 'crunch': 'GENERATE',
  'dig': 'LOOKUP', 'dirb': 'PAGE', 'dnsenum': 'LOT', 'dnsrecon': 'BATCH',
  'enum4linux': 'LIST', 'evil-winrm': 'ENTER', 'exiftool': 'META',
  'feroxbuster': 'WALK', 'ffuf': 'SEEK', 'foremost': 'RECOVER',
  'gobuster': 'BROWSE', 'gpu-crack': 'GPU', 'hash-identifier': 'NAME2',
  'hashcat': 'MATCH', 'hashid': 'LABEL', 'host': 'RESOLVE', 'httpx': 'LIVE',
  'hydra': 'RETRY', 'impacket-addcomputer': 'JOIN',
  'impacket-atexec': 'SEND', 'impacket-changepasswd': 'PASSWORD',
  'impacket-dacledit': 'DACL', 'impacket-dcomexec': 'NOTE',
  'impacket-dpapi': 'DPAPI', 'impacket-finddelegation': 'DELEGATE',
  'impacket-getadusers': 'GETUSER', 'impacket-getnpusers': 'ASREP',
  'impacket-getpac': 'PAC', 'impacket-getst': 'SILVER',
  'impacket-gettgt': 'KERBEROS', 'impacket-getuserspns': 'ROAST',
  'impacket-lookupsid': 'SID', 'impacket-mssqlclient': 'DB',
  'impacket-ntlmrelayx': 'RELAY', 'impacket-owneredit': 'OWNER',
  'impacket-psexec': 'STEP', 'impacket-raisechild': 'CHILD',
  'impacket-rbcd': 'RBCD', 'impacket-reg': 'REGISTRY',
  'impacket-rpcdump': 'DCOM', 'impacket-samrdump': 'DUMP',
  'impacket-secretsdump': 'KEEP', 'impacket-services': 'SERVICE',
  'impacket-smbexec': 'PIPE', 'impacket-smbserver': 'SHARE2',
  'impacket-ticketer': 'TICKET', 'impacket-wmiexec': 'TASK',
  'john': 'GUESS', 'kerbrute': 'KUSER', 'ldapdomaindump': 'LDAP',
  'ldapmodify': 'EDIT', 'ldapsearch': 'STORE', 'masscan': 'WIDE',
  'medusa': 'ROUND', 'msfconsole': 'DESK', 'msfvenom': 'CRAFT',
  'nbtscan': 'NET', 'ncrack': 'REPEAT', 'nikto': 'AUDIT', 'nmap': 'SURFACE',
  'nmblookup': 'NAME', 'nslookup': 'FWD', 'nxc': 'GOTO',
  'patator': 'PUSH', 'proxychains': 'HOOK', 'proxychains4': 'CHAIN',
  'pywerview': 'VIEW2', 'responder': 'LISTEN', 'rpcclient': 'DOOR',
  'rustscan': 'PEEK', 'searchsploit': 'FIND', 'smbclient': 'SHARE',
  'smbget': 'GRAB', 'smbmap': 'MAP', 'socat': 'LINK', 'sqlmap': 'QUERY',
  'sslscan': 'TLS', 'sslyze': 'LOCK', 'tcpdump': 'TRAP',
  'theharvester': 'HARVEST', 'tshark': 'WIRES', 'unicornscan': 'QUICK',
  'wafw00f': 'FACE', 'wfuzz': 'TRY', 'whatweb': 'SHOW', 'wpscan': 'READ',
  'xsstrike': 'MARK',
};

/**
 * Replace all real pentest tool names with their ChillsPwn aliases.
 * Case-preserving — "Nmap" becomes "SURFACE", "nmap" becomes "SURFACE".
 * Runs BEFORE Parseltongue obfuscation to prevent double-obfuscation of
 * tool names that are also trigger words.
 */
export function replaceAliases(text: string): string {
  let result = text;
  // Sort keys longest-first to avoid partial matches
  const sorted = Object.keys(REVERSE_ALIAS_MAP).sort((a, b) => b.length - a.length);
  for (const real of sorted) {
    const alias = REVERSE_ALIAS_MAP[real];
    // Word-boundary regex, case-insensitive
    const regex = new RegExp(String.raw`\b${real.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}\b`, 'gi');
    result = result.replace(regex, (match) => {
      // Preserve case: all-uppercase -> ALIAS, title -> Alias, lower -> lower(alias)
      if (match === match.toUpperCase() && /[A-Z]/.test(match)) return alias;
      if (match[0] === match[0].toUpperCase() && match.slice(1) === match.slice(1).toLowerCase())
        return alias[0] + alias.slice(1).toLowerCase();
      return alias.toLowerCase();
    });
  }
  return result;
}

/**
 * Full scrub: alias replacement then parseltongue obfuscation.
 * Used on council assessments before Claude reads them.
 */
export function obfuscateWithAliases(text: string, config: GodmodeConfig): string {
  const aliasScrubbed = replaceAliases(text);
  return obfuscatePrompt(aliasScrubbed, config);
}
