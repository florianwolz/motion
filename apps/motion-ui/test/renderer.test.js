/**
 * renderer.test.js — unit tests for the Canvas2DRenderer infrastructure.
 *
 * These tests run in Node.js (no browser APIs) so they exercise only the
 * pure-function parts of renderer.ts via the compiled dist/ output.
 * The Canvas2DRenderer itself is exercised through a lightweight mock canvas
 * that records every Canvas 2D API call it receives.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  toCssColor,
  drawPassRank,
  buildNodeMap,
  sortNodesByPass,
} from "../dist/lib/renderer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rgba(r, g, b, a = 1.0) {
  return { r, g, b, a };
}

function makeTransform(overrides = {}) {
  return {
    x: 0, y: 0, width: 100, height: 50,
    rotation: 0, scale_x: 1.0, scale_y: 1.0,
    ...overrides,
  };
}

function makeRenderNode(id, drawPass, content = { type: "frame" }, overrides = {}) {
  return {
    id,
    transform: makeTransform(),
    opacity: 1.0,
    visible: true,
    children: [],
    content,
    material: null,
    blur_radius: 0.0,
    clip: false,
    draw_pass: drawPass,
    ...overrides,
  };
}

/**
 * Minimal mock Canvas 2D context that records all method calls and property
 * sets as { type: "call"|"set", name, args } entries.
 */
function makeMockContext() {
  const calls = [];
  const props = {
    globalAlpha: 1.0,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textBaseline: "",
    textAlign: "",
    filter: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
  };

  function recordCall(name, args) {
    calls.push({ type: "call", name, args: Array.from(args) });
  }

  const ctx = new Proxy(
    {
      ...props,
      save: (...a) => recordCall("save", a),
      restore: (...a) => recordCall("restore", a),
      clearRect: (...a) => recordCall("clearRect", a),
      fillRect: (...a) => recordCall("fillRect", a),
      strokeRect: (...a) => recordCall("strokeRect", a),
      beginPath: (...a) => recordCall("beginPath", a),
      moveTo: (...a) => recordCall("moveTo", a),
      lineTo: (...a) => recordCall("lineTo", a),
      rect: (...a) => recordCall("rect", a),
      ellipse: (...a) => recordCall("ellipse", a),
      roundRect: (...a) => recordCall("roundRect", a),
      clip: (...a) => recordCall("clip", a),
      fill: (...a) => recordCall("fill", a),
      stroke: (...a) => recordCall("stroke", a),
      fillText: (...a) => recordCall("fillText", a),
      strokeText: (...a) => recordCall("strokeText", a),
      translate: (...a) => recordCall("translate", a),
      rotate: (...a) => recordCall("rotate", a),
      scale: (...a) => recordCall("scale", a),
      drawImage: (...a) => recordCall("drawImage", a),
      measureText: (text) => {
        recordCall("measureText", [text]);
        return { width: text.length * 8 }; // fake measurement
      },
      createLinearGradient: (...a) => {
        recordCall("createLinearGradient", a);
        return { addColorStop: () => {} };
      },
      createRadialGradient: (...a) => {
        recordCall("createRadialGradient", a);
        return { addColorStop: () => {} };
      },
    },
    {
      set(target, prop, value) {
        calls.push({ type: "set", name: prop, value });
        target[prop] = value;
        return true;
      },
    }
  );

  return { ctx, calls };
}

/**
 * Build a minimal mock HTMLCanvasElement backed by the mock context.
 */
function makeMockCanvas() {
  const { ctx, calls } = makeMockContext();
  const canvas = {
    width: 0,
    height: 0,
    style: { width: "", height: "" },
    getContext: (type) => (type === "2d" ? ctx : null),
  };
  return { canvas, ctx, calls };
}

// ─── toCssColor ───────────────────────────────────────────────────────────────

test("toCssColor: opaque black", () => {
  assert.equal(toCssColor(rgba(0, 0, 0, 1)), "rgba(0,0,0,1.000)");
});

test("toCssColor: opaque white", () => {
  assert.equal(toCssColor(rgba(1, 1, 1, 1)), "rgba(255,255,255,1.000)");
});

