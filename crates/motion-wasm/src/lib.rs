//! motion-wasm — wasm-bindgen bindings and browser API boundary.
//!
//! This crate exposes the Rust engine to TypeScript/JavaScript via a compact
//! surface area.  High-frequency rendering and interaction logic stays in Rust.

use motion_core::{
    command::Command,
    document::Document,
    engine::DocumentEngine,
    node::{NodeId, NodeKind, StyleValue, Transform},
    scene::SceneId,
    tokens::{TokenRef, TokenValue},
};
use motion_render::RenderTreeBuilder;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

const MIN_NODE_SIZE: f32 = 24.0;
const RESIZE_HANDLE_THRESHOLD: f32 = 10.0;

#[derive(Debug, Clone, Copy)]
enum ResizeHandle {
    North,
    South,
    East,
    West,
    NorthEast,
    NorthWest,
    SouthEast,
    SouthWest,
}

#[derive(Debug, Clone)]
enum InteractionState {
    Drag {
        node_id: NodeId,
        start_x: f32,
        start_y: f32,
        origin: Transform,
    },
    Resize {
        node_id: NodeId,
        start_x: f32,
        start_y: f32,
        origin: Transform,
        handle: ResizeHandle,
    },
}

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
    selection: Option<NodeId>,
    interaction: Option<InteractionState>,
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
            selection: None,
            interaction: None,
        }
    }

    /// Load a serialized document (JSON string).
    #[wasm_bindgen(js_name = loadDocument)]
    pub fn load_document(&mut self, document_json: &str) -> Result<(), JsValue> {
        let doc: Document = serde_json::from_str(document_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.inner = DocumentEngine::new(doc);
        self.selection = None;
        self.interaction = None;
        Ok(())
    }

    /// Load a brand package (JSON string) and merge its tokens into the document.
    #[wasm_bindgen(js_name = loadBrandPackage)]
    pub fn load_brand_package(&mut self, package_json: &str) -> Result<(), JsValue> {
        let payload: Value = serde_json::from_str(package_json)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        if let Some(obj) = payload.as_object() {
            if let (Some(name), Some(version)) = (
                obj.get("name").and_then(Value::as_str),
                obj.get("version").and_then(Value::as_str),
            ) {
                self.inner.document_mut().brand = Some(motion_core::document::BrandBinding {
                    name: name.to_string(),
                    version: version.to_string(),
                });
            }
        }

        let source = payload.get("tokens").unwrap_or(&payload);
        let has_explicit_tokens_key = payload.get("tokens").is_some();
        let mut collected = Vec::new();
        collect_tokens(source, &mut collected);
        if collected.is_empty() {
            let message = if has_explicit_tokens_key {
                "Brand payload contains a `tokens` key but no dotted token entries"
            } else {
                "Brand payload did not contain a `tokens` object or top-level sections with dotted token entries"
            };
            return Err(JsValue::from_str(message));
        }
        for (path, value) in collected {
            self.inner.document_mut().tokens.tokens.insert(path, value);
        }
        Ok(())
    }

    /// Update the canvas viewport dimensions.
    #[wasm_bindgen(js_name = setViewport)]
    pub fn set_viewport(&mut self, width: f32, height: f32, scale: f32) {
        self.viewport_width = width;
        self.viewport_height = height;
        self.device_pixel_ratio = scale;
    }

    /// Advance one animation frame.
    #[wasm_bindgen(js_name = render)]
    pub fn render(&mut self, _timestamp: f64) -> String {
        let scene_id = match self.inner.current_scene() {
            Some(s) => s.id,
            None => return "{}".to_string(),
        };
        let builder = RenderTreeBuilder::new(self.inner.document(), self.inner.overlay());
        match builder.build(
            scene_id,
            self.viewport_width,
            self.viewport_height,
            self.device_pixel_ratio,
        ) {
            Some(tree) => serde_json::to_string(&tree).unwrap_or_else(|_| "{}".to_string()),
            None => "{}".to_string(),
        }
    }

    /// Handle a pointer down event on the canvas.
    #[wasm_bindgen(js_name = pointerDown)]
    pub fn pointer_down(&mut self, x: f32, y: f32, _modifiers: u32) {
        self.interaction = None;
        let Some(hit_id) = self.hit_test(x, y) else {
            self.selection = None;
            return;
        };

        self.selection = Some(hit_id);
        let Some(node) = self.inner.document().node(hit_id) else {
            return;
        };
        if node.locked {
            return;
        }

        if let Some(handle) = self.detect_resize_handle(hit_id, x, y) {
            self.interaction = Some(InteractionState::Resize {
                node_id: hit_id,
                start_x: x,
                start_y: y,
                origin: node.transform.clone(),
                handle,
            });
            return;
        }

        self.interaction = Some(InteractionState::Drag {
            node_id: hit_id,
            start_x: x,
            start_y: y,
            origin: node.transform.clone(),
        });
    }

    /// Handle a pointer move event on the canvas.
    #[wasm_bindgen(js_name = pointerMove)]
    pub fn pointer_move(&mut self, x: f32, y: f32) {
        let Some(interaction) = self.interaction.clone() else {
            return;
        };

        match interaction {
            InteractionState::Drag {
                node_id,
                start_x,
                start_y,
                origin,
            } => {
                if let Some(node) = self.inner.document_mut().node_mut(node_id) {
                    node.transform.x = origin.x + (x - start_x);
                    node.transform.y = origin.y + (y - start_y);
                }
            }
            InteractionState::Resize {
                node_id,
                start_x,
                start_y,
                origin,
                handle,
            } => {
                if let Some(node) = self.inner.document_mut().node_mut(node_id) {
                    let dx = x - start_x;
                    let dy = y - start_y;
                    let mut next = origin.clone();

                    match handle {
                        ResizeHandle::East => {
                            next.width = (origin.width + dx).max(MIN_NODE_SIZE);
                        }
                        ResizeHandle::West => {
                            next.width = (origin.width - dx).max(MIN_NODE_SIZE);
                            next.x = origin.x + (origin.width - next.width);
                        }
                        ResizeHandle::South => {
                            next.height = (origin.height + dy).max(MIN_NODE_SIZE);
                        }
                        ResizeHandle::North => {
                            next.height = (origin.height - dy).max(MIN_NODE_SIZE);
                            next.y = origin.y + (origin.height - next.height);
                        }
                        ResizeHandle::NorthEast => {
                            next.height = (origin.height - dy).max(MIN_NODE_SIZE);
                            next.y = origin.y + (origin.height - next.height);
                            next.width = (origin.width + dx).max(MIN_NODE_SIZE);
                        }
                        ResizeHandle::NorthWest => {
                            next.height = (origin.height - dy).max(MIN_NODE_SIZE);
                            next.y = origin.y + (origin.height - next.height);
                            next.width = (origin.width - dx).max(MIN_NODE_SIZE);
                            next.x = origin.x + (origin.width - next.width);
                        }
                        ResizeHandle::SouthEast => {
                            next.width = (origin.width + dx).max(MIN_NODE_SIZE);
                            next.height = (origin.height + dy).max(MIN_NODE_SIZE);
                        }
                        ResizeHandle::SouthWest => {
                            next.width = (origin.width - dx).max(MIN_NODE_SIZE);
                            next.x = origin.x + (origin.width - next.width);
                            next.height = (origin.height + dy).max(MIN_NODE_SIZE);
                        }
                    }

                    node.transform = next;
                }
            }
        }
    }

    /// Handle a pointer up event on the canvas.
    #[wasm_bindgen(js_name = pointerUp)]
    pub fn pointer_up(&mut self, x: f32, y: f32) {
        self.pointer_move(x, y);
        self.interaction = None;
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

    /// Advance to the next presentation step.
    #[wasm_bindgen(js_name = nextStep)]
    pub fn next_step(&mut self) -> bool {
        self.inner.next_step()
    }

    /// Go back to the previous presentation step.
    #[wasm_bindgen(js_name = previousStep)]
    pub fn previous_step(&mut self) -> bool {
        self.inner.previous_step()
    }

    /// Jump to a scene by its UUID string.
    #[wasm_bindgen(js_name = jumpToScene)]
    pub fn jump_to_scene(&mut self, scene_id: &str) -> bool {
        self.selection = None;
        self.interaction = None;
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
    #[wasm_bindgen(js_name = getPosition)]
    pub fn get_position(&self) -> String {
        let (scene_idx, step_idx) = self.inner.position();
        json!({
            "scene_idx": scene_idx,
            "step_idx": step_idx,
        })
        .to_string()
    }

    /// Return the current selection as a JSON string.
    #[wasm_bindgen(js_name = getSelection)]
    pub fn get_selection(&self) -> String {
        let selection = self
            .selection
            .and_then(|node_id| self.inner.document().node(node_id).map(|node| (node_id, node)))
            .map(|(node_id, node)| {
                vec![json!({
                    "id": node_id.0.to_string(),
                    "name": node.name,
                    "node_type": node_kind_name(&node.data),
                })]
            })
            .unwrap_or_default();
        serde_json::to_string(&selection).unwrap_or_else(|_| "[]".to_string())
    }

    /// Return inspector data for the current selection as a JSON string.
    #[wasm_bindgen(js_name = inspect)]
    pub fn inspect(&self) -> String {
        let current_scene_id = self
            .inner
            .current_scene()
            .map(|scene| scene.id.0.to_string());

        let selected = self.selection.and_then(|node_id| {
            let node = self.inner.document().node(node_id)?;
            let absolute = self.absolute_transform(node_id);
            let text = match &node.data {
                NodeKind::Text(text) => Some(json!({
                    "content": text.content,
                    "font_size": self.inner.document().tokens.resolve_f32(&text.font_size),
                })),
                _ => None,
            };

            Some(json!({
                "id": node_id.0.to_string(),
                "name": node.name,
                "node_type": node_kind_name(&node.data),
                "visible": node.visible,
                "locked": node.locked,
                "opacity": self.inner.document().tokens.resolve_f32(&node.style.opacity).unwrap_or(1.0),
                "transform": {
                    "x": node.transform.x,
                    "y": node.transform.y,
                    "width": node.transform.width,
                    "height": node.transform.height,
                    "rotation": node.transform.rotation,
                    "scale_x": node.transform.scale_x,
                    "scale_y": node.transform.scale_y,
                },
                "absolute_transform": {
                    "x": absolute.x,
                    "y": absolute.y,
                    "width": absolute.width,
                    "height": absolute.height,
                    "rotation": absolute.rotation,
                    "scale_x": absolute.scale_x,
                    "scale_y": absolute.scale_y,
                },
                "animation": {
                    "enter_preset": style_value_to_string(node.animation.enter_preset.as_ref()),
                    "exit_preset": style_value_to_string(node.animation.exit_preset.as_ref()),
                },
                "text": text,
            }))
        });

        json!({
            "scene_id": current_scene_id,
            "selected": selected,
        })
        .to_string()
    }

    /// Run preflight checks and return a JSON `PreflightReport`.
    #[wasm_bindgen(js_name = runPreflight)]
    pub fn run_preflight(&self) -> String {
        use motion_core::preflight::{
            CheckCategory, CheckSeverity, PreflightCheck, PreflightReport,
        };

        let mut report = PreflightReport::new();
        let doc = self.inner.document();

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

        let has_font = doc
            .assets
            .assets
            .iter()
            .any(|a| matches!(a.kind, motion_core::document::AssetKind::Font));
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
        serde_json::to_string(self.inner.document()).unwrap_or_else(|_| "{}".to_string())
    }

    /// Return a list of scenes as a JSON array.
    #[wasm_bindgen(js_name = listScenes)]
    pub fn list_scenes(&self) -> String {
        let scenes: Vec<_> = self
            .inner
            .document()
            .scenes
            .iter()
            .map(|s| {
                json!({
                    "id": s.id.0.to_string(),
                    "name": s.name,
                    "step_count": s.steps.len(),
                })
            })
            .collect();
        serde_json::to_string(&scenes).unwrap_or_else(|_| "[]".to_string())
    }
}

impl MotionEngine {
    fn hit_test(&self, x: f32, y: f32) -> Option<NodeId> {
        let scene = self.inner.current_scene()?;
        let mut draw_order = Vec::new();
        collect_draw_order(self.inner.document(), scene.root, &mut draw_order);

        for node_id in draw_order.into_iter().rev() {
            if node_id == scene.root {
                continue;
            }
            let node = self.inner.document().node(node_id)?;
            if !node.visible {
                continue;
            }
            let absolute = self.absolute_transform(node_id);
            if point_in_transform(x, y, &absolute) {
                return Some(node_id);
            }
        }
        None
    }

    fn detect_resize_handle(&self, node_id: NodeId, x: f32, y: f32) -> Option<ResizeHandle> {
        let absolute = self.absolute_transform(node_id);
        let threshold = RESIZE_HANDLE_THRESHOLD;
        let left = absolute.x;
        let right = absolute.x + absolute.width;
        let top = absolute.y;
        let bottom = absolute.y + absolute.height;

        let near_left = (x - left).abs() <= threshold;
        let near_right = (x - right).abs() <= threshold;
        let near_top = (y - top).abs() <= threshold;
        let near_bottom = (y - bottom).abs() <= threshold;

        match (near_left, near_right, near_top, near_bottom) {
            (true, false, true, false) => Some(ResizeHandle::NorthWest),
            (false, true, true, false) => Some(ResizeHandle::NorthEast),
            (true, false, false, true) => Some(ResizeHandle::SouthWest),
            (false, true, false, true) => Some(ResizeHandle::SouthEast),
            (false, false, true, false) if x >= left && x <= right => Some(ResizeHandle::North),
            (false, false, false, true) if x >= left && x <= right => Some(ResizeHandle::South),
            (true, false, false, false) if y >= top && y <= bottom => Some(ResizeHandle::West),
            (false, true, false, false) if y >= top && y <= bottom => Some(ResizeHandle::East),
            _ => None,
        }
    }

    fn absolute_transform(&self, node_id: NodeId) -> Transform {
        let mut lineage = Vec::new();
        let mut current = Some(node_id);

        while let Some(id) = current {
            if let Some(node) = self.inner.document().node(id) {
                lineage.push(node.transform.clone());
                current = node.parent;
            } else {
                break;
            }
        }

        lineage.reverse();
        let mut absolute = Transform::default();
        absolute.x = 0.0;
        absolute.y = 0.0;
        absolute.width = 0.0;
        absolute.height = 0.0;
        absolute.scale_x = 1.0;
        absolute.scale_y = 1.0;

        for transform in lineage.iter() {
            absolute = compose_transform(&absolute, transform);
        }

        absolute
    }
}

fn collect_draw_order(document: &Document, node_id: NodeId, out: &mut Vec<NodeId>) {
    out.push(node_id);
    if let Some(node) = document.node(node_id) {
        for child_id in &node.children {
            collect_draw_order(document, *child_id, out);
        }
    }
}

fn point_in_transform(x: f32, y: f32, transform: &Transform) -> bool {
    x >= transform.x
        && y >= transform.y
        && x <= transform.x + transform.width
        && y <= transform.y + transform.height
}

fn compose_transform(parent: &Transform, current: &Transform) -> Transform {
    Transform {
        x: parent.x + (current.x * parent.scale_x),
        y: parent.y + (current.y * parent.scale_y),
        width: current.width * parent.scale_x * current.scale_x,
        height: current.height * parent.scale_y * current.scale_y,
        rotation: parent.rotation + current.rotation,
        scale_x: parent.scale_x * current.scale_x,
        scale_y: parent.scale_y * current.scale_y,
    }
}

fn collect_tokens(value: &Value, out: &mut Vec<(String, TokenValue)>) {
    let Some(object) = value.as_object() else {
        return;
    };

    for (key, child) in object {
        if key.starts_with('_') {
            continue;
        }
        if key.contains('.') {
            out.push((key.clone(), json_to_token_value(child)));
        } else {
            collect_tokens(child, out);
        }
    }
}

fn json_to_token_value(value: &Value) -> TokenValue {
    match value {
        Value::String(s) => parse_token_string(s)
            .map(|path| TokenValue::Alias(TokenRef::new(path)))
            .unwrap_or_else(|| TokenValue::Scalar(value.clone())),
        Value::Object(map) => TokenValue::Composite(
            map.iter()
                .map(|(key, child)| (key.clone(), json_to_token_value(child)))
                .collect(),
        ),
        _ => TokenValue::Scalar(value.clone()),
    }
}

fn parse_token_string(value: &str) -> Option<&str> {
    if value.starts_with('{') && value.ends_with('}') && value.len() > 2 {
        Some(&value[1..value.len() - 1])
    } else {
        None
    }
}

fn node_kind_name(kind: &NodeKind) -> &'static str {
    match kind {
        NodeKind::Frame(_) => "frame",
        NodeKind::Group(_) => "group",
        NodeKind::Text(_) => "text",
        NodeKind::Shape(_) => "shape",
        NodeKind::Image(_) => "image",
        NodeKind::Video(_) => "video",
        NodeKind::Chart(_) => "chart",
        NodeKind::Equation(_) => "equation",
        NodeKind::Diagram(_) => "diagram",
        NodeKind::ComponentInstance(_) => "component_instance",
    }
}

fn style_value_to_string(value: Option<&StyleValue<String>>) -> Option<String> {
    match value {
        Some(StyleValue::Literal(raw)) => Some(raw.clone()),
        Some(StyleValue::Token(token)) => Some(token.path.clone()),
        None => None,
    }
}
