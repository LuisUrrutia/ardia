import { discardOffered, type OpenWindowRequest } from "../../platform/tabs";
import { withoutFragment } from "../../lib/url";
import { openWindow } from "../browser/actions";
import { useBrowser, type BrowserState } from "../browser/store";
import { engineProfile } from "../browser/model";
import { peekSourceOf, peeksLinksToOtherSites } from "../peek/peek";
import { leavesSite, newTabLinkRoute, siteLanding } from "../peek/newTabLinkRoute";
import { openLittleArdia } from "../littleArdia/actions";
import { isSmall, originalProfile, privateWindowProfile } from "../windows/small";
import { openLinkInSplit, openSplitPane } from "../splits/actions";
import { asAdoptId, isAdoptKind } from "./adoptIds";
import { gateOpening, isGatedUrl, settleOpening } from "./openingGate";
import { noteBackgroundTab } from "./newTabNotice";
import { noteLinkTabWait } from "../telemetry/usage";
import { notePopupOpenedAsTab } from "../telemetry/popupTabCounts";
import { noteAirTrafficLink } from "../telemetry/airTrafficCounts";
import { openAtPlacement } from "../airTraffic/openAt";
import { placeInside } from "../airTraffic/inside";
import { currentAirTraffic } from "../airTraffic/store";

export type { OpenWindowRequest } from "../../platform/tabs";

type PageRef = { windowId: string; profileId: string; tabId?: string; shownUrl?: string };

const UNGATED = new Set(["current", "peek", "incognito"]);

export function openFromPage(request: OpenWindowRequest, page: PageRef) {
  if (request.linkWait) noteLinkTabWait(request.linkWait);
  if (UNGATED.has(request.disposition) || !isGatedUrl(request.url)) return openNow(request, page, false);
  const key = request.routed && request.opens !== "tab" && request.disposition === "foreground" && page.tabId ? `tab:${page.tabId}` : null;
  if (key && !placeInside(useBrowser.getState(), currentAirTraffic(), request.url, page, !!request.keyed)) return openNow(request, page, true);
  const gated = gateOpening(request.url, { tabId: page.tabId ?? null, windowId: page.windowId, profileId: page.profileId, via: "link" }, key);
  const source = key && page.tabId ? { ...page, shownUrl: useBrowser.getState().tabs[page.tabId]?.url ?? "" } : page;
  settleOpening(gated, key, (verdict) => {
    if (verdict && "cancel" in verdict) {
      if (request.adoptId) void discardOffered(request.adoptId).catch(() => false);
      return;
    }
    if (!verdict) return openNow(request, source, true);
    const adoptId = asAdoptId(request.adoptId);
    if (!adoptId) return openNow({ ...request, url: verdict.url }, source, true);
    openNow(request, page, true);
    const s = useBrowser.getState();
    const tabId = Object.keys(s.tabs).find((id) => {
      const p = s.tabs[id]!.page;
      return p.kind === "adopted" && p.adopt === adoptId;
    });
    if (tabId) s.navigate(tabId, verdict.url, { userInitiated: false, gated: true });
  });
}

function openNow(request: OpenWindowRequest, page: PageRef, gated: boolean) {
  const { url, disposition, profile, point } = request;
  const adoptId = asAdoptId(request.adoptId);
  if (request.popup) keepPopupOpener(page);
  const s = useBrowser.getState();
  const w = s.windows[page.windowId];
  if (!w) return;
  if (request.popup) notePopupOpenedAsTab();
  if (request.routed) return openRoutedLink(s, request, page, w, gated);
  const peekSource = peekSourceOf(s, page.tabId);
  if (disposition === "current" || (disposition === "peek" && (peekSource || isSmall(s, w.id)))) {
    if (page.tabId) s.navigate(page.tabId, url, { userInitiated: false });
    return;
  }
  if (disposition === "peek") {
    if (!page.tabId) return;
    const pageUrl = s.tabs[page.tabId]?.url ?? "";
    if (request.site && (w.kind !== "main" || !leavesSite(url, pageUrl))) return void s.navigate(page.tabId, url, { userInitiated: false });
    s.openPeek(page.tabId, url, point ?? null, request.site ? { landing: siteLanding(pageUrl, "source") } : {});
    return;
  }
  const from = peekSource ? { ...page, tabId: peekSource } : page;
  if (isSmall(s, w.id) && disposition !== "window" && disposition !== "incognito") {
    return void s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background: true, gated });
  }
  if (disposition === "foreground" && request.fromClick && isAdoptKind(adoptId, "ardiacore") && page.tabId) {
    const route = newTabLinkRoute(s, page.tabId, url);
    if (route === "peek") return void s.openPeek(page.tabId, url, point ?? null, { adoptId });
    if (route === "otherSite") return void s.openPeek(page.tabId, url, point ?? null, { adoptId, landing: siteLanding(s.tabs[page.tabId]!.url, "tab") });
    if (route === "littleArdia") return void openLittleArdia(url, from.profileId, adoptId);
  }
  if (disposition === "split") {
    if (from.tabId) return openLinkInSplit(from.tabId, url, adoptId);
    openSplitPane(w.id, { url, adoptId });
    return;
  }
  if (disposition === "incognito") {
    const profileId = privateWindowProfile(s, w, profile);
    if (isAdoptKind(adoptId, "tab")) return void openWindow({ kind: "private", url, adoptId, profileId });
    return void openWindow({ kind: "private", url, profileId });
  }
  if (disposition === "window") {
    return void openWindow(w.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { profileId: from.profileId, url, adoptId });
  }
  const background = disposition === "background" || from.profileId !== w.profileId;
  const opened = s.newTab(w.id, { url, adoptId, openerId: from.tabId, profileId: from.profileId, background, gated });
  if (background) noteBackgroundTab(w.id, opened, page.tabId);
}

