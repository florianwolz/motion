/**
 * Authoring mode — Figma-like editor shell.
 */

import {
  createEngine,
  initEngine,
  parseInspector,
  parsePosition,
  parsePreflight,
  parseRenderTree,
  parseSceneList,
  parseSelection,
} from "../lib/engine.js";
import { isSupportedSavedDocument } from "../lib/documentState.js";
import type { EngineHandle } from "../lib/engine.js";
import { Canvas2DRenderer } from "../lib/renderer.js";
import { buildDemoDocumentJson } from "./demo.js";

const AUTOSAVE_KEY = "motion-current-doc";
const AUTOSAVE_INTERVAL_MS = 1500;
const LAYER_BASE_INDENT_PX = 8;
const LAYER_INDENT_PER_LEVEL_PX = 12;
const LEGACY_UUID_INDEX = 0;

let engine: EngineHandle | null = null;
let renderer: Canvas2DRenderer | null = null;
let autosaveTimer: number | null = null;
let timelinePreviewTimer: number | null = null;
let beforeUnloadRegistered = false;
let keyboardShortcutsRegistered = false;
let lastSavedSnapshot = "";

export async function mountEditor(container: HTMLElement): Promise<void> {
  container.innerHTML = buildShellHtml();

  const canvasEl = container.querySelector<HTMLCanvasElement>("#editor-canvas")!;
  canvasEl.style.touchAction = "none";
  renderer = new Canvas2DRenderer(canvasEl);

  try {
    await initEngine();
    engine = createEngine();

    loadInitialDocument(container);
    wireToolbar(container);
    wireCanvas(container);
    wireKeyboardShortcuts(container);
    refreshEditorState(container);
    startAutosave(container);
    startRenderLoop(container);
  } catch (err) {
    console.error("Failed to initialize WASM engine:", err);
    showEngineError(container, err);
  }
}

function loadInitialDocument(container: HTMLElement): void {
  if (!engine) return;

  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved && isSupportedSavedDocument(saved)) {
    try {
      engine.loadDocument(saved);
      if (parseSceneList(engine.listScenes()).length === 0) {
        throw new Error("saved document has no scenes");
      }
      lastSavedSnapshot = saved;
      updateAutosaveStatus(container, "Restored autosave");
      return;
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
  }

  loadDemoDocument(container, "Loaded demo document", "Loaded fresh demo document");
}

function startRenderLoop(container: HTMLElement): void {
  function frame(ts: number) {
    if (!engine || !renderer) return;

    const canvas = container.querySelector<HTMLCanvasElement>("#editor-canvas");
    if (!canvas) return;

    const w = canvas.clientWidth || 960;
    const h = canvas.clientHeight || 540;
    const dpr = window.devicePixelRatio ?? 1;
    engine.setViewport(w, h, dpr);

    const treeJson = engine.render(ts);
    const tree = parseRenderTree(treeJson);
    if (tree) renderer.draw(tree);

    renderSelectionOverlay(container);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function wireToolbar(container: HTMLElement): void {
  container.querySelector("#btn-undo")?.addEventListener("click", () => {
    if (!engine?.undo()) return;
    refreshEditorState(container);
    saveDocument(container, "Saved after undo");
  });

  container.querySelector("#btn-redo")?.addEventListener("click", () => {
    if (!engine?.redo()) return;
    refreshEditorState(container);
    saveDocument(container, "Saved after redo");
  });

  container.querySelector("#btn-preflight")?.addEventListener("click", () => showPreflight(container));
  container.querySelector("#btn-reset")?.addEventListener("click", () => {
    loadDemoDocument(container, "Reset to demo", "Document reset to demo");
    refreshEditorState(container);
  });
  container.querySelector("#btn-present")?.addEventListener("click", () => {
    saveDocument(container, "Saved for presentation");
    window.open("/present", "_blank");
  });
  container.querySelector("#btn-step-reveal")?.addEventListener("click", () => addStepFromSelection(container, "reveal"));
  container.querySelector("#btn-step-hide")?.addEventListener("click", () => addStepFromSelection(container, "hide"));

  const brandInput = container.querySelector<HTMLInputElement>("#brand-file-input");
  container.querySelector("#btn-brand")?.addEventListener("click", () => brandInput?.click());
  brandInput?.addEventListener("change", async () => {
    const file = brandInput.files?.[0];
    if (!file || !engine) return;
    try {
      const contents = await file.text();
      engine.loadBrandPackage(contents);
      refreshEditorState(container);
      saveDocument(container, `Loaded brand tokens from ${file.name}`);
      setToolbarMessage(container, `Brand tokens loaded: ${file.name}`);
    } catch (error) {
      setToolbarMessage(container, `Brand load failed: ${String(error)}`);
    } finally {
      brandInput.value = "";
    }
  });
}

function wireCanvas(container: HTMLElement): void {
  const canvas = container.querySelector<HTMLCanvasElement>("#editor-canvas");
  if (!canvas) return;

  const toCanvasPoint = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (!engine) return;
    const point = toCanvasPoint(event);
    canvas.setPointerCapture(event.pointerId);
    engine.pointerDown(point.x, point.y, 0);
    refreshEditorState(container);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!engine) return;
    const point = toCanvasPoint(event);
    engine.pointerMove(point.x, point.y);
    renderSelectionOverlay(container);
  });

  const finishPointer = (event: PointerEvent) => {
    if (!engine) return;
    const point = toCanvasPoint(event);
    engine.pointerUp(point.x, point.y);
    refreshEditorState(container);
    saveDocument(container, "Autosaved after canvas edit");
  };

  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
}

