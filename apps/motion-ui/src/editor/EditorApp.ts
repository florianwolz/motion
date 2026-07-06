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
  parseTemplateCatalog,
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
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.1;
const DEFAULT_STAGGER_MS = 60;
const DEFAULT_CAMERA_FOCUS_ZOOM = 1.25;

let engine: EngineHandle | null = null;
let renderer: Canvas2DRenderer | null = null;
let autosaveTimer: number | null = null;
let timelinePreviewTimer: number | null = null;
let beforeUnloadRegistered = false;
let keyboardShortcutsRegistered = false;
let lastSavedSnapshot = "";
let currentZoom = 1;
type StepAction = "reveal" | "hide" | "focus" | "dim_others" | "camera_focus" | "staggered_reveal";

export async function mountEditor(container: HTMLElement): Promise<void> {
  container.innerHTML = buildShellHtml();

  const canvasEl = container.querySelector<HTMLCanvasElement>("#editor-canvas")!;
  canvasEl.style.touchAction = "none";
  renderer = new Canvas2DRenderer(canvasEl);
  currentZoom = 1;
  applyCanvasZoom(container);

  try {
    await initEngine();
    engine = createEngine();

    await loadInitialDocument(container);
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

async function loadInitialDocument(container: HTMLElement): Promise<void> {
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

  await loadDemoDocument(container, "Loaded demo document", "Loaded fresh demo document");
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
  container.querySelector("#btn-reset")?.addEventListener("click", async () => {
    await loadDemoDocument(container, "Reset to demo", "Document reset to demo");
    refreshEditorState(container);
  });
  container.querySelector("#btn-present")?.addEventListener("click", () => {
    saveDocument(container, "Saved for presentation");
    window.open("/presenter-view", "motion-presenter-view", "width=800,height=600,menubar=no,toolbar=no,location=no");
    const presenter = window.open("/present", "motion-presenter-stage");
    if (!presenter) {
      setToolbarMessage(container, "Presentation popup blocked by browser");
      return;
    }
    presenter.focus();
  });
  container.querySelector("#btn-step-reveal")?.addEventListener("click", () => addStepFromSelection(container, "reveal"));
  container.querySelector("#btn-step-hide")?.addEventListener("click", () => addStepFromSelection(container, "hide"));
  container.querySelector("#btn-step-focus")?.addEventListener("click", () => addStepFromSelection(container, "focus"));
  container.querySelector("#btn-step-camera")?.addEventListener("click", () => addStepFromSelection(container, "camera_focus"));
  container.querySelector("#btn-apply-template")?.addEventListener("click", () => applySelectedTemplate(container));
  container.querySelector("#btn-update-template")?.addEventListener("click", () => updateSelectedTemplateInstance(container));
  container.querySelector("#template-select")?.addEventListener("change", () => {
    resetTemplatePropertiesFromSelection(container);
    refreshTemplatePreview(container);
  });
  container.querySelector("#btn-share")?.addEventListener("click", () => {
    setToolbarMessage(container, "Share panel ready · Invite link copied");
  });

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

  container.querySelector("#btn-zoom-out")?.addEventListener("click", () => adjustCanvasZoom(container, -ZOOM_STEP));
  container.querySelector("#btn-zoom-in")?.addEventListener("click", () => adjustCanvasZoom(container, ZOOM_STEP));
  container.querySelector("#btn-zoom-reset")?.addEventListener("click", () => setCanvasZoom(container, 1, "Zoom reset"));

  updateZoomLabel(container);
  refreshTemplateBrowser(container);
}

function wireCanvas(container: HTMLElement): void {
  const canvas = container.querySelector<HTMLCanvasElement>("#editor-canvas");
  if (!canvas) return;

  const toCanvasPoint = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.clientWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.clientHeight / rect.height : 1;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
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

    if (hasModifier && (key === "+" || key === "=")) {
      event.preventDefault();
      adjustCanvasZoom(container, ZOOM_STEP);
      return;
    }

    if (hasModifier && key === "-") {
      event.preventDefault();
      adjustCanvasZoom(container, -ZOOM_STEP);
      return;
    }

    if (hasModifier && key === "0") {
      event.preventDefault();
      setCanvasZoom(container, 1, "Zoom reset");
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

function addStepFromSelection(container: HTMLElement, mode: StepAction): void {
  if (!engine) return;
  const inspector = parseInspector(engine.inspect());
  if (!inspector.scene_id || !inspector.selected) {
    setToolbarMessage(container, "Select a node first");
    return;
  }
  const staggerTargets = mode === "staggered_reveal"
    ? getStaggerTargetsForSelection(inspector.selected.id)
    : null;

  const command = buildAddStepCommand(
    inspector.scene_id,
    inspector.selected.id,
    inspector.selected.name,
    mode,
    staggerTargets,
  );

  engine.applyCommand(JSON.stringify(command));
  refreshEditorState(container);
  saveDocument(container, `Autosaved ${mode.replaceAll("_", " ")} step`);
  setToolbarMessage(container, `Added ${mode.replaceAll("_", " ")} step for ${inspector.selected.name}`);
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
  refreshTemplateBrowser(container);
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
    <label>Stagger delay (ms)<input data-property="animation.stagger_delay" type="number" step="1" min="0" value="${selected.animation.stagger_delay ?? ""}" placeholder="45" /></label>
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
      const value = getControlValue(control, property);
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
      ? `Enter: ${selected.animation.enter_preset ?? "—"} · Exit: ${selected.animation.exit_preset ?? "—"} · Stagger: ${selected.animation.stagger_delay ?? "—"}ms`
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

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

function applyCanvasZoom(container: HTMLElement): void {
  const stage = container.querySelector<HTMLElement>("#canvas-stage");
  if (!stage) return;
  stage.style.setProperty("--canvas-zoom", String(currentZoom));
  updateZoomLabel(container);
}

function updateZoomLabel(container: HTMLElement): void {
  const label = container.querySelector<HTMLElement>("#zoom-label");
  if (!label) return;
  label.textContent = `${Math.round(currentZoom * 100)}%`;
}

function setCanvasZoom(container: HTMLElement, value: number, message?: string): void {
  const nextZoom = clampZoom(value);
  if (nextZoom === currentZoom) return;
  currentZoom = nextZoom;
  applyCanvasZoom(container);
  if (message) setToolbarMessage(container, `${message} · ${Math.round(currentZoom * 100)}%`);
}

function adjustCanvasZoom(container: HTMLElement, delta: number): void {
  setCanvasZoom(container, currentZoom + delta, "Canvas zoom");
}

function getControlValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  property?: string,
): boolean | number | string | null {
  if (control instanceof HTMLInputElement && control.type === "checkbox") {
    return control.checked;
  }
  if (control instanceof HTMLInputElement && control.type === "number") {
    if (control.value.trim() === "" && property === "animation.stagger_delay") return null;
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

async function loadDemoDocument(
  container: HTMLElement,
  statusMessage: string,
  toolbarMessage: string,
): Promise<void> {
  if (!engine) return;
  const demo = buildDemoDocumentJson();
  engine.loadDocument(demo);
  lastSavedSnapshot = engine.serializeDocument();
  localStorage.setItem(AUTOSAVE_KEY, lastSavedSnapshot);
  updateAutosaveStatus(container, statusMessage);
  setToolbarMessage(container, toolbarMessage);
}

function buildAddStepCommand(
  sceneId: string,
  targetId: string,
  targetName: string,
  mode: StepAction,
  staggerTargets: string[] | null,
): Record<string, unknown> {
  const prettyMode = mode
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const semanticCommand =
    mode === "staggered_reveal"
      ? {
        type: mode,
        targets: (staggerTargets ?? [targetId]).map((id) => ({ Uuid: id })),
        stagger_ms: DEFAULT_STAGGER_MS,
      }
      : mode === "camera_focus"
        ? {
          type: mode,
          target: { Uuid: targetId },
          zoom: DEFAULT_CAMERA_FOCUS_ZOOM,
        }
        : {
          type: mode,
          target: { Uuid: targetId },
        };
  return {
    type: "add_step",
    scene_id: { Uuid: sceneId },
    name: `${prettyMode} ${targetName}`,
    commands: [semanticCommand],
    transition: null,
    notes: null,
  };
}

function getStaggerTargetsForSelection(selectedId: string): string[] {
  if (!engine) return [selectedId];
  const raw = safeParseJson<Record<string, unknown>>(engine.serializeDocument());
  const nodes = (raw?.nodes && typeof raw.nodes === "object")
    ? (raw.nodes as Record<string, unknown>)
    : {};
  const map = buildNodeMap(nodes);
  return map.get(selectedId)?.children ?? [selectedId];
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

function refreshTemplateBrowser(container: HTMLElement): void {
  if (!engine) return;
  const select = container.querySelector<HTMLSelectElement>("#template-select");
  if (!select) return;
  const catalog = parseTemplateCatalog(engine.listTemplates());
  const current = select.value;
  select.innerHTML = catalog
    .map((template) => `<option value="${escapeHtml(template.contract.id)}">${escapeHtml(template.contract.displayName)}</option>`)
    .join("");
  if (current && catalog.some((template) => template.contract.id === current)) {
    select.value = current;
  }

  const selected = catalog.find((template) => template.contract.id === select.value) ?? catalog[0];
  if (selected && !select.value) select.value = selected.contract.id;
  resetTemplatePropertiesFromSelection(container, { onlyIfEmpty: true });
  refreshTemplatePreview(container);
}

function refreshTemplatePreview(container: HTMLElement): void {
  if (!engine) return;
  const select = container.querySelector<HTMLSelectElement>("#template-select");
  const previewEl = container.querySelector<HTMLElement>("#template-preview");
  if (!select || !previewEl) return;
  const raw = engine.getTemplatePreview(select.value);
  const preview = safeParseJson<Record<string, unknown>>(raw);
  if (!preview) {
    previewEl.innerHTML = "<p class='inspector-hint'>No preview available.</p>";
    return;
  }
  const title = typeof preview.title === "string" ? preview.title : "Template";
  const subtitle = typeof preview.subtitle === "string" ? preview.subtitle : "";
  const thumbnail = typeof preview.thumbnail === "string" ? preview.thumbnail : "preview";
  previewEl.innerHTML = `
    <div class="template-preview-card">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(subtitle)}</p>
      <span class="template-preview-tag">${escapeHtml(thumbnail)}</span>
    </div>
  `;
}

function applySelectedTemplate(container: HTMLElement): void {
  if (!engine) return;
  const sceneId = parseInspector(engine.inspect()).scene_id;
  if (!sceneId) {
    setToolbarMessage(container, "Select a scene before inserting a template");
    return;
  }

  const select = container.querySelector<HTMLSelectElement>("#template-select");
  const form = container.querySelector<HTMLTextAreaElement>("#template-properties");
  const instanceInput = container.querySelector<HTMLInputElement>("#template-instance-id");
  if (!select || !form) return;

  const properties = parseTemplateProperties(form.value, container);
  if (!properties) return;

  try {
    const instanceId = engine.applyTemplate(sceneId, select.value, JSON.stringify(properties));
    if (instanceInput) instanceInput.value = instanceId;
    refreshEditorState(container);
    saveDocument(container, `Autosaved template insert: ${select.value}`);
    setToolbarMessage(container, `Inserted template ${select.value}`);
  } catch (error) {
    setToolbarMessage(container, `Template insert failed: ${String(error)}`);
  }
}

function updateSelectedTemplateInstance(container: HTMLElement): void {
  if (!engine) return;
  const sceneId = parseInspector(engine.inspect()).scene_id;
  const select = container.querySelector<HTMLSelectElement>("#template-select");
  const form = container.querySelector<HTMLTextAreaElement>("#template-properties");
  const instanceInput = container.querySelector<HTMLInputElement>("#template-instance-id");
  if (!sceneId || !select || !form || !instanceInput || !instanceInput.value.trim()) {
    setToolbarMessage(container, "Provide template instance id to update");
    return;
  }

  const properties = parseTemplateProperties(form.value, container);
  if (!properties) return;

  try {
    engine.updateTemplateInstance(sceneId, instanceInput.value.trim(), select.value, JSON.stringify(properties));
    refreshEditorState(container);
    saveDocument(container, `Autosaved template update: ${select.value}`);
    setToolbarMessage(container, `Updated template instance ${instanceInput.value.trim()}`);
  } catch (error) {
    setToolbarMessage(container, `Template update failed: ${String(error)}`);
  }
}

function parseTemplateProperties(value: string, container: HTMLElement): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setToolbarMessage(container, "Template properties must be a JSON object");
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    setToolbarMessage(container, "Template properties JSON is invalid");
    return null;
  }
}

function resetTemplatePropertiesFromSelection(
  container: HTMLElement,
  options: { onlyIfEmpty?: boolean } = {},
): void {
  if (!engine) return;
  const select = container.querySelector<HTMLSelectElement>("#template-select");
  const form = container.querySelector<HTMLTextAreaElement>("#template-properties");
  if (!select || !form) return;
  if (options.onlyIfEmpty && form.value.trim()) return;

  const catalog = parseTemplateCatalog(engine.listTemplates());
  const selected = catalog.find((template) => template.contract.id === select.value);
  if (!selected) return;
  const defaults: Record<string, string> = {
    title: selected.contract.preview.title,
    subtitle: selected.contract.preview.subtitle,
  };
  selected.contract.requiredInputs.forEach((key, index) => {
    if (!(key in defaults)) {
      defaults[key] = `${key}: ${selected.contract.displayName} ${index + 1}`;
    }
  });
  form.value = JSON.stringify(defaults, null, 2);
}

function buildShellHtml(): string {
  return `
    <div class="editor-shell">
      <main class="editor-main">
        <aside class="editor-layers">
          <h3>Scenes</h3>
          <ul id="scene-list"></ul>
          <h3 class="layers-heading">Layers</h3>
          <ul id="layer-list"></ul>
          <h3 class="layers-heading">Templates</h3>
          <div class="template-browser">
            <select id="template-select"></select>
            <textarea id="template-properties" rows="8" spellcheck="false" aria-label="Template properties JSON"></textarea>
            <input id="template-instance-id" type="text" placeholder="Instance node id (for updates)" />
            <div class="template-actions">
              <button id="btn-apply-template" title="Insert selected template into current scene">Insert</button>
              <button id="btn-update-template" title="Update existing template instance">Update</button>
            </div>
            <div id="template-preview"></div>
          </div>
        </aside>
        <section class="editor-canvas-wrap" id="canvas-container">
          <div class="canvas-status-row">
            <div id="toolbar-message" class="toolbar-message">Ready to edit</div>
            <div id="engine-error" class="engine-error" style="display:none"></div>
          </div>
          <div class="canvas-stage" id="canvas-stage">
            <canvas id="editor-canvas"></canvas>
            <div id="selection-overlay" class="selection-overlay"></div>
          </div>
          <div class="floating-toolbar">
            <button id="btn-undo" title="Undo (Ctrl+Z)">↩ Undo</button>
            <button id="btn-redo" title="Redo (Ctrl+Shift+Z)">↪ Redo</button>
            <button id="btn-step-reveal" title="Create reveal step from selection">Reveal</button>
            <button id="btn-step-hide" title="Create hide step from selection">Hide</button>
            <button id="btn-step-focus" title="Create focus step from selection">Focus</button>
            <button id="btn-step-camera" title="Create camera focus step from selection">Camera Focus</button>
            <button id="btn-preflight" title="Run preflight checks">Preflight</button>
            <button id="btn-brand" title="Load token JSON">Brand</button>
            <button id="btn-reset" title="Reset to a fresh demo document">Reset</button>
            <button id="btn-present" title="Open presentation mode">Present</button>
          </div>
          <div class="zoom-controls" aria-label="Canvas zoom controls">
            <button id="btn-zoom-out" title="Zoom out (Ctrl+-)">−</button>
            <button id="btn-zoom-reset" title="Reset zoom (Ctrl+0)"><span id="zoom-label">100%</span></button>
            <button id="btn-zoom-in" title="Zoom in (Ctrl++)">+</button>
          </div>
          <input id="brand-file-input" type="file" accept="application/json,.json" hidden />
        </section>
        <aside class="editor-inspector">
          <div class="collaboration-panel">
            <div class="collaboration-header">
              <h3>Collaboration</h3>
              <button id="btn-share" class="share-btn">Share</button>
            </div>
            <div class="collaborators">
              <span class="avatar" aria-label="Florian">FW</span>
              <span class="avatar" aria-label="Ana">AN</span>
              <span class="avatar" aria-label="Seline">SL</span>
            </div>
            <p class="collaboration-copy">Collaborators online · Live cursors enabled</p>
          </div>
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
      .editor-main { display: flex; flex: 1; overflow: hidden; }
      .editor-layers { width: 240px; background: #17171b; border-right: 1px solid #2a2a2e; padding: 12px; overflow-y: auto; flex-shrink: 0; }
      .editor-layers h3, .editor-inspector h3 { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 8px; letter-spacing: 0.5px; }
      .scene-item { padding: 6px 8px; border-radius: 4px; cursor: pointer; list-style: none; }
      .scene-item:hover, .scene-item.active { background: #2a2a2e; }
      .step-count { color: #666; font-size: 11px; }
      .layers-heading { margin-top: 14px; }
      .template-browser { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
      .template-browser select,
      .template-browser textarea,
      .template-browser input { background: #111113; border: 1px solid #2a2a2e; color: #f2f2f2; border-radius: 6px; padding: 7px 8px; font: inherit; }
      .template-browser textarea { resize: vertical; min-height: 88px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
      .template-actions { display: flex; gap: 6px; }
      .template-actions button { flex: 1; padding: 6px 10px; background: #2b2b34; border: 1px solid #3b3b44; border-radius: 8px; color: #f0f0f5; cursor: pointer; font-size: 12px; }
      .template-actions button:hover { background: #3a3a45; }
      .template-preview-card { border: 1px solid #2e2e38; border-radius: 8px; padding: 8px; background: #1a1a20; display: flex; flex-direction: column; gap: 4px; }
      .template-preview-card p { color: #b5b5bf; font-size: 11px; }
      .template-preview-tag { display: inline-flex; align-self: flex-start; padding: 2px 6px; border-radius: 999px; border: 1px solid #3a3a45; color: #8f93a6; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
      .layer-item { list-style: none; padding: 5px 8px; border-radius: 4px; cursor: pointer; color: #cfcfd4; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .layer-item:hover, .layer-item.active { background: #2a2a2e; color: #fff; }
      .editor-canvas-wrap { flex: 1; background: radial-gradient(circle at top, #25252d 0%, #16161b 46%, #111113 100%); overflow: hidden; position: relative; padding: 18px; }
      .canvas-status-row { position: absolute; top: 14px; left: 16px; right: 16px; z-index: 3; display: flex; justify-content: space-between; align-items: center; pointer-events: none; }
      .toolbar-message { color: #d8d8dd; font-size: 11px; background: rgba(21,21,24,0.74); border: 1px solid rgba(255,255,255,0.07); border-radius: 999px; padding: 5px 10px; backdrop-filter: blur(8px); }
      .engine-error { text-align: right; color: #ff6b6b; font-size: 12px; }
      .canvas-stage { position: relative; width: 100%; height: 100%; border-radius: 12px; border: 1px solid #2d2d33; background: #0f0f13; overflow: hidden; transform: scale(var(--canvas-zoom, 1)); transform-origin: center center; transition: transform 140ms ease; }
      #editor-canvas { width: 100%; height: 100%; display: block; }
      .selection-overlay { position: absolute; inset: 0; pointer-events: none; }
      .selection-box { position: absolute; border: 1px solid #EC6602; box-shadow: 0 0 0 1px rgba(236,102,2,0.25); }
      .selection-tag { position: absolute; top: -20px; left: 0; padding: 2px 6px; background: rgba(236,102,2,0.9); color: #fff; font-size: 11px; border-radius: 4px; }
      .handle { position: absolute; width: 8px; height: 8px; background: #EC6602; border: 1px solid #fff; border-radius: 999px; }
      .handle.nw { top: -4px; left: -4px; }
      .handle.ne { top: -4px; right: -4px; }
      .handle.sw { bottom: -4px; left: -4px; }
      .handle.se { bottom: -4px; right: -4px; }
      .floating-toolbar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 4; display: flex; gap: 8px; background: rgba(19,19,24,0.92); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 8px; backdrop-filter: blur(12px); box-shadow: 0 8px 26px rgba(0,0,0,0.35); }
      .floating-toolbar button,
      .zoom-controls button,
      .share-btn { padding: 6px 10px; background: #2b2b34; border: 1px solid #3b3b44; border-radius: 8px; color: #f0f0f5; cursor: pointer; font-size: 12px; }
      .floating-toolbar button:hover,
      .zoom-controls button:hover,
      .share-btn:hover { background: #3a3a45; }
      .zoom-controls { position: absolute; right: 24px; bottom: 20px; z-index: 4; display: flex; gap: 6px; background: rgba(19,19,24,0.92); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 6px; }
      #zoom-label { min-width: 48px; display: inline-block; text-align: center; font-variant-numeric: tabular-nums; }
      .editor-inspector { width: 320px; background: #18181d; border-left: 1px solid #2a2a2e; padding: 12px; overflow-y: auto; flex-shrink: 0; }
      .collaboration-panel { background: #1f1f25; border: 1px solid #2e2e38; border-radius: 10px; padding: 10px; margin-bottom: 12px; }
      .collaboration-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      .collaborators { display: flex; gap: 8px; margin-bottom: 8px; }
      .avatar { width: 26px; height: 26px; border-radius: 999px; background: linear-gradient(140deg, #5a56ff, #8f4dff); color: #fff; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.24); }
      .collaboration-copy { color: #a3a3ae; font-size: 11px; }
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
