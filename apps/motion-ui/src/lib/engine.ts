/**
 * Thin TypeScript wrapper around the MotionEngine WASM instance.
 *
 * The actual WASM module is compiled from `crates/motion-wasm` using
 * `wasm-pack build --target web`.  This wrapper provides typed helpers and
 * manages the WASM lifecycle.
 */

import type { PreflightReport, Scene } from "./types.js";
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