function wireKeyboardShortcuts(container: HTMLElement): void {
  if (keyboardShortcutsRegistered) return;
  window.addEventListener("keydown", (event) => {
    if (!engine) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    const key = event.key.toLowerCase();
    const hasModifier = event.metaKey || event.ctrlKey;

    if (hasModifier && key === "z") {
      event.preventDefault();
      const ok = event.shiftKey ? engine.redo() : engine.undo();
      if (ok) {
        refreshEditorState(container);
        saveDocument(container, event.shiftKey ? "Saved after redo" : "Saved after undo");
      }
      return;
    }

    if (hasModifier && key === "y") {
      event.preventDefault();
      if (engine.redo()) {
        refreshEditorState(container);
        saveDocument(container, "Saved after redo");
      }
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      if (engine.nextStep()) refreshTimeline(container);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      if (engine.previousStep()) refreshTimeline(container);
      return;
    }

    if (key === "r") {
      event.preventDefault();
      engine.restartScene();
      refreshTimeline(container);
    }
  });
  keyboardShortcutsRegistered = true;
}

function addStepFromSelection(container: HTMLElement, mode: "reveal" | "hide"): void {
  if (!engine) return;
  const inspector = parseInspector(engine.inspect());
  if (!inspector.scene_id || !inspector.selected) {
    setToolbarMessage(container, "Select a node first");
    return;
  }

  const command = buildAddStepCommand(
    inspector.scene_id,
    inspector.selected.id,
    inspector.selected.name,
    mode
  );

  engine.applyCommand(JSON.stringify(command));
  refreshEditorState(container);
  saveDocument(container, `Autosaved ${mode} step`);
  setToolbarMessage(container, `Added ${mode} step for ${inspector.selected.name}`);
}

function showPreflight(container: HTMLElement): void {
  if (!engine) return;
  const report = parsePreflight(engine.runPreflight());
  const el = container.querySelector("#preflight-panel");
  if (!el) return;
  const icon = report.status === "ready" ? "✅" : report.status === "warning" ? "⚠️" : "❌";
  el.innerHTML = `
    <strong>${icon} Preflight ${report.status}</strong>
    <ul>
      ${report.checks
        .map(
          (c) =>
            `<li class="${c.passed ? "ok" : c.severity}">${c.passed ? "✓" : "✗"} ${c.message}</li>`
        )
        .join("")}
    </ul>
  `;
  (el as HTMLElement).style.display = "block";
}

function refreshEditorState(container: HTMLElement): void {
  refreshSceneList(container);
  refreshLayers(container);
  refreshInspector(container);
  refreshTimeline(container);
  renderSelectionOverlay(container);
}

function refreshSceneList(container: HTMLElement): void {
  if (!engine) return;
  const scenes = parseSceneList(engine.listScenes());
  const position = parsePosition(engine.getPosition());
  const el = container.querySelector("#scene-list");
  if (!el) return;

  el.innerHTML = scenes
    .map(
      (scene, index) => `
        <li class="scene-item ${index === position.scene_idx ? "active" : ""}" data-id="${scene.id}">
          ${scene.name} <span class="step-count">(${scene.step_count} steps)</span>
        </li>
      `
    )
    .join("");

  el.querySelectorAll<HTMLElement>(".scene-item").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.dataset.id;
      if (!id || !engine?.jumpToScene(id)) return;
      refreshEditorState(container);
    });
  });
}

