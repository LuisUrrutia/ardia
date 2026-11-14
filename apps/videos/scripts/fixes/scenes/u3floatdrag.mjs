import { DRAG } from "./_47n3.mjs";

export default {
  session: "session-0247n3-hidden.json",
  setup: `return sleep(2500).then(() => done({ hidden: st().settings.autoHideTabs }));`,
  act: `${DRAG}
return at(640, 420).then(() => sleep(700))
  .then(() => move(2, 330, 900)).then(() => sleep(900))
  .then(() => move(266, 330, 700)).then(() => sleep(500))
  .then(() => { mark("go"); return down(); }).then(() => sleep(120))
  .then(() => dragTo(360, 330, 900)).then(() => sleep(600)).then(up).then(() => sleep(900))
  .then(() => move(200, 300, 500)).then(() => sleep(1500))
  .then(() => done({ width: st().settings.sidebarWidth }));`,
  tail: 500,
};
