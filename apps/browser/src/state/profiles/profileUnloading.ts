import { loadedProfiles, onProfileLoaded, unloadIdleProfile } from "../../platform/profiles";
import { everySlowly } from "../../platform/slowTimers";
import { useBrowser } from "../browser/store";
import { isIncognitoProfile } from "../browser/model";
import { hasPage, IDLE, needsPage, wakeOf, withWake, wokenPage } from "../tabs/pageSession";
import { noteProfileUnloaded, noteUnloadedProfileReloaded, noteUnloadedProfileReopened } from "../telemetry/tabSleepCounts";
import { engineProfiles } from "./engineProfiles";
import { idleProfiles, profileUnloadDelay } from "./idleProfiles";
import { markProfileUnloaded, onProfilesOpened, openProfile, profileOpened, shownEngineProfiles } from "./profileLoading";

const CHECK_MS = 60_000;
const REMOUNT_MS = 100;
const PERSONAL = "";

type Unload = Awaited<ReturnType<typeof unloadIdleProfile>>;

const store = () => useBrowser.getState();
const readyToUnload = idleProfiles();
const unloadedHere = new Set<string>();
const reopenedAt = new Map<string, number>();
let checking = false;

function wakeShown(ids: string[]) {
  const s = store();
  const active = new Set(Object.values(s.windows).map((w) => w.activeTabIds[w.profileId]));
  for (const id of ids) {
    const tab = s.tabs[id];
    if (tab && active.has(id) && needsPage(tab)) s.updateTab(id, { page: wokenPage(tab) });
  }
}

const unloadable = (profile: string) => profile !== PERSONAL && !isIncognitoProfile(profile);

export function applyUnload(profile: string, result: Unload) {
  const s = store();
  const shown = shownEngineProfiles(s).includes(profile);
  for (const id of result.tabs) {
    const tab = s.tabs[id];
    if (tab && hasPage(tab)) s.updateTab(id, { page: withWake(IDLE, wakeOf(tab)) });
  }
  if (shown) setTimeout(() => wakeShown(result.tabs), REMOUNT_MS);
  if (result.status === "busy") return false;
  if (shown) {
    openProfile(profile);
    return false;
  }
  if (!profileOpened(profile)) return false;
  unloadedHere.add(profile);
  markProfileUnloaded(profile);
  noteProfileUnloaded();
  return true;
}

async function unload(profile: string) {
  const s = store();
  if (!unloadable(profile) || shownEngineProfiles(s).includes(profile)) return false;
  return applyUnload(profile, await unloadIdleProfile(profile));
}

export async function checkIdleProfiles(now = Date.now()) {
  const s = store();
  const delay = profileUnloadDelay(s.settings);
  if (delay === null) return void readyToUnload([], new Set(), now, null);
  if (checking || engineProfiles(s).length < 2) return;
  checking = true;
  try {
    const loaded = (await loadedProfiles()).filter((profile) => unloadable(profile) && profileOpened(profile));
    for (const profile of readyToUnload(loaded, new Set(shownEngineProfiles(store())), now, delay)) {
      if (profileUnloadDelay(store().settings) === null) return;
      await unload(profile);
    }
  } catch (error) {
    console.warn("[profiles] couldn't unload idle profiles", error);
  } finally {
    checking = false;
  }
}

let started = false;

export function startProfileUnloading() {
  if (started) return;
  started = true;
  onProfilesOpened((engines) => {
    for (const engine of engines) {
      if (!unloadedHere.delete(engine)) continue;
      noteUnloadedProfileReopened();
      reopenedAt.set(engine, Date.now());
    }
  });
  onProfileLoaded((engine) => {
    const at = reopenedAt.get(engine);
    if (at === undefined) return;
    reopenedAt.delete(engine);
    noteUnloadedProfileReloaded(Date.now() - at);
  });
  everySlowly({
    every: CHECK_MS,
    run: () => void checkIdleProfiles(),
    needed: () => profileUnloadDelay(store().settings) !== null,
    watch: (changed) =>
      useBrowser.subscribe((s, prev) => {
        if (s.settings.unloadProfilesAfter !== prev.settings.unloadProfilesAfter || s.settings.memorySaver !== prev.settings.memorySaver) changed();
      }),
  });
  if (__DEV__) (globalThis as { acProfileUnloading?: unknown }).acProfileUnloading = { check: checkIdleProfiles, unload };
}
