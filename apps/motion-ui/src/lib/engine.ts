/**
 * Thin TypeScript wrapper around the MotionEngine WASM instance.
 *
 * The actual WASM module is compiled from `crates/motion-wasm` using
 * `wasm-pack build --target web`.  This wrapper provides typed helpers and
 * manages the WASM lifecycle.
 */

import type { InspectorData, PreflightReport, SelectionItem } from "./types.js";
import type { RenderTree } from "./renderer.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wasmModule: any = null;

/**
 * Load and initialize the WASM module.  Must be called before any other
 * engine function.
 */
export async function initEngine(): Promise<void> {
  // Dynamic import so Vite can handle WASM initialisation.
  const mod = await import("@motion/engine");
  await mod.default(); // runs wasm-bindgen init
  _wasmModule = mod;
}

function requireEngine(): NonNullable<typeof _wasmModule> {
  if (_wasmModule === null) {
    throw new Error("MotionEngine not initialized. Call initEngine() first.");
  }
  return _wasmModule;
}

export function createEngine() {
  const mod = requireEngine();
  return new mod.MotionEngine() as EngineHandle;
}

/** Strongly-typed façade over the raw WASM MotionEngine instance. */
export interface EngineHandle {
  loadDocument(documentJson: string): void;
  loadBrandPackage(packageJson: string): void;
  listTemplates(): string;
  getTemplatePreview(templateId: string): string;
  applyTemplate(sceneId: string, templateId: string, propertiesJson: string): string;
  updateTemplateInstance(sceneId: string, instanceNodeId: string, templateId: string, propertiesJson: string): void;
  loadDeckBundle(bundleJson: string): void;
  getBundleManifest(): string;
  getPresenterState(): string;
  setViewport(width: number, height: number, scale: number): void;
  /** Returns the current scene's render tree as a JSON string. */
  render(timestamp: number): string;
  pointerDown(x: number, y: number, modifiers: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(x: number, y: number): void;
  applyCommand(commandJson: string): void;
  undo(): boolean;
  redo(): boolean;
  nextStep(): boolean;
  previousStep(): boolean;
  jumpToScene(sceneId: string): boolean;
  selectNode(nodeId: string): boolean;
  restartScene(): void;
  getPosition(): string;
  getSelection(): string;
  inspect(): string;
  runPreflight(): string;
  serializeDocument(): string;
  listScenes(): string;
}

export function parsePreflight(json: string): PreflightReport {
  return JSON.parse(json) as PreflightReport;
}

export function parseRenderTree(json: string): RenderTree | null {
  try {
    const tree = JSON.parse(json) as RenderTree;
    if (!tree.nodes) return null;
    return tree;
  } catch {
    return null;
  }
}

export function parseSceneList(json: string): Array<{ id: string; name: string; step_count: number }> {
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export function parsePosition(json: string): { scene_idx: number; step_idx: number | null } {
  try {
    return JSON.parse(json);
  } catch {
    return { scene_idx: 0, step_idx: null };
  }
}

export function parseSelection(json: string): SelectionItem[] {
  try {
    return JSON.parse(json) as SelectionItem[];
  } catch {
    return [];
  }
}

export function parseInspector(json: string): InspectorData {
  try {
    return JSON.parse(json) as InspectorData;
  } catch {
    return { scene_id: null, selected: null };
  }
}

export interface PresenterState {
  scene_idx: number;
  step_idx: number | null;
  scene_name: string;
  scene_notes: string;
  scene_count: number;
  step_name: string;
  step_notes: string;
  step_count: number;
  next_label: string;
}

export function parsePresenterState(json: string): PresenterState {
  try {
    return JSON.parse(json) as PresenterState;
  } catch {
    return {
      scene_idx: 0,
      step_idx: null,
      scene_name: "",
      scene_notes: "",
      scene_count: 0,
      step_name: "",
      step_notes: "",
      step_count: 0,
      next_label: "",
    };
  }
}

export interface DeckManifest {
  format_version: string;
  engine_version: string;
  title: string;
  scene_count: number;
  total_steps: number;
  has_notes: boolean;
  asset_count: number;
  compiled_at: string;
}

export interface TemplateContract {
  id: string;
  version: string;
  displayName: string;
  category: string;
  requiredInputs: string[];
  optionalInputs: string[];
  semanticSlots: string[];
  defaultSteps: string[];
  tokenBindings: string[];
  /** Mode overrides keyed by mode name (e.g. teams, pdf, projector, executive, technical). */
  modeBehavior: Record<string, string>;
  preview: {
    title: string;
    subtitle: string;
    thumbnail: string;
  };
}

export interface TemplateDefinition {
  schemaVersion: string;
  engineCompatibility: string;
  contract: TemplateContract;
}

export function parseBundleManifest(json: string): DeckManifest | null {
  try {
    return JSON.parse(json) as DeckManifest;
  } catch {
    return null;
  }
}

export function parseTemplateCatalog(json: string): TemplateDefinition[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as TemplateDefinition[]) : [];
  } catch {
    return [];
  }
}
