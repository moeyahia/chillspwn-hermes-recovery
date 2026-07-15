import { resolve } from "path";

export function claudeStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const hermesHome = resolve(env.HERMES_HOME || resolve(env.HOME || "/root", ".hermes"));
  return resolve(env.CLAUDE_CONFIG_DIR || resolve(hermesHome, "auth/claude"));
}

export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(claudeStateDir(env), "projects");
}
