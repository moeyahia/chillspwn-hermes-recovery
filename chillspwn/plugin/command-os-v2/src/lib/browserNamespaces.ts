export const COMMAND_OS_V2_BROWSER_NAMESPACE = "chillspwn.command-os-v2" as const;

export const BROWSER_STORAGE_KEYS = {
  eventResume: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.events.last-event-id`,
  brainGraphRoot: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.brain.graph-root`,
  brainSavedViews: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.brain.saved-graph-views.v1`,
  brainPinnedPositions: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.brain.pinned-graph-positions.v1`,
} as const;

export const BROWSER_CHANNEL_NAMES = {
  runtimeEvents: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.runtime-events`,
} as const;

export const BROWSER_CACHE_NAMES = {
  shell: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.shell`,
  media: `${COMMAND_OS_V2_BROWSER_NAMESPACE}.media`,
} as const;