function refreshLayers(container: HTMLElement): void {
  if (!engine) return;
  const layerList = container.querySelector<HTMLElement>("#layer-list");
  if (!layerList) return;

  const raw = safeParseJson<Record<string, unknown>>(engine.serializeDocument());
  const scenes = (raw?.scenes as unknown[]) ?? [];
  const position = parsePosition(engine.getPosition());
  const scene = scenes[position.scene_idx] as Record<string, unknown> | undefined;
  if (!scene) {
    layerList.innerHTML = "";
    return;
  }

  const rootId = parseUuid((scene as { root?: unknown }).root);
  const nodesById = buildNodeMap((raw?.nodes as Record<string, unknown>) ?? {});
  const selectedId = parseInspector(engine.inspect()).selected?.id ?? null;
  if (!rootId || !nodesById.has(rootId)) {
    layerList.innerHTML = "";
    return;
  }

  const rows: string[] = [];
  const walk = (nodeId: string, depth: number) => {
    const node = nodesById.get(nodeId);
    if (!node) return;
    const active = selectedId === nodeId ? "active" : "";
    rows.push(
      `<li class="layer-item ${active}" data-id="${escapeHtml(nodeId)}" style="padding-left:${LAYER_BASE_INDENT_PX + depth * LAYER_INDENT_PER_LEVEL_PX}px">${escapeHtml(node.name)}</li>`
    );
    node.children.forEach((child) => walk(child, depth + 1));
  };
  walk(rootId, 0);

  layerList.innerHTML = rows.join("");
  layerList.querySelectorAll<HTMLElement>(".layer-item").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.dataset.id;
      if (!id) return;
      if (!engine?.selectNode(id)) {
        setToolbarMessage(container, `Unable to select layer ${item.textContent?.trim() ?? id}: invalid or outside current scene`);
        return;
      }
      setToolbarMessage(container, `Selected layer ${item.textContent?.trim() ?? "node"}`);
      refreshEditorState(container);
    });
  });
}

function refreshInspector(container: HTMLElement): void {
  if (!engine) return;

  const inspector = parseInspector(engine.inspect());
  const selection = parseSelection(engine.getSelection());
  const body = container.querySelector<HTMLElement>("#inspector-body");
  if (!body) return;

  if (!inspector.selected) {
    body.innerHTML = `
      <p class="inspector-hint">Select a node to inspect its properties.</p>
      <p class="selection-summary">Current selection: ${selection.length}</p>
    `;
    return;
  }

  const { selected } = inspector;
  body.innerHTML = `
    <div class="selection-summary">Selected: <strong>${selected.name}</strong> <span class="inspector-type">${selected.node_type}</span></div>
    <label>Name<input data-property="name" type="text" value="${escapeHtml(selected.name)}" /></label>
    <div class="inspector-grid">
      <label>X<input data-property="transform.x" type="number" step="1" value="${selected.transform.x}" /></label>
      <label>Y<input data-property="transform.y" type="number" step="1" value="${selected.transform.y}" /></label>
      <label>W<input data-property="transform.width" type="number" step="1" min="24" value="${selected.transform.width}" /></label>
      <label>H<input data-property="transform.height" type="number" step="1" min="24" value="${selected.transform.height}" /></label>
      <label>Rotation<input data-property="transform.rotation" type="number" step="1" value="${selected.transform.rotation}" /></label>
      <label>Opacity<input data-property="style.opacity" type="number" step="0.05" min="0" max="1" value="${selected.opacity}" /></label>
    </div>
    <label class="checkbox-row"><input data-property="visible" type="checkbox" ${selected.visible ? "checked" : ""} /> Visible</label>
    <label class="checkbox-row"><input data-property="locked" type="checkbox" ${selected.locked ? "checked" : ""} /> Locked</label>
    <label>Enter preset<input data-property="animation.enter_preset" type="text" value="${escapeHtml(selected.animation.enter_preset ?? "")}" placeholder="fade_in" /></label>
    <label>Exit preset<input data-property="animation.exit_preset" type="text" value="${escapeHtml(selected.animation.exit_preset ?? "")}" placeholder="fade_out" /></label>
    ${selected.text ? `
      <label>Text content<textarea data-property="content" rows="4">${escapeHtml(selected.text.content)}</textarea></label>
      <label>Font size<input data-property="font_size" type="number" step="1" min="1" value="${selected.text.font_size ?? 16}" /></label>
    ` : ""}
  `;

  body.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-property]").forEach((control) => {
    control.addEventListener("change", () => {
      if (!engine || !inspector.scene_id) return;
      const property = control.dataset.property;
      if (!property) return;
      const value = getControlValue(control);
      const command = {
        type: "set_property",
        scene_id: inspector.scene_id,
        node_id: selected.id,
        property,
        value,
      };

      engine.applyCommand(JSON.stringify(command));
      refreshEditorState(container);
      saveDocument(container, `Autosaved ${property}`);
    });
  });
}

