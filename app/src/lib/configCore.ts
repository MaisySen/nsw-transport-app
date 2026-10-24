// Remote config parts with no phone dependencies, so the unit tests can load them.
export type Flags = Record<string, boolean>;
export type RemoteConfig = { flags: Flags; kill: Record<string, string>; copy: Record<string, any>; timing: Record<string, number> };
/** Built in defaults: every feature on, config read again every 30 minutes. */
export const DEFAULTS: RemoteConfig = { flags: {}, kill: {}, copy: {}, timing: { configRefreshMin: 30 } };

/** Keeps only the parts the app reads, with the right types. */
export function cleanConfig(raw: any): RemoteConfig {
  const obj = (o: any) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  const flags: Flags = {};
  for (const [k, v] of Object.entries(obj(raw?.flags))) if (typeof v === 'boolean') flags[k] = v;
  const kill: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(raw?.kill))) if (typeof v === 'string' && v) kill[k] = v;
  const timing: Record<string, number> = { ...DEFAULTS.timing };
  for (const [k, v] of Object.entries(obj(raw?.timing))) if (typeof v === 'number' && isFinite(v)) timing[k] = v;
  return { flags, kill, copy: obj(raw?.copy), timing };
}

/** A feature is on unless the server turned it off or killed it. Unknown flags are on. */
export const flagOn = (c: RemoteConfig, name: string) => c.flags[name] !== false && !c.kill[name];

