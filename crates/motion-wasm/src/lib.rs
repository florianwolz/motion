//! motion-wasm — wasm-bindgen bindings and browser API boundary.
//!
//! This crate exposes the Rust engine to TypeScript/JavaScript via a compact
//! surface area.  High-frequency rendering and interaction logic stays in Rust.

use wasm_bindgen::prelude::*;

use motion_core::{
    command::Command,
    document::Document,
    engine::DocumentEngine,
    scene::SceneId,
};
use motion_render::RenderTreeBuilder;

/// The main engine instance exposed to the browser.
///
/// Instantiated once per editor/presenter tab and used for all document
/// operations, rendering, and navigation.
#[wasm_bindgen]
pub struct MotionEngine {
    inner: DocumentEngine,
    viewport_width: f32,
    viewport_height: f32,
    device_pixel_ratio: f32,
}

#[wasm_bindgen]
impl MotionEngine {
    /// Create a new engine instance with an empty document.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let doc = Document::new("Untitled");
        Self {
            inner: DocumentEngine::new(doc),
            viewport_width: 1920.0,
            viewport_height: 1080.0,
            device_pixel_ratio: 1.0,
        }
    }

    /// Load a serialized document (JSON string).
    #[wasm_bindgen(js_name = loadDocument)]
    pub fn load_document(&mut self, document_json: &str) -> Result<(), JsValue> {
        let doc: Document = serde_json::from_str(document_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner = DocumentEngine::new(doc);
        Ok(())
    }

    /// Load a brand package (JSON string) and merge its tokens into the document.
    #[wasm_bindgen(js_name = loadBrandPackage)]
    pub fn load_brand_package(&mut self, _package_json: &str) -> Result<(), JsValue> {
        // TODO: parse brand package schema, merge tokens into document token store
        Ok(())
    }

    /// Update the canvas viewport dimensions.
    #[wasm_bindgen(js_name = setViewport)]
    pub fn set_viewport(&mut self, width: f32, height: f32, scale: f32) {
        self.viewport_width = width;
        self.viewport_height = height;
        self.device_pixel_ratio = scale;
    }

    /// Advance one animation frame.  `timestamp` is from `requestAnimationFrame`.
    /// Returns the current scene's render tree as a JSON string (or empty `{}`
    /// if there is no active scene).
    #[wasm_bindgen(js_name = render)]
    pub fn render(&mut self, _timestamp: f64) -> String {
        let scene_id = match self.inner.current_scene() {
            Some(s) => s.id,
            None => return "{}".to_string(),
        };
        let builder = RenderTreeBuilder::new(self.inner.document(), self.inner.overlay());
        match builder.build(scene_id, self.viewport_width, self.viewport_height, self.device_pixel_ratio) {
            Some(tree) => serde_json::to_string(&tree).unwrap_or_else(|_| "{}".to_string()),
            None => "{}".to_string(),
        }
    }

    /// Handle a pointer down event on the canvas.
    #[wasm_bindgen(js_name = pointerDown)]
    pub fn pointer_down(&mut self, _x: f32, _y: f32, _modifiers: u32) {
        // TODO: hit testing, selection update
    }

    /// Handle a pointer move event on the canvas.
    #[wasm_bindgen(js_name = pointerMove)]
    pub fn pointer_move(&mut self, _x: f32, _y: f32) {
        // TODO: hover, drag
    }

    /// Handle a pointer up event on the canvas.
    #[wasm_bindgen(js_name = pointerUp)]
    pub fn pointer_up(&mut self, _x: f32, _y: f32) {
        // TODO: finalize drag, deselect transient state
    }

    /// Apply a serialized command (JSON string).
    #[wasm_bindgen(js_name = applyCommand)]
    pub fn apply_command(&mut self, command_json: &str) -> Result<(), JsValue> {
        let cmd: Command = serde_json::from_str(command_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner
            .apply_command(cmd)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    }

    /// Undo the last command.
    #[wasm_bindgen(js_name = undo)]
    pub fn undo(&mut self) -> bool {
        self.inner.undo()
    }

    /// Redo the last undone command.
    #[wasm_bindgen(js_name = redo)]
    pub fn redo(&mut self) -> bool {
        self.inner.redo()
    }

    /// Advance to the next presentation step.  Returns `true` if the position changed.
    #[wasm_bindgen(js_name = nextStep)]
    pub fn next_step(&mut self) -> bool {
        self.inner.next_step()
    }

    /// Go back to the previous presentation step.  Returns `true` if the position changed.
    #[wasm_bindgen(js_name = previousStep)]
    pub fn previous_step(&mut self) -> bool {
        self.inner.previous_step()
    }

    /// Jump to a scene by its UUID string.
    #[wasm_bindgen(js_name = jumpToScene)]
    pub fn jump_to_scene(&mut self, scene_id: &str) -> bool {
        if let Ok(uuid) = scene_id.parse::<uuid::Uuid>() {
            self.inner.jump_to_scene(SceneId(uuid))
        } else {
            false
        }
    }

    /// Restart the current scene (return to pre-step state).
    #[wasm_bindgen(js_name = restartScene)]
    pub fn restart_scene(&mut self) {
        self.inner.restart_scene();
    }

    /// Return the current scene and step position as a JSON string.
    /// Shape: `{ "scene_idx": 0, "step_idx": null | 0 }`
    #[wasm_bindgen(js_name = getPosition)]
    pub fn get_position(&self) -> String {
        let (scene_idx, step_idx) = self.inner.position();
        serde_json::json!({
            "scene_idx": scene_idx,
            "step_idx": step_idx,
        })
        .to_string()
    }

    /// Return the current selection as a JSON string.
    #[wasm_bindgen(js_name = getSelection)]
    pub fn get_selection(&self) -> String {
        // TODO: serialize current SelectionState
        "[]".to_string()
    }

    /// Return inspector data for the current selection as a JSON string.
    #[wasm_bindgen(js_name = inspect)]
    pub fn inspect(&self) -> String {
        // TODO: build InspectorData from selected nodes
        "{}".to_string()
    }

    /// Run preflight checks and return a JSON `PreflightReport`.
    #[wasm_bindgen(js_name = runPreflight)]
    pub fn run_preflight(&self) -> String {
        use motion_core::preflight::{
            CheckCategory, CheckSeverity, PreflightCheck, PreflightReport,
        };

        let mut report = PreflightReport::new();
        let doc = self.inner.document();

        // Check 1: document has at least one scene.
        report.checks.push(PreflightCheck {
            id: "scenes.non_empty".into(),
            category: CheckCategory::Assets,
            severity: CheckSeverity::Error,
            passed: !doc.scenes.is_empty(),
            message: if doc.scenes.is_empty() {
                "Presentation has no scenes".into()
            } else {
                format!("{} scene(s) found", doc.scenes.len())
            },
            details: None,
        });

        // Check 2: all scene roots exist in the node map.
        let roots_valid = doc.scenes.iter().all(|s| doc.nodes.contains_key(&s.root));
        report.checks.push(PreflightCheck {
            id: "scenes.roots_valid".into(),
            category: CheckCategory::Assets,
            severity: CheckSeverity::Error,
            passed: roots_valid,
            message: if roots_valid {
                "All scene roots are valid".into()
            } else {
                "One or more scenes have a missing root node".into()
            },
            details: None,
        });

        // Check 3: brand font referenced.
        let has_font = doc.assets.assets.iter().any(|a| {
            matches!(a.kind, motion_core::document::AssetKind::Font)
        });
        report.checks.push(PreflightCheck {
            id: "fonts.bundled".into(),
            category: CheckCategory::Fonts,
            severity: CheckSeverity::Warning,
            passed: has_font,
            message: if has_font {
                "Bundled font found".into()
            } else {
                "No bundled font — presentation may use system fonts".into()
            },
            details: None,
        });

        report.recalculate_status();
        serde_json::to_string(&report).unwrap_or_else(|_| {
            r#"{"status":"error","checks":[],"suggestions":[]}"#.to_string()
        })
    }

    /// Serialize the current document to a JSON string.
    #[wasm_bindgen(js_name = serializeDocument)]
    pub fn serialize_document(&self) -> String {
        serde_json::to_string(self.inner.document())
            .unwrap_or_else(|_| "{}".to_string())
    }

    /// Return a list of scenes as a JSON array.
    /// Shape: `[{ "id": "...", "name": "...", "step_count": 2 }]`
    #[wasm_bindgen(js_name = listScenes)]
    pub fn list_scenes(&self) -> String {
        let scenes: Vec<_> = self
            .inner
            .document()
            .scenes
            .iter()
            .map(|s| {
                serde_json::json!({
                    "id": s.id.0.to_string(),
                    "name": s.name,
                    "step_count": s.steps.len(),
                })
            })
            .collect();
        serde_json::to_string(&scenes).unwrap_or_else(|_| "[]".to_string())
    }
}