function refreshTimeline(container: HTMLElement): void {
  if (!engine) return;
  const scenes = parseSceneList(engine.listScenes());
  const position = parsePosition(engine.getPosition());
  const scene = scenes[position.scene_idx];
  const slider = container.querySelector<HTMLInputElement>("#timeline-scrubber");
  const label = container.querySelector<HTMLElement>("#timeline-label");
  const presetLabel = container.querySelector<HTMLElement>("#timeline-preset-label");
  if (!slider || !label || !scene) return;

  slider.max = String(scene.step_count);
  slider.value = String(position.step_idx === null ? 0 : position.step_idx + 1);
  label.textContent = slider.value === "0" ? "Preview: scene intro" : `Preview: step ${slider.value} / ${scene.step_count}`;

  const selected = parseInspector(engine.inspect()).selected;
  if (presetLabel) {
    presetLabel.textContent = selected
      ? `Enter: ${selected.animation.enter_preset ?? "—"} · Exit: ${selected.animation.exit_preset ?? "—"}`
      : "Select a node to inspect enter/exit presets.";
  }

  slider.oninput = () => {
    if (!engine) return;
    if (timelinePreviewTimer !== null) window.clearTimeout(timelinePreviewTimer);
    timelinePreviewTimer = window.setTimeout(() => {
      if (!engine) return;
      engine.restartScene();
      const stepsToApply = Number(slider.value);
      for (let index = 0; index < stepsToApply; index += 1) {
        engine.nextStep();
      }
      refreshTimeline(container);
    }, 16);
  };
}

function renderSelectionOverlay(container: HTMLElement): void {
  if (!engine) return;
  const overlay = container.querySelector<HTMLElement>("#selection-overlay");
  if (!overlay) return;

  const selected = parseInspector(engine.inspect()).selected;
  if (!selected) {
    overlay.innerHTML = "";
    return;
  }

  const bounds = selected.absolute_transform;
  overlay.innerHTML = `
    <div class="selection-box" style="left:${bounds.x}px; top:${bounds.y}px; width:${bounds.width}px; height:${bounds.height}px;">
      <span class="selection-tag">${escapeHtml(selected.name)}</span>
      <span class="handle nw"></span>
      <span class="handle ne"></span>
      <span class="handle sw"></span>
      <span class="handle se"></span>
    </div>
  `;
}

function startAutosave(container: HTMLElement): void {
  if (autosaveTimer !== null) window.clearInterval(autosaveTimer);
  autosaveTimer = window.setInterval(() => saveDocument(container, "Autosaved"), AUTOSAVE_INTERVAL_MS);
  if (!beforeUnloadRegistered) {
    window.addEventListener("beforeunload", () => saveDocument(container, "Saved before unload"));
    beforeUnloadRegistered = true;
  }
}

function saveDocument(container: HTMLElement, message: string): void {
  if (!engine) return;
  const serialized = engine.serializeDocument();
  if (serialized === lastSavedSnapshot) return;
  localStorage.setItem(AUTOSAVE_KEY, serialized);
  lastSavedSnapshot = serialized;
  updateAutosaveStatus(container, message);
}

function updateAutosaveStatus(container: HTMLElement, message: string): void {
  const status = container.querySelector<HTMLElement>("#autosave-status");
  if (status) {
    status.textContent = `${message} · ${new Date().toLocaleTimeString()}`;
  }
}

function setToolbarMessage(container: HTMLElement, message: string): void {
  const el = container.querySelector<HTMLElement>("#toolbar-message");
  if (el) el.textContent = message;
}

