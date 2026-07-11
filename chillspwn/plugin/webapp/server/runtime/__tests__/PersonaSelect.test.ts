import { test, expect, describe } from "bun:test";
import { selectExecutionPersona, providerKindToPersonaProvider } from "../PersonaSelect";

const PERSONAS = [
  { name: "Coder", provider: "anthropic" },
  { name: "recon-agent", provider: "openrouter" },
  { name: "Codex", provider: "openai-codex" },
  { name: "Plain" }, // no provider ⇒ claude/anthropic
];

describe("selectExecutionPersona (no provider drift)", () => {
  test("providerKind → persona provider mapping", () => {
    expect(providerKindToPersonaProvider("claude")).toBe("anthropic");
    expect(providerKindToPersonaProvider("openrouter")).toBe("openrouter");
    expect(providerKindToPersonaProvider("openai-codex")).toBe("openai-codex");
  });

  test("persona found AND provider matches", () => {
    const r = selectExecutionPersona(PERSONAS, "Coder", "claude");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.persona.name).toBe("Coder");
  });

  test("persona not found but a provider-compatible fallback exists", () => {
    const r = selectExecutionPersona(PERSONAS, "no-such-persona", "openrouter");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.persona.name).toBe("recon-agent");
  });

  test("absent provider field counts as claude/anthropic", () => {
    const r = selectExecutionPersona([{ name: "Plain" }], "Plain", "claude");
    expect(r.ok).toBe(true);
  });

  test("no provider-compatible persona → CLEAR error (no silent fallback)", () => {
    const r = selectExecutionPersona([{ name: "Coder", provider: "anthropic" }], "Coder", "openrouter");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("openrouter");
  });

  test("no accidental provider drift: a claude run never picks an openrouter persona of the same name", () => {
    const r = selectExecutionPersona(
      [{ name: "x", provider: "openrouter" }, { name: "x", provider: "anthropic" }],
      "x",
      "claude",
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.persona.provider).toBe("anthropic"); // matched provider, not just name
  });
});
