/**
 * TypeScript types mirroring the Rust document model.
 *
 * These are used by the editor UI to interact with the WASM engine.
 * The WASM boundary uses JSON for communication; these types describe
 * the JSON shapes.
 */

// --- Identifiers ---

export type DocumentId = string; // UUID
export type SceneId = string;
export type StepId = string;
export type NodeId = string;
export type AssetId = string;

// --- Tokens ---

export type TokenRef = { path: string };

export type StyleValue<T> = T | TokenRef;

// --- Document ---

export interface DocumentMetadata {
  title: string;
  author?: string;
  description?: string;
  schema_version: string;
  created_at: string;
  updated_at: string;
}

export interface BrandBinding {
  name: string;
  version: string;
}

export interface Document {
  id: DocumentId;
  metadata: DocumentMetadata;
  brand?: BrandBinding;
  scenes: Scene[];
}

// --- Scene ---

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
}

export interface Step {
  id: StepId;
  name: string;
  commands: PresentationCommand[];
  notes?: string;
}

export interface Scene {
  id: SceneId;
  name: string;
  root: NodeId;
  camera: CameraState;
  steps: Step[];
  notes?: string;
}

// --- Presentation commands ---

export type PresentationCommand =
  | { type: "focus"; target: NodeId }
  | { type: "highlight"; target: NodeId }
  | { type: "dim_others"; target: NodeId }
  | { type: "reveal"; target: NodeId }
  | { type: "hide"; target: NodeId }
  | { type: "set_property"; node: NodeId; property: string; value: unknown }
  | { type: "replace_text"; node: NodeId; new_text: string }
  | { type: "camera_focus"; target: NodeId; zoom?: number }
  | { type: "camera_move"; state: CameraState; duration_ms?: number };

// --- Preflight ---

export type CheckSeverity = "info" | "warning" | "error";
export type PreflightStatus = "ready" | "warning" | "error";

export interface PreflightCheck {
  id: string;
  category: string;
  severity: CheckSeverity;
  passed: boolean;
  message: string;
  details?: string;
}

export interface PreflightReport {
  status: PreflightStatus;
  checks: PreflightCheck[];
  suggestions: Array<{ check_id: string; description: string; auto_fixable: boolean }>;
}