function getControlValue(control: HTMLInputElement | HTMLTextAreaElement): boolean | number | string | null {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    return control.checked;
  }
  if (control instanceof HTMLInputElement && control.type === "number") {
    return Number(control.value);
  }
  const trimmed = control.value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function showEngineError(container: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const banner = container.querySelector<HTMLElement>("#engine-error");
  if (banner) {
    banner.textContent = `⚠ Engine unavailable: ${msg}`;
    banner.style.display = "block";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type SerializedNode = {
  id: string;
  name: string;
  children: string[];
};

function safeParseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function parseUuid(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  // Some legacy JSON payloads encode tuple-struct UUIDs with an index key (`{ "0": "..." }`).
  // This keeps autosaved payload compatibility when older documents are loaded.
  const known = candidate.Uuid ?? candidate.uuid ?? candidate[LEGACY_UUID_INDEX];
  return typeof known === "string" ? known : null;
}

function loadDemoDocument(container: HTMLElement, statusMessage: string, toolbarMessage: string): void {
  if (!engine) return;
  const demo = buildDemoDocumentJson();
  engine.loadDocument(demo);
  lastSavedSnapshot = demo;
  localStorage.setItem(AUTOSAVE_KEY, demo);
  updateAutosaveStatus(container, statusMessage);
  setToolbarMessage(container, toolbarMessage);
}

function buildAddStepCommand(
  sceneId: string,
  targetId: string,
  targetName: string,
  mode: "reveal" | "hide"
): Record<string, unknown> {
  return {
    type: "add_step",
    scene_id: { Uuid: sceneId },
    name: `${mode === "reveal" ? "Reveal" : "Hide"} ${targetName}`,
    commands: [
      {
        type: mode,
        target: { Uuid: targetId },
      },
    ],
    transition: null,
    notes: null,
  };
}

function buildNodeMap(nodes: Record<string, unknown>): Map<string, SerializedNode> {
  const map = new Map<string, SerializedNode>();
  Object.values(nodes).forEach((rawNode) => {
    if (!rawNode || typeof rawNode !== "object") return;
    const node = rawNode as Record<string, unknown>;
    const id = parseUuid(node.id);
    const name = typeof node.name === "string" ? node.name : "Node";
    const children = Array.isArray(node.children)
      ? node.children
        .map((child) => parseUuid(child))
        .filter((child): child is string => Boolean(child))
      : [];
    if (!id) return;
    map.set(id, { id, name, children });
  });
  return map;
}

function buildShellHtml(): string {
  return `
    <div class="editor-shell">
      <header class="editor-toolbar">
        <span class="editor-logo">Motion</span>
        <div class="toolbar-actions">
          <button id="btn-undo" title="Undo (Ctrl+Z)">↩ Undo</button>
          <button id="btn-redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
          <button id="btn-step-reveal" title="Create reveal step from selection">+ Reveal step</button>
          <button id="btn-step-hide" title="Create hide step from selection">+ Hide step</button>
          <button id="btn-preflight" title="Run preflight checks">🔍 Preflight</button>
          <button id="btn-reset" title="Reset to a fresh demo document">⟲ Reset demo</button>
          <button id="btn-brand" title="Load token JSON">🎨 Load brand</button>
          <button id="btn-present" title="Open presentation mode">▶ Present</button>
        </div>
        <div id="toolbar-message" class="toolbar-message"></div>
        <div id="engine-error" class="engine-error" style="display:none"></div>
        <input id="brand-file-input" type="file" accept="application/json,.json" hidden />
      </header>
      <main class="editor-main">
        <aside class="editor-layers">
          <h3>Scenes</h3>
          <ul id="scene-list"></ul>
          <h3 class="layers-heading">Layers</h3>
          <ul id="layer-list"></ul>
        </aside>
        <section class="editor-canvas-wrap" id="canvas-container">
          <canvas id="editor-canvas"></canvas>
          <div id="selection-overlay" class="selection-overlay"></div>
        </section>
        <aside class="editor-inspector">
          <h3>Inspector</h3>
          <div id="preflight-panel" class="preflight-panel" style="display:none"></div>
          <div id="inspector-body"></div>
          <p id="autosave-status" class="autosave-status"></p>
        </aside>
      </main>
      <footer class="editor-timeline">
        <label class="timeline-row">
          <span id="timeline-label">Preview: scene intro</span>
          <input id="timeline-scrubber" type="range" min="0" max="0" value="0" />
        </label>
        <span id="timeline-preset-label" class="timeline-preset-label">Select a node to inspect enter/exit presets.</span>
      </footer>
    </div>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0d0d0f; color: #e0e0e0; font-family: system-ui, sans-serif; font-size: 13px; }
      .editor-shell { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
      .editor-toolbar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; background: #1a1a1e; border-bottom: 1px solid #2a2a2e; flex-shrink: 0; }
      .editor-logo { font-weight: 700; font-size: 15px; color: #EC6602; margin-right: 8px; }
      .toolbar-actions { display: flex; gap: 6px; }
      .toolbar-actions button { padding: 4px 10px; background: #2a2a2e; border: 1px solid #3a3a3e; border-radius: 4px; color: #e0e0e0; cursor: pointer; font-size: 12px; }
      .toolbar-actions button:hover { background: #3a3a3e; }
      .toolbar-message { color: #8c8c92; font-size: 11px; min-width: 180px; }
      .engine-error { flex: 1; text-align: right; color: #ff6b6b; font-size: 12px; }
      .editor-main { display: flex; flex: 1; overflow: hidden; }
      .editor-layers { width: 220px; background: #161618; border-right: 1px solid #2a2a2e; padding: 10px; overflow-y: auto; flex-shrink: 0; }
      .editor-layers h3, .editor-inspector h3 { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 8px; letter-spacing: 0.5px; }
      .scene-item { padding: 6px 8px; border-radius: 4px; cursor: pointer; list-style: none; }
      .scene-item:hover, .scene-item.active { background: #2a2a2e; }
      .step-count { color: #666; font-size: 11px; }
      .layers-heading { margin-top: 14px; }
      .layer-item { list-style: none; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: #cfcfd4; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .layer-item:hover, .layer-item.active { background: #2a2a2e; color: #fff; }
      .editor-canvas-wrap { flex: 1; background: #111113; display: flex; align-items: center; justify-content: center; overflow: hidden; position: relative; }
      #editor-canvas { width: 100%; height: 100%; display: block; }
      .selection-overlay { position: absolute; inset: 0; pointer-events: none; }
      .selection-box { position: absolute; border: 1px solid #EC6602; box-shadow: 0 0 0 1px rgba(236,102,2,0.25); }
      .selection-tag { position: absolute; top: -20px; left: 0; padding: 2px 6px; background: rgba(236,102,2,0.9); color: #fff; font-size: 11px; border-radius: 4px; }
      .handle { position: absolute; width: 8px; height: 8px; background: #EC6602; border: 1px solid #fff; border-radius: 999px; }
      .handle.nw { top: -4px; left: -4px; }
      .handle.ne { top: -4px; right: -4px; }
      .handle.sw { bottom: -4px; left: -4px; }
      .handle.se { bottom: -4px; right: -4px; }
      .editor-inspector { width: 280px; background: #161618; border-left: 1px solid #2a2a2e; padding: 10px; overflow-y: auto; flex-shrink: 0; }
      .preflight-panel { background: #1a1a1e; border: 1px solid #2a2a2e; border-radius: 6px; padding: 10px; margin-bottom: 12px; font-size: 12px; }
      .preflight-panel ul { list-style: none; margin-top: 6px; }
      .preflight-panel li { padding: 2px 0; }
      .preflight-panel li.error { color: #ff6b6b; }
      .preflight-panel li.warning { color: #ffd93d; }
      .preflight-panel li.ok { color: #6bcb77; }
      #inspector-body { display: flex; flex-direction: column; gap: 10px; }
      #inspector-body label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #b0b0b5; }
      #inspector-body input, #inspector-body textarea { background: #111113; border: 1px solid #2a2a2e; color: #f2f2f2; border-radius: 4px; padding: 6px 8px; font: inherit; }
      .checkbox-row { flex-direction: row !important; align-items: center; gap: 8px !important; }
      .checkbox-row input { width: auto; }
      .inspector-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .selection-summary { color: #d5d5da; font-size: 12px; }
      .inspector-type { color: #8c8c92; text-transform: uppercase; font-size: 10px; margin-left: 4px; }
      .autosave-status { margin-top: 12px; color: #6bcb77; font-size: 11px; }
      .inspector-hint { color: #555; font-size: 11px; margin-top: 4px; }
      .editor-timeline { padding: 8px 12px; background: #1a1a1e; border-top: 1px solid #2a2a2e; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .timeline-row { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 320px; color: #d5d5da; }
      #timeline-scrubber { flex: 1; }
      .timeline-preset-label { color: #8c8c92; font-size: 11px; }
    </style>
  `;
}
