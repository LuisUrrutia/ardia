import type { PictureInPictureDrag } from "../../platform/media";
import type { PageEngine } from "../engines/engines";

let nothingPlaying = 0;
const backToTab: Record<PageEngine, number> = { chromium: 0, webkit: 0 };
const noDrags = () => ({ moved: 0, offCursor: 0, slowMove: 0 });
let drags = noDrags();

export function noteAutoPictureInPictureNothingPlaying() {
  nothingPlaying++;
}

export function notePictureInPictureBackToTab(engine: PageEngine) {
  backToTab[engine]++;
}

export function notePictureInPictureDragged({ offCursor, slowMove }: PictureInPictureDrag) {
  drags.moved++;
  if (offCursor) drags.offCursor++;
  if (slowMove) drags.slowMove++;
}

export function takePictureInPictureCounts() {
  const taken = { nothingPlaying, backToTab: { ...backToTab }, drags };
  nothingPlaying = 0;
  drags = noDrags();
  backToTab.chromium = 0;
  backToTab.webkit = 0;
  return taken;
}
