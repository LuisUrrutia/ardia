const none = () => ({ captureIndicatorsCleared: 0, pinnedTabsSleptByMemorySaver: 0, tabsSleptOverBudget: 0, tabsSleptOverBudgetReopened: 0 });

let pending = none();

export function noteCaptureIndicatorCleared() {
  pending.captureIndicatorsCleared++;
}

export function noteTabSlept(pinned: boolean, reason: string | null) {
  if (pinned && reason === "proactive") pending.pinnedTabsSleptByMemorySaver++;
}

export function noteTabSleptOverBudget() {
  pending.tabsSleptOverBudget++;
}

export function noteTabSleptOverBudgetReopened() {
  pending.tabsSleptOverBudgetReopened++;
}

export function takeTabSleepCounts() {
  const taken = pending;
  pending = none();
  return {
    capture_indicators_cleared: taken.captureIndicatorsCleared,
    pinned_tabs_slept_by_memory_saver: taken.pinnedTabsSleptByMemorySaver,
    tabs_slept_over_budget: taken.tabsSleptOverBudget,
    tabs_slept_over_budget_reopened: taken.tabsSleptOverBudgetReopened,
  };
}
