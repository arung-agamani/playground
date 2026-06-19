const THRESHOLD_MESSAGES = 15;
const THRESHOLD_MINUTES = 30;
const DEBOUNCE_MINUTES = 5;

export interface ThresholdState {
  messageCount: number;
  lastWriteTime: number;
}

export function createThresholds(initialCount = 0): ThresholdState {
  return {
    messageCount: initialCount,
    lastWriteTime: 0,
  };
}

export function shouldRefresh(state: ThresholdState): boolean {
  const now = Date.now();
  const timeSinceWrite = (now - state.lastWriteTime) / 60_000;

  if (timeSinceWrite < DEBOUNCE_MINUTES) return false;
  if (state.messageCount >= THRESHOLD_MESSAGES) return true;
  if (state.lastWriteTime > 0 && timeSinceWrite >= THRESHOLD_MINUTES) return true;

  return false;
}

export function recordWrite(state: ThresholdState, resetCount = true): void {
  state.lastWriteTime = Date.now();
  if (resetCount) state.messageCount = 0;
}

export function incrementCount(state: ThresholdState): void {
  state.messageCount++;
}