test("toCssColor: fully transparent", () => {
  assert.equal(toCssColor(rgba(0, 0, 0, 0)), "rgba(0,0,0,0.000)");
});

test("toCssColor: mid-grey semi-transparent", () => {
  assert.equal(toCssColor(rgba(0.5, 0.5, 0.5, 0.5)), "rgba(128,128,128,0.500)");
});

test("toCssColor: primary red", () => {
  assert.equal(toCssColor(rgba(1, 0, 0, 1)), "rgba(255,0,0,1.000)");
});

test("toCssColor: primary green", () => {
  assert.equal(toCssColor(rgba(0, 1, 0, 1)), "rgba(0,255,0,1.000)");
});

test("toCssColor: primary blue", () => {
  assert.equal(toCssColor(rgba(0, 0, 1, 1)), "rgba(0,0,255,1.000)");
});

test("toCssColor: rounds fractional components", () => {
  // 0.996 * 255 = 253.98 → rounds to 254
  const css = toCssColor(rgba(0.996, 0.996, 0.996, 1));
  assert.equal(css, "rgba(254,254,254,1.000)");
});

test("toCssColor: alpha is formatted to 3 decimal places", () => {
  const css = toCssColor(rgba(1, 1, 1, 0.1));
  assert.ok(css.includes("0.100"), `expected '0.100' in '${css}'`);
});

// ─── drawPassRank ─────────────────────────────────────────────────────────────

test("drawPassRank: shape has lowest rank (0)", () => {
  assert.equal(drawPassRank("shape"), 0);
});

test("drawPassRank: image_video rank is 1", () => {
  assert.equal(drawPassRank("image_video"), 1);
});

test("drawPassRank: text rank is 2", () => {
  assert.equal(drawPassRank("text"), 2);
});

test("drawPassRank: shadow rank is 3", () => {
  assert.equal(drawPassRank("shadow"), 3);
});

test("drawPassRank: blur rank is 4", () => {
  assert.equal(drawPassRank("blur"), 4);
});

test("drawPassRank: mask rank is 5", () => {
  assert.equal(drawPassRank("mask"), 5);
});

test("drawPassRank: glass rank is 6", () => {
  assert.equal(drawPassRank("glass"), 6);
});

test("drawPassRank: particles rank is 7", () => {
  assert.equal(drawPassRank("particles"), 7);
});

test("drawPassRank: composite rank is 8", () => {
  assert.equal(drawPassRank("composite"), 8);
});

test("drawPassRank: color_grade has highest rank (9)", () => {
  assert.equal(drawPassRank("color_grade"), 9);
});

test("drawPassRank: shape < text < glass ordering", () => {
  assert.ok(drawPassRank("shape") < drawPassRank("text"));
  assert.ok(drawPassRank("text") < drawPassRank("glass"));
  assert.ok(drawPassRank("glass") < drawPassRank("composite"));
});

// ─── buildNodeMap ─────────────────────────────────────────────────────────────

test("buildNodeMap: returns a map keyed by node id", () => {
  const a = makeRenderNode("a", "shape");
  const b = makeRenderNode("b", "text");
  const map = buildNodeMap([a, b]);
  assert.ok(map.has("a"));
  assert.ok(map.has("b"));
  assert.equal(map.get("a")?.id, "a");
  assert.equal(map.get("b")?.id, "b");
});

test("buildNodeMap: empty input returns empty map", () => {
  assert.equal(buildNodeMap([]).size, 0);
});

test("buildNodeMap: last entry wins on duplicate ids", () => {
  const a1 = makeRenderNode("dup", "shape");
  const a2 = makeRenderNode("dup", "text");
  const map = buildNodeMap([a1, a2]);
  assert.equal(map.get("dup")?.draw_pass, "text");
});

// ─── sortNodesByPass ──────────────────────────────────────────────────────────

test("sortNodesByPass: text node sorts after shape node", () => {
  const text = makeRenderNode("t", "text");
  const shape = makeRenderNode("s", "shape");
  const sorted = sortNodesByPass([text, shape]);
  assert.equal(sorted[0]?.id, "s");
  assert.equal(sorted[1]?.id, "t");
});

