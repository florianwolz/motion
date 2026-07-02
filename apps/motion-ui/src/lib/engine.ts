/**
 * Thin TypeScript wrapper around the MotionEngine WASM instance.
 *
 * The actual WASM module is compiled from `crates/motion-wasm` using
 * `wasm-pack build --target web`.  This wrapper provides typed helpers and
 * manages the WASM lifecycle.
 */

import type { PreflightReport } from "./types.js";

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
  render(timestamp: number): void;
  pointerDown(x: number, y: number, modifiers: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(x: number, y: number): void;
  applyCommand(commandJson: string): void;
  undo(): void;
  redo(): void;
  nextStep(): void;
  previousStep(): void;
  jumpToScene(sceneId: string): void;
  getSelection(): string;
  inspect(): string;
  runPreflight(): string;
  serializeDocument(): string;
}

export function parsePreflight(json: string): PreflightReport {
  return JSON.parse(json) as PreflightReport;
}
