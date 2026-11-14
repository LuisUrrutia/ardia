const PAGE = [260, 50];
const ROW = (i) => [PAGE[0] + 260, PAGE[1] + 170 + i * 86];

export default {
  session: "session-0247n3-downloads.json",
  switches: ["--unsafely-treat-insecure-origin-as-secure=http://files.example"],
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `const row = (i) => [${ROW(0)[0]}, ${ROW(0)[1]} + i * 86];
const get = (i) => move(...row(i), 700).then(() => sleep(250)).then(() => click());
const opened = [];
const note = () => opened.push(!!st().windowUi?.[W]?.downloadsOpen);
return at(760, 640).then(() => sleep(700))
  .then(() => move(...row(0), 900)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1500)).then(note)
  .then(() => get(1)).then(() => sleep(1500)).then(note)
  .then(() => get(2)).then(() => sleep(1500)).then(note)
  .then(() => move(760, 640, 800)).then(() => sleep(1200))
  .then(() => done({ opened, downloads: Object.keys(st().downloads ?? {}).length }));`,
  tail: 500,
};