test("sortNodesByPass: glass sorts after image_video and text", () => {
  const glass = makeRenderNode("g", "glass");
  const img = makeRenderNode("i", "image_video");
  const txt = makeRenderNode("t", "text");
  const sorted = sortNodesByPass([glass, img, txt]);
  assert.equal(sorted[0]?.id, "i");
  assert.equal(sorted[1]?.id, "t");
  assert.equal(sorted[2]?.id, "g");
});

test("sortNodesByPass: stable within same pass", () => {
  const a = makeRenderNode("a", "shape");
  const b = makeRenderNode("b", "shape");
  const c = makeRenderNode("c", "shape");
  const sorted = sortNodesByPass([a, b, c]);
  assert.equal(sorted[0]?.id, "a");
  assert.equal(sorted[1]?.id, "b");
  assert.equal(sorted[2]?.id, "c");
});

test("sortNodesByPass: does not mutate original array", () => {
  const nodes = [makeRenderNode("t", "text"), makeRenderNode("s", "shape")];
  sortNodesByPass(nodes);
  assert.equal(nodes[0]?.id, "t"); // original unchanged
});

test("sortNodesByPass: full pass order end-to-end", () => {
  const passes = [
    "color_grade", "composite", "particles", "glass",
    "mask", "blur", "shadow", "text", "image_video", "shape",
  ];
  const nodes = passes.map((p) => makeRenderNode(p, p));
  const sorted = sortNodesByPass(nodes);
  assert.deepEqual(
    sorted.map((n) => n.draw_pass),
    ["shape", "image_video", "text", "shadow", "blur", "mask", "glass", "particles", "composite", "color_grade"]
  );
});

// ─── Canvas2DRenderer via mock canvas ────────────────────────────────────────

// Import the class separately so we can construct it with a mock canvas.
import { Canvas2DRenderer } from "../dist/lib/renderer.js";

function makeRenderTree(nodes, roots, vpW = 800, vpH = 600, dpr = 1) {
  return { nodes, roots, viewport_width: vpW, viewport_height: vpH, device_pixel_ratio: dpr };
}

test("Canvas2DRenderer: constructor throws when context unavailable", () => {
  const badCanvas = { getContext: () => null };
  assert.throws(
    () => new Canvas2DRenderer(badCanvas),
    /Failed to get 2D rendering context/
  );
});

test("Canvas2DRenderer: draw on empty tree clears the canvas", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  renderer.draw(makeRenderTree([], []));
  const cleared = calls.some((c) => c.type === "call" && c.name === "clearRect");
  assert.ok(cleared, "clearRect should be called on empty tree");
});

test("Canvas2DRenderer: draw calls save/restore for each visible node", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("n1", "shape");
  renderer.draw(makeRenderTree([node], ["n1"]));
  const saves = calls.filter((c) => c.type === "call" && c.name === "save");
  const restores = calls.filter((c) => c.type === "call" && c.name === "restore");
  assert.ok(saves.length >= 1, "save should be called for each visible node");
  assert.equal(saves.length, restores.length, "save/restore should be balanced");
});

test("Canvas2DRenderer: invisible node produces no save/restore", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("n1", "shape", { type: "frame" }, { visible: false });
  renderer.draw(makeRenderTree([node], ["n1"]));
  const saves = calls.filter((c) => c.type === "call" && c.name === "save");
  assert.equal(saves.length, 0, "invisible node should not cause save/restore");
});

test("Canvas2DRenderer: zero-opacity node is skipped", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("n1", "shape", { type: "frame" }, { opacity: 0 });
  renderer.draw(makeRenderTree([node], ["n1"]));
  const saves = calls.filter((c) => c.type === "call" && c.name === "save");
  assert.equal(saves.length, 0);
});

