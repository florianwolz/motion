import assert from "node:assert/strict";
import test from "node:test";

import {
  isAdvanceKey,
  isRetreatKey,
  readStoredPresenterState,
} from "../dist/presenter/runtime.js";

test("isAdvanceKey accepts presentation next-step keys", () => {
  assert.equal(isAdvanceKey("ArrowRight"), true);
  assert.equal(isAdvanceKey(" "), true);
  assert.equal(isAdvanceKey("Enter"), true);
  assert.equal(isAdvanceKey("PageDown"), true);
  assert.equal(isAdvanceKey("Escape"), false);
});

test("isRetreatKey accepts presentation previous-step keys", () => {
  assert.equal(isRetreatKey("ArrowLeft"), true);
  assert.equal(isRetreatKey("ArrowUp"), true);
  assert.equal(isRetreatKey("PageUp"), true);
  assert.equal(isRetreatKey("PageDown"), false);
});

test("readStoredPresenterState rejects empty placeholder state", () => {
  const state = readStoredPresenterState(JSON.stringify({
    scene_idx: 0,
    step_idx: null,
    scene_name: "",
    scene_notes: "",
    scene_count: 0,
    step_name: "",
    step_notes: "",
    step_count: 0,
    next_label: "",
  }));
  assert.equal(state, null);
});

test("readStoredPresenterState accepts real presenter state", () => {
  const state = readStoredPresenterState(JSON.stringify({
    scene_idx: 1,
    step_idx: 2,
    scene_name: "Quarterly Update",
    scene_notes: "Keep this short",
    scene_count: 4,
    step_name: "Show KPI delta",
    step_notes: "Pause before the number",
    step_count: 3,
    next_label: "→ Risks",
  }));
  assert.deepEqual(state, {
    scene_idx: 1,
    step_idx: 2,
    scene_name: "Quarterly Update",
    scene_notes: "Keep this short",
    scene_count: 4,
    step_name: "Show KPI delta",
    step_notes: "Pause before the number",
    step_count: 3,
    next_label: "→ Risks",
  });
});