function keepPopupOpener(page: PageRef) {
  const s = useBrowser.getState();
  const sourceId = peekSourceOf(s, page.tabId);
  if (sourceId) s.peekToTab(page.windowId, { activate: false, sourceId });
}

function openRoutedLink(s: BrowserState, request: OpenWindowRequest, page: PageRef, w: BrowserState["windows"][string], gated: boolean) {
  const { url, disposition } = request;
  const how = disposition === "background" ? "background" : disposition === "window" ? "window" : "foreground";
  if (how === "foreground" && request.opens !== "tab" && page.tabId && !s.tabs[page.tabId]) return;
  const from = { windowId: w.id, tabId: page.tabId };
  const placement = placeInside(s, currentAirTraffic(), url, { ...from, profileId: page.profileId }, how !== "foreground" || !!request.keyed);
  if (placement) {
    noteAirTrafficLink("click");
    return openAtPlacement(placement, { url, how, from, gated, via: "link" });
  }
  const pageUrl = page.tabId ? (s.tabs[page.tabId]?.url ?? "") : "";
  if (page.shownUrl !== undefined && withoutFragment(pageUrl) !== withoutFragment(page.shownUrl)) return;
  if (how === "foreground" && !request.keyed && request.opens !== "tab" && page.tabId && w.kind === "main" && peeksLinksToOtherSites(s, page.tabId) && leavesSite(url, pageUrl)) {
    return void s.openPeek(page.tabId, url, request.point ?? null, { landing: siteLanding(pageUrl, "source") });
  }
  if (how === "foreground" && request.opens !== "tab" && page.tabId) return s.navigate(page.tabId, url, { userInitiated: true, gated });
  if (how === "foreground" && !request.keyed && page.tabId) {
    if (isSmall(s, w.id) && s.settings.littleArdiaOpensNewTabLinks) return s.navigate(page.tabId, url, { userInitiated: true, gated });
    const route = newTabLinkRoute(s, page.tabId, url);
    if (route === "peek") return void s.openPeek(page.tabId, url, request.point ?? null);
    if (route === "otherSite") return void s.openPeek(page.tabId, url, request.point ?? null, { landing: siteLanding(s.tabs[page.tabId]!.url, "tab") });
    if (route === "littleArdia") return void openLittleArdia(url, page.profileId);
  }
  if (how === "window") return void openWindow(w.kind === "private" ? { kind: "private", url, profileId: originalProfile(s, w) } : { profileId: page.profileId, url });
  const background = how === "background" || isSmall(s, w.id) || page.profileId !== w.profileId;
  const opened = s.newTab(w.id, { url, openerId: peekSourceOf(s, page.tabId) ?? page.tabId, profileId: page.profileId, background, gated });
  if (background) noteBackgroundTab(w.id, opened, page.tabId);
}

export function pageProfileId(windowId: string, pageProfile: string): string {
  const s = useBrowser.getState();
  const w = s.windows[windowId];
  if (w && engineProfile(s, w.profileId) === pageProfile) return w.profileId;
  return s.profileOrder.find((p) => engineProfile(s, p) === pageProfile) ?? w?.profileId ?? s.settings.defaultProfileId;
}