test("Canvas2DRenderer: shape node triggers beginPath and fill", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("s1", "shape", {
    type: "shape",
    kind: { type: "rectangle" },
    fill: rgba(1, 0, 0, 1),
    stroke: null,
    stroke_width: 0,
  });
  renderer.draw(makeRenderTree([node], ["s1"]));
  assert.ok(calls.some((c) => c.name === "beginPath"), "beginPath expected");
  assert.ok(calls.some((c) => c.name === "fill"), "fill expected for filled shape");
});

test("Canvas2DRenderer: shape with stroke triggers stroke()", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("s2", "shape", {
    type: "shape",
    kind: { type: "rectangle" },
    fill: null,
    stroke: rgba(0, 0, 1, 1),
    stroke_width: 2,
  });
  renderer.draw(makeRenderTree([node], ["s2"]));
  assert.ok(calls.some((c) => c.name === "stroke"), "stroke() expected");
});

test("Canvas2DRenderer: ellipse shape uses ellipse() call", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("e1", "shape", {
    type: "shape",
    kind: { type: "ellipse" },
    fill: rgba(0, 1, 0, 1),
    stroke: null,
    stroke_width: 0,
  });
  renderer.draw(makeRenderTree([node], ["e1"]));
  assert.ok(calls.some((c) => c.name === "ellipse"), "ellipse() expected for ellipse shape");
});

test("Canvas2DRenderer: rounded_rectangle uses roundRect()", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("rr1", "shape", {
    type: "shape",
    kind: { type: "rounded_rectangle", corner_radius: 8 },
    fill: rgba(0, 1, 0, 1),
    stroke: null,
    stroke_width: 0,
  });
  renderer.draw(makeRenderTree([node], ["rr1"]));
  assert.ok(calls.some((c) => c.name === "roundRect"), "roundRect() expected");
});

test("Canvas2DRenderer: line shape uses moveTo/lineTo", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("l1", "shape", {
    type: "shape",
    kind: { type: "line" },
    fill: null,
    stroke: rgba(1, 1, 1, 1),
    stroke_width: 1,
  });
  renderer.draw(makeRenderTree([node], ["l1"]));
  assert.ok(calls.some((c) => c.name === "moveTo"), "moveTo expected for line");
  assert.ok(calls.some((c) => c.name === "lineTo"), "lineTo expected for line");
});

test("Canvas2DRenderer: text node calls fillText", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("t1", "text", {
    type: "text",
    content: "Hello World",
    color: rgba(1, 1, 1, 1),
    font_family: "Inter",
    font_size: 24,
    line_height: 1.4,
  });
  renderer.draw(makeRenderTree([node], ["t1"]));
  const textCalls = calls.filter((c) => c.name === "fillText");
  assert.ok(textCalls.length >= 1, "fillText should be called for text node");
  const rendered = textCalls.map((c) => c.args[0]).join(" ");
  assert.ok(rendered.includes("Hello") || rendered.includes("World"), "text content should be drawn");
});

test("Canvas2DRenderer: text node sets correct font string", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("t2", "text", {
    type: "text",
    content: "Hi",
    color: rgba(0, 0, 0, 1),
    font_family: "Roboto",
    font_size: 18,
    line_height: 1.2,
  });
  renderer.draw(makeRenderTree([node], ["t2"]));
  const fontSets = calls.filter((c) => c.type === "set" && c.name === "font");
  assert.ok(fontSets.length >= 1, "font property should be set");
  assert.ok(fontSets.some((s) => s.value.includes("18px") && s.value.includes("Roboto")));
});

test("Canvas2DRenderer: frame with solid material fills background", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("f1", "shape", { type: "frame" }, {
    material: { type: "solid", color: rgba(0.2, 0.2, 0.2, 1) },
  });
  renderer.draw(makeRenderTree([node], ["f1"]));
  const fillRects = calls.filter((c) => c.name === "fillRect");
  assert.ok(fillRects.length >= 1, "fillRect expected for frame with material");
});

test("Canvas2DRenderer: blurred node sets filter", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("b1", "blur", { type: "frame" }, { blur_radius: 12 });
  renderer.draw(makeRenderTree([node], ["b1"]));
  const filterSets = calls.filter((c) => c.type === "set" && c.name === "filter");
  assert.ok(
    filterSets.some((s) => typeof s.value === "string" && s.value.includes("blur(12px)")),
    "blur filter should be set"
  );
});

