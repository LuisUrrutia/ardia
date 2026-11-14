import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { scriptChange, scriptState } = await import("./scripting.ts");

const S = () => useBrowser.getState();
const untitled = (state) => JSON.stringify({ ...state, windows: state.windows.map((w) => ({ ...w, title: "", tabs: w.tabs.map((t) => ({ ...t, title: "" })) })) });

test("a change scripts can see is pushed: at once when a tab, window or profile is added, moved, navigated or starts loading, later when only titles moved", () => {
  S().hydrate({});
  const windows = [S().createWindow({ url: "https://a.example/" }), S().createWindow({ url: "https://b.example/" })];
  for (const w of windows) for (let i = 0; i < 4; i++) S().newTab(w, { url: `https://${i}.example/`, background: true });
  let seed = 11;
  const rand = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const pick = (list) => list[rand(list.length)];
  const steps = [
    (id) => S().updateTab(id, { title: `Title ${rand(5)}` }),
    (id) => S().updateTab(id, { favicon: `https://x.example/${rand(3)}.ico` }),
    (id) => S().updateTab(id, { muted: !S().tabs[id].muted }),
    (id) => S().updateTab(id, { url: pick(["https://a.example/", "file:///tmp/a.txt", "https://b.example/page"]) }),
    (id) => S().updateTab(id, { customTitle: pick([null, "Mine"]) }),
    (id) => S().updateTab(id, { pin: pick([null, { as: "row" }, { as: "tile" }]) }),
    (id) => S().updateLive(id, { isLoading: !S().live[id]?.isLoading }),
    (id) => S().updateLive(id, { progress: rand(10) / 10, canGoBack: !!rand(2) }),
    (id) => S().activate(id),
    (id) => S().setFocusedWindow(S().tabs[id].windowId),
    (id) => S().newTab(S().tabs[id].windowId, { url: "https://new.example/", background: !!rand(2) }),
    (id) => Object.keys(S().tabs).length > 6 && S().closeTab(id),
    () => S().createProfile?.({ name: `P${rand(3)}` }),
  ];
  const seen = { structure: 0, titles: 0, none: 0 };
  for (let i = 0; i < 800; i++) {
    const before = S();
    const step = pick(steps);
    step(pick(Object.keys(before.tabs)));
    const after = S();
    const change = scriptChange(after, before);
    const was = scriptState(before);
    const now = scriptState(after);
    if (change === null) assert.equal(JSON.stringify(now), JSON.stringify(was), `${step} changed what scripts read and nothing would push it`);
    if (change === "titles") assert.equal(untitled(now), untitled(was), `${step} changed more than titles and waits a second`);
    seen[change ?? "none"]++;
  }
  assert.ok(seen.structure > 50 && seen.titles > 20 && seen.none > 50, JSON.stringify(seen));
});
