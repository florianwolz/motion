import { parsePresenterState } from "../lib/engine.js";
import type { PresenterState } from "../lib/engine.js";

export const PRESENTER_CHANNEL_NAME = "motion-presenter";
export const PRESENTER_STATE_STORAGE_KEY = "motion-presenter-state";

export function isAdvanceKey(key: string): boolean {
  return key === "ArrowRight"
    || key === "ArrowDown"
    || key === " "
    || key === "Spacebar"
    || key === "Enter"
    || key === "PageDown";
}

export function isRetreatKey(key: string): boolean {
  return key === "ArrowLeft"
    || key === "ArrowUp"
    || key === "PageUp";
}

export function readStoredPresenterState(stored: string | null): PresenterState | null {
  if (!stored) return null;
  const state = parsePresenterState(stored);
  if (!state.scene_name && state.scene_count === 0 && state.step_count === 0) {
    return null;
  }
  return state;
}
