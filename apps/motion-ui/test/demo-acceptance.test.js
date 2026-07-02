import assert from "node:assert/strict";
import test from "node:test";

import { buildDemoDocumentJson } from "../dist/editor/demo.js";

function loadDemoDocument() {
  return JSON.parse(buildDemoDocumentJson());
}

test("demo deck covers multiple acceptance-style scenes", () => {
  const document = loadDemoDocument();
  const sceneNames = document.scenes.map((scene) => scene.name);

  assert.ok(document.scenes.length >= 4, "expected multiple demo scenes");
  assert.deepEqual(sceneNames, [
    "Title Reveal",
    "Technical Before / After",
    "Executive KPI Lift",
    "Architecture Focus",
  ]);
  assert.ok(document.scenes.every((scene) => scene.steps.length >= 2), "each scene should have motion steps");
});

test("demo deck encodes diverse semantic motion commands", () => {
  const document = loadDemoDocument();
  const commandTypes = document.scenes.flatMap((scene) =>
    scene.steps.flatMap((step) => step.commands.map((command) => command.type)),
  );
  const hiddenNodeCount = Object.values(document.nodes).filter((node) => node.visible === false).length;
  const enterPresets = new Set(
    Object.values(document.nodes)
      .map((node) => node.animation?.enter_preset)
      .filter(Boolean),
  );

  assert.ok(commandTypes.includes("staggered_reveal"));
  assert.ok(commandTypes.includes("focus"));
  assert.ok(commandTypes.includes("camera_focus"));
  assert.ok(commandTypes.filter((type) => type === "reveal").length >= 3);
  assert.ok(hiddenNodeCount >= 8, "expected hidden nodes for reveal-driven builds");
  assert.ok(enterPresets.has("slide_in"));
  assert.ok(enterPresets.has("pop_in"));
  assert.ok(enterPresets.has("scale_in"));
});
