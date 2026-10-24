export const PLUGIN = 'shift'
// Prompt origins that are the owner at the keyboard, not the harness or a plugin.
export const OWNER_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])