test("Canvas2DRenderer: clip node calls clip()", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("c1", "shape", { type: "frame" }, { clip: true });
  renderer.draw(makeRenderTree([node], ["c1"]));
  assert.ok(calls.some((c) => c.name === "clip"), "clip() should be called for clip nodes");
});

test("Canvas2DRenderer: globalAlpha reflects node opacity", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("o1", "shape", { type: "frame" }, { opacity: 0.4 });
  renderer.draw(makeRenderTree([node], ["o1"]));
  const alphaSets = calls.filter((c) => c.type === "set" && c.name === "globalAlpha");
  assert.ok(alphaSets.some((s) => Math.abs(s.value - 0.4) < 0.001), "globalAlpha should be 0.4");
});

test("Canvas2DRenderer: rotation applies ctx.rotate", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("r1", "shape");
  node.transform.rotation = 45;
  renderer.draw(makeRenderTree([node], ["r1"]));
  const rotates = calls.filter((c) => c.name === "rotate");
  assert.ok(rotates.length >= 1, "rotate() should be called for rotated nodes");
});

test("Canvas2DRenderer: child nodes are traversed", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const child = makeRenderNode("child", "text", {
    type: "text",
    content: "child text",
    color: rgba(1, 1, 1, 1),
    font_family: "sans-serif",
    font_size: 12,
    line_height: 1.2,
  });
  const parent = makeRenderNode("parent", "shape", { type: "frame" }, { children: ["child"] });
  renderer.draw(makeRenderTree([parent, child], ["parent"]));
  const textCalls = calls.filter((c) => c.name === "fillText");
  assert.ok(textCalls.length >= 1, "child text node should be drawn");
});

test("Canvas2DRenderer: matte_card material sets shadow properties", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);
  const node = makeRenderNode("card", "shadow", { type: "frame" }, {
    material: {
      type: "matte_card",
      background: rgba(0.1, 0.1, 0.1, 1),
      corner_radius: 12,
      shadow_color: rgba(0, 0, 0, 0.5),
      shadow_blur: 20,
      shadow_offset_y: 8,
    },
  });
  renderer.draw(makeRenderTree([node], ["card"]));
  const shadowBlurSets = calls.filter((c) => c.type === "set" && c.name === "shadowBlur");
  assert.ok(shadowBlurSets.some((s) => s.value === 20), "shadowBlur should be 20");
  const shadowOffsetSets = calls.filter((c) => c.type === "set" && c.name === "shadowOffsetY");
  assert.ok(shadowOffsetSets.some((s) => s.value === 8), "shadowOffsetY should be 8");
});

test("Canvas2DRenderer: pass-order — shape drawn before text", () => {
  const { canvas, calls } = makeMockCanvas();
  const renderer = new Canvas2DRenderer(canvas);

  const shape = makeRenderNode("sh", "shape", {
    type: "shape",
    kind: { type: "rectangle" },
    fill: rgba(1, 0, 0, 1),
    stroke: null,
    stroke_width: 0,
  });
  const text = makeRenderNode("tx", "text", {
    type: "text",
    content: "Label",
    color: rgba(1, 1, 1, 1),
    font_family: "sans-serif",
    font_size: 14,
    line_height: 1.4,
  });

  // Supply text before shape in the roots array — renderer must reorder.
  renderer.draw(makeRenderTree([shape, text], ["tx", "sh"]));

  const fills = calls.filter((c) => c.name === "fill");
  const textCalls = calls.filter((c) => c.name === "fillText");
  const lastFillIndex = calls.lastIndexOf(fills[fills.length - 1]);
  const firstTextIndex = calls.indexOf(textCalls[0]);
  // Shape fill should appear before text fillText in the call log.
  assert.ok(
    fills.length > 0 && textCalls.length > 0,
    "both fill and fillText must be called"
  );
  // Note: this assertion relies on the shape root being promoted before the text root.
  assert.ok(lastFillIndex < firstTextIndex || fills.length === 0, "shape fill before text fill");
});
