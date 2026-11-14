import type { Settings } from "../settings/settings";

const MINUTE_MS = 60_000;

const DELAYS: Record<Settings["unloadProfilesAfter"], number | null> = {
  never: null,
  "5m": 5 * MINUTE_MS,
  "15m": 15 * MINUTE_MS,
  "1h": 60 * MINUTE_MS,
  "2h": 120 * MINUTE_MS,
};

export const profileUnloadDelay = (settings: Pick<Settings, "memorySaver" | "unloadProfilesAfter">): number | null =>
  settings.memorySaver ? (DELAYS[settings.unloadProfilesAfter] ?? null) : null;

export function idleProfiles() {
  const idleSince = new Map<string, number>();
  return (loaded: Iterable<string>, inUse: ReadonlySet<string>, now: number, delayMs: number | null): string[] => {
    if (delayMs === null) {
      idleSince.clear();
      return [];
    }
    const profiles = new Set(loaded);
    for (const profile of [...idleSince.keys()]) if (!profiles.has(profile) || inUse.has(profile)) idleSince.delete(profile);
    const ready: string[] = [];
    for (const profile of profiles) {
      if (inUse.has(profile)) continue;
      if (!idleSince.has(profile)) idleSince.set(profile, now);
      if (now - idleSince.get(profile)! >= delayMs) ready.push(profile);
    }
    return ready;
  };
}
