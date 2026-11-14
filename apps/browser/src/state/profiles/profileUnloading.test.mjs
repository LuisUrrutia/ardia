import assert from "node:assert/strict";
import { test } from "node:test";

const setTimeoutHoldingExit = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => {
  const timer = setTimeoutHoldingExit(callback, ms, ...args);
  return ms >= 1_000 ? timer.unref() : timer;
};
globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { reloadLaunchConfigForTests } = await import("../../platform/launchConfig.ts");
const { reloadSwitches } = await import("../../platform/killSwitches.ts");
const loading = await import("./profileLoading.ts");
const { checkIdleProfiles, startProfileUnloading } = await import("./profileUnloading.ts");
const { startBookmarks } = await import("../bookmarks/engineSync.ts");
const { startHistory } = await import("../history/engineSync.ts");
const { takeTabSleepCounts } = await import("../telemetry/tabSleepCounts.ts");

const S = () => useBrowser.getState();
const MINUTE = 60_000;
const until = async (check, what) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeoutHoldingExit(r, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
};

const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 },
  play: { id: "play", name: "Play", color: "green", icon: null, createdAt: 2 },
};
const loadedPage = (url) => ({ kind: "loaded", nav: { url, seq: 1 } });
const tab = (id, profileId, url) => ({
  id, windowId: "w1", profileId, url, title: id, favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, page: loadedPage(url), openerId: null, createdAt: 0, lastActiveAt: 0,
});

let clock = 0;
startProfileUnloading();

function launch(settings = {}) {
  stub.docs.delete("switches-cache.json");
  stub.launch.switches = {};
  reloadLaunchConfigForTests();
  reloadSwitches();
  stub.loadedEngineProfiles.clear();
  for (const engine of ["", "work", "play"]) stub.loadedEngineProfiles.add(engine);
  stub.profilesLoadedCall.known = true;
  stub.idleProfileUnloads.clear();
  const tabs = [tab("t-work", "work", "https://work.example/"), tab("t-play", "play", "https://play.example/"), tab("t-play-2", "play", "https://play.example/2"), tab("t-default", "default", "https://home.example/")];
  S().hydrate({
    profiles: PROFILES, profileOrder: ["default", "work", "play"], settings: { unloadProfilesAfter: "5m", memorySaver: true, ...settings },
    windows: { w1: { id: "w1", profileId: "work", kind: "main", tabIds: tabs.map((t) => t.id), activeTabIds: { work: "t-work", play: "t-play" }, sidebarOpen: true, frame: null, createdAt: 0 } },
    tabs: Object.fromEntries(tabs.map((t) => [t.id, t])), focusedWindowId: "w1",
  });
  takeTabSleepCounts();
  clock += 24 * 60 * MINUTE;
  return loading.startProfileLoading();
}
const unloadCalls = (since) => stub.engineCalls.slice(since).filter((c) => c.domain === "profiles" && c.verb === "unloadIdle").map((c) => c.profile);
const callsFor = (profile, since) => stub.engineCalls.slice(since).filter((c) => c.profile === profile && c.domain !== "profiles").map((c) => `${c.domain}.${c.verb}`);

test("a profile no window shows is unloaded after the delay: its tabs wait to load again, nothing reads it, and opening it reads it again", async () => {
  const stop = launch();
  const stops = [startBookmarks(), startHistory()];
  await until(() => loading.profileOpened("play"), "the engine's loaded profiles");
  await until(() => callsFor("play", 0).includes("history.query"), "play's first history read");
  stub.idleProfileUnloads.set("play", { status: "pending", tabs: ["t-play", "t-play-2"] });
  let since = stub.engineCalls.length;
  await checkIdleProfiles(clock);
  await checkIdleProfiles(clock + 5 * MINUTE - 1);
  assert.deepEqual(unloadCalls(since), [], "not before the delay");
  await checkIdleProfiles(clock + 5 * MINUTE);
  assert.deepEqual(unloadCalls(since), ["play"], "Personal and the shown profile are never asked");
  assert.equal(loading.profileOpened("play"), false);
  assert.equal(loading.profileOpened("work"), true);
  assert.deepEqual([S().tabs["t-play"].page.kind, S().tabs["t-play-2"].page.kind, S().tabs["t-work"].page.kind], ["idle", "idle", "loaded"]);
  assert.equal(S().tabs["t-play"].url, "https://play.example/");
  assert.deepEqual(takeTabSleepCounts().profiles_unloaded, 1);

  since = stub.engineCalls.length;
  await checkIdleProfiles(clock + 6 * MINUTE);
  assert.deepEqual(callsFor("play", since), [], "an unloaded profile gets no engine calls");
  assert.deepEqual(unloadCalls(since), []);

  S().switchProfile("w1", "play");
  assert.equal(loading.profileOpened("play"), true);
  await until(() => callsFor("play", since).includes("history.query") && callsFor("play", since).includes("bookmarks.tree"), "its history and bookmarks read again");
  assert.equal(takeTabSleepCounts().unloaded_profiles_reopened, 1);
  for (const s of stops) s();
  stop();
});

test("a busy profile stays loaded and is asked again; the tabs the engine did close still wait to load again", async () => {
  const stop = launch();
  await until(() => loading.profileOpened("play"), "the engine's loaded profiles");
  stub.idleProfileUnloads.set("play", { status: "busy", tabs: ["t-play-2"] });
  const since = stub.engineCalls.length;
  await checkIdleProfiles(clock);
  await checkIdleProfiles(clock + 5 * MINUTE);
  await checkIdleProfiles(clock + 6 * MINUTE);
  assert.deepEqual(unloadCalls(since), ["play", "play"]);
  assert.equal(loading.profileOpened("play"), true);
  assert.deepEqual([S().tabs["t-play"].page.kind, S().tabs["t-play-2"].page.kind], ["loaded", "idle"]);
  assert.equal(takeTabSleepCounts().profiles_unloaded, 0);
  stop();
});

test("Never, or Memory Saver off, unloads nothing, and showing a profile starts its wait again", async () => {
  for (const settings of [{ unloadProfilesAfter: "never" }, { memorySaver: false }]) {
    const stop = launch(settings);
    await until(() => loading.profileOpened("play"), "the engine's loaded profiles");
    stub.idleProfileUnloads.set("play", { status: "released", tabs: [] });
    const since = stub.engineCalls.length;
    await checkIdleProfiles(clock);
    await checkIdleProfiles(clock + 10 * MINUTE);
    assert.deepEqual(unloadCalls(since), [], JSON.stringify(settings));
    stop();
  }
  const stop = launch();
  await until(() => loading.profileOpened("play"), "the engine's loaded profiles");
  stub.idleProfileUnloads.set("play", { status: "released", tabs: [] });
  stub.idleProfileUnloads.set("work", { status: "released", tabs: [] });
  const since = stub.engineCalls.length;
  await checkIdleProfiles(clock);
  S().switchProfile("w1", "play");
  await checkIdleProfiles(clock + 4 * MINUTE);
  S().switchProfile("w1", "work");
  await checkIdleProfiles(clock + 5 * MINUTE);
  await checkIdleProfiles(clock + 8 * MINUTE);
  assert.deepEqual(unloadCalls(since), []);
  await checkIdleProfiles(clock + 10 * MINUTE);
  assert.deepEqual(unloadCalls(since), ["play"]);
  stop();
});
