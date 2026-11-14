import { applySettings } from "./_47n3.mjs";

export default {
  session: "session-0247n3-hidden.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done({ hidden: st().settings.autoHideTabs }));`,
  prepare: (instance, side) => applySettings(instance, "u3edgeoff", side),
  act: `return at(700, 520).then(() => sleep(700))
  .then(() => { mark("go"); return move(3, 300, 1000); }).then(() => sleep(400))
  .then(() => move(90, 160, 500)).then(() => sleep(1500))
  .then(() => move(520, 330, 700)).then(() => sleep(900))
  .then(() => key("⌘S", CMD, "s", 1)).then(() => sleep(2000))
  .then(() => done({ hidden: st().settings.autoHideTabs, window: st().windows[W].autoHideTabs ?? null }));`,
  tail: 500,
};
