//! Document engine — command executor, undo/redo, and presentation navigation.
//!
//! All document mutations flow through [`DocumentEngine::apply_command`].
//! The engine maintains a snapshot-based undo/redo stack and tracks the
//! current presentation position (scene + step).

use std::collections::HashMap;

use thiserror::Error;

use crate::{
    command::{
        AddStepCommand, Command, CreateNodeCommand, DeleteNodeCommand, GroupNodesCommand,
        MoveNodeCommand, SetPropertyCommand, SetStepCommandsCommand, UngroupNodesCommand,
    },
    document::Document,
    node::{GroupNode, Node, NodeId, NodeKind},
    scene::{CameraState, PresentationCommand, Scene, SceneId, Step, StepId},
    tokens::TokenValue,
};

/// Errors that can occur when applying a command.
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("scene not found: {0:?}")]
    SceneNotFound(SceneId),
    #[error("node not found: {0:?}")]
    NodeNotFound(NodeId),
    #[error("step not found: {0:?}")]
    StepNotFound(StepId),
    #[error("invalid property path: {0}")]
    InvalidPropertyPath(String),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

// ------------------------------------------------------------------
// Presentation overlay — per-node state driven by step commands
// ------------------------------------------------------------------

/// Per-node overlay overrides — fields are public so the render builder and
/// tests can read them without generating dead-code warnings.
#[derive(Debug, Clone, Default)]
pub struct NodePresentationState {
    /// Override visibility (None = use node's own `visible` flag).
    pub visible: Option<bool>,
    /// Dimming overlay opacity multiplier (0.0 = fully dimmed, 1.0 = no dim).
    pub dim_factor: f32,
    /// Whether this node is in "focus" mode (highlighted).
    pub focused: bool,
}

impl NodePresentationState {
    #[allow(dead_code)]
    fn normal() -> Self {
        Self { visible: None, dim_factor: 1.0, focused: false }
    }
}

/// The accumulated presentation state after applying 0..=current_step commands.
#[derive(Debug, Clone, Default)]
pub struct PresentationOverlay {
    pub node_states: HashMap<NodeId, NodePresentationState>,
    pub camera: CameraState,
    pub is_black_screen: bool,
    pub dim_others_target: Option<NodeId>,
}

impl PresentationOverlay {
    #[allow(dead_code)]
    fn node_state(&self, id: NodeId) -> NodePresentationState {
        self.node_states
            .get(&id)
            .cloned()
            .unwrap_or_else(NodePresentationState::normal)
    }
}

// ------------------------------------------------------------------
// DocumentEngine
// ------------------------------------------------------------------

/// The main engine that owns the document and drives all mutations.
pub struct DocumentEngine {
    document: Document,
    /// Snapshots before each applied command — enables undo.
    undo_stack: Vec<Document>,
    /// Snapshots of the state that was undone — enables redo.
    redo_stack: Vec<Document>,

    // --- Presentation navigation ---
    /// Index into `document.scenes` for the currently active scene.
    current_scene_idx: usize,
    /// Index into the current scene's `steps` list.  `None` means the scene
    /// is at its initial (pre-step) state.
    current_step_idx: Option<usize>,
    /// Accumulated step state for the current position.
    overlay: PresentationOverlay,
}

impl DocumentEngine {
    /// Create a new engine wrapping the given document.
    pub fn new(document: Document) -> Self {
        Self {
            document,
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            current_scene_idx: 0,
            current_step_idx: None,
            overlay: PresentationOverlay::default(),
        }
    }

    /// Access the current document.
    pub fn document(&self) -> &Document {
        &self.document
    }

    /// Mutably access the current document.
    pub fn document_mut(&mut self) -> &mut Document {
        &mut self.document
    }

    /// Access the current presentation overlay.
    pub fn overlay(&self) -> &PresentationOverlay {
        &self.overlay
    }

    /// Returns `(scene_idx, step_idx)` for the current presentation position.
    pub fn position(&self) -> (usize, Option<usize>) {
        (self.current_scene_idx, self.current_step_idx)
    }

    /// The currently active scene, if any.
    pub fn current_scene(&self) -> Option<&Scene> {
        self.document.scenes.get(self.current_scene_idx)
    }

    // ------------------------------------------------------------------
    // Command application
    // ------------------------------------------------------------------

    /// Apply a command, mutating the document.  Pushes a snapshot to the
    /// undo stack before applying and clears the redo stack.
    pub fn apply_command(&mut self, cmd: Command) -> Result<(), EngineError> {
        let snapshot = self.document.clone();
        self.apply_command_inner(cmd)?;
        self.undo_stack.push(snapshot);
        self.redo_stack.clear();
        Ok(())
    }

    fn apply_command_inner(&mut self, cmd: Command) -> Result<(), EngineError> {
        match cmd {
            Command::CreateNode(c) => self.cmd_create_node(c),
            Command::DeleteNode(c) => self.cmd_delete_node(c),
            Command::MoveNode(c) => self.cmd_move_node(c),
            Command::SetProperty(c) => self.cmd_set_property(c),
            Command::GroupNodes(c) => self.cmd_group_nodes(c),
            Command::UngroupNodes(c) => self.cmd_ungroup_nodes(c),
            Command::AddStep(c) => self.cmd_add_step(c),
            Command::SetStepCommands(c) => self.cmd_set_step_commands(c),
            Command::ApplyTemplate(_) => Ok(()), // TODO: template engine
            Command::SetBrand(c) => {
                self.document.brand = Some(crate::document::BrandBinding {
                    name: c.name,
                    version: c.version,
                });
                Ok(())
            }
            Command::SetToken(c) => {
                self.document
                    .tokens
                    .tokens
                    .insert(c.path, TokenValue::Scalar(c.value));
                Ok(())
            }
        }
    }

    fn cmd_create_node(&mut self, c: CreateNodeCommand) -> Result<(), EngineError> {
        let scene = self
            .document
            .scenes
            .iter_mut()
            .find(|s| s.id == c.scene_id)
            .ok_or(EngineError::SceneNotFound(c.scene_id))?;

        let mut node = Node::new(c.name, c.kind);
        if let Some(t) = c.transform {
            node.transform = t;
        }

        let node_id = node.id;

        match c.parent_id {
            Some(parent_id) => {
                node.parent = Some(parent_id);
                self.document.nodes.insert(node_id, node);
                let parent = self
                    .document
                    .nodes
                    .get_mut(&parent_id)
                    .ok_or(EngineError::NodeNotFound(parent_id))?;
                match c.index {
                    Some(idx) => {
                        let idx = idx.min(parent.children.len());
                        parent.children.insert(idx, node_id);
                    }
                    None => parent.children.push(node_id),
                }
            }
            None => {
                // Attach to the scene root, or make this node the root.
                let root_id = scene.root;
                node.parent = Some(root_id);
                self.document.nodes.insert(node_id, node);
                if let Some(root) = self.document.nodes.get_mut(&root_id) {
                    match c.index {
                        Some(idx) => {
                            let idx = idx.min(root.children.len());
                            root.children.insert(idx, node_id);
                        }
                        None => root.children.push(node_id),
                    }
                }
            }
        }
        Ok(())
    }

    fn cmd_delete_node(&mut self, c: DeleteNodeCommand) -> Result<(), EngineError> {
        // Remove the subtree to avoid orphaned nodes.
        let ids = self.document.subtree_ids(c.node_id);
        for id in ids {
            self.document.remove_node(id);
        }
        Ok(())
    }

    fn cmd_move_node(&mut self, c: MoveNodeCommand) -> Result<(), EngineError> {
        // Detach from current parent.
        let old_parent_id = self
            .document
            .nodes
            .get(&c.node_id)
            .ok_or(EngineError::NodeNotFound(c.node_id))?
            .parent;

        if let Some(old_pid) = old_parent_id {
            if let Some(old_parent) = self.document.nodes.get_mut(&old_pid) {
                old_parent.children.retain(|id| *id != c.node_id);
            }
        }

        // Attach to new parent.
        let new_pid = c.new_parent_id;
        if let Some(node) = self.document.nodes.get_mut(&c.node_id) {
            node.parent = new_pid;
        }
        if let Some(pid) = new_pid {
            let new_parent = self
                .document
                .nodes
                .get_mut(&pid)
                .ok_or(EngineError::NodeNotFound(pid))?;
            match c.new_index {
                Some(idx) => {
                    let idx = idx.min(new_parent.children.len());
                    new_parent.children.insert(idx, c.node_id);
                }
                None => new_parent.children.push(c.node_id),
            }
        }
        Ok(())
    }

    fn cmd_set_property(&mut self, c: SetPropertyCommand) -> Result<(), EngineError> {
        let node = self
            .document
            .nodes
            .get_mut(&c.node_id)
            .ok_or(EngineError::NodeNotFound(c.node_id))?;
        apply_property(node, &c.property, c.value)
    }

    fn cmd_group_nodes(&mut self, c: GroupNodesCommand) -> Result<(), EngineError> {
        if c.node_ids.is_empty() {
            return Ok(());
        }
        // Find the common parent (assume all siblings under the same parent).
        let parent_id = self
            .document
            .nodes
            .get(&c.node_ids[0])
            .and_then(|n| n.parent);

        // Create the group node.
        let mut group_node = Node::new(c.group_name, NodeKind::Group(GroupNode::default()));
        group_node.parent = parent_id;
        let group_id = group_node.id;

        // Reparent selected nodes into the group.
        for &nid in &c.node_ids {
            if let Some(node) = self.document.nodes.get_mut(&nid) {
                node.parent = Some(group_id);
            }
            group_node.children.push(nid);
        }

        self.document.nodes.insert(group_id, group_node);

        // Remove selected nodes from their old parent and insert the group.
        if let Some(pid) = parent_id {
            if let Some(parent) = self.document.nodes.get_mut(&pid) {
                // Insert group where the first selected node was.
                let first_pos = parent
                    .children
                    .iter()
                    .position(|id| *id == c.node_ids[0])
                    .unwrap_or(parent.children.len());
                parent.children.retain(|id| !c.node_ids.contains(id));
                parent.children.insert(first_pos, group_id);
            }
        }
        Ok(())
    }

    fn cmd_ungroup_nodes(&mut self, c: UngroupNodesCommand) -> Result<(), EngineError> {
        let group = self
            .document
            .nodes
            .get(&c.group_id)
            .ok_or(EngineError::NodeNotFound(c.group_id))?
            .clone();

        let parent_id = group.parent;

        // Reparent children to the group's parent.
        for &child_id in &group.children {
            if let Some(child) = self.document.nodes.get_mut(&child_id) {
                child.parent = parent_id;
            }
        }

        // Insert children into the parent's child list at the group's position.
        if let Some(pid) = parent_id {
            if let Some(parent) = self.document.nodes.get_mut(&pid) {
                let pos = parent
                    .children
                    .iter()
                    .position(|id| *id == c.group_id)
                    .unwrap_or(parent.children.len());
                parent.children.remove(pos);
                for (i, &child_id) in group.children.iter().enumerate() {
                    parent.children.insert(pos + i, child_id);
                }
            }
        }

        self.document.nodes.remove(&c.group_id);
        Ok(())
    }

    fn cmd_add_step(&mut self, c: AddStepCommand) -> Result<(), EngineError> {
        let mut step = Step::new(c.name);
        step.commands = c.commands;
        step.notes = c.notes;
        if let Some(t) = c.transition {
            step.transition = t;
        }
        let scene = self
            .document
            .scenes
            .iter_mut()
            .find(|s| s.id == c.scene_id)
            .ok_or(EngineError::SceneNotFound(c.scene_id))?;
        scene.steps.push(step);
        Ok(())
    }

    fn cmd_set_step_commands(&mut self, c: SetStepCommandsCommand) -> Result<(), EngineError> {
        let scene = self
            .document
            .scenes
            .iter_mut()
            .find(|s| s.id == c.scene_id)
            .ok_or(EngineError::SceneNotFound(c.scene_id))?;
        let step = scene
            .steps
            .iter_mut()
            .find(|s| s.id == c.step_id)
            .ok_or(EngineError::StepNotFound(c.step_id))?;
        step.commands = c.commands;
        Ok(())
    }

    // ------------------------------------------------------------------
    // Undo / redo
    // ------------------------------------------------------------------

    /// Undo the most recent command.  Returns `true` if successful.
    pub fn undo(&mut self) -> bool {
        if let Some(snapshot) = self.undo_stack.pop() {
            let current = std::mem::replace(&mut self.document, snapshot);
            self.redo_stack.push(current);
            true
        } else {
            false
        }
    }

    /// Redo the most recently undone command.  Returns `true` if successful.
    pub fn redo(&mut self) -> bool {
        if let Some(snapshot) = self.redo_stack.pop() {
            let current = std::mem::replace(&mut self.document, snapshot);
            self.undo_stack.push(current);
            true
        } else {
            false
        }
    }

    // ------------------------------------------------------------------
    // Presentation navigation
    // ------------------------------------------------------------------

    /// Advance to the next step (or next scene if the current scene is exhausted).
    /// Returns `true` if the position changed.
    pub fn next_step(&mut self) -> bool {
        let scene = match self.document.scenes.get(self.current_scene_idx) {
            Some(s) => s,
            None => return false,
        };

        let next_step_idx = match self.current_step_idx {
            None if scene.steps.is_empty() => {
                // No steps in this scene — jump to next scene if available.
                if self.current_scene_idx + 1 < self.document.scenes.len() {
                    self.current_scene_idx += 1;
                    self.current_step_idx = None;
                    self.rebuild_overlay();
                    return true;
                }
                return false;
            }
            None => 0,
            Some(i) if i + 1 < scene.steps.len() => i + 1,
            Some(_) => {
                // Last step in scene — go to next scene.
                if self.current_scene_idx + 1 < self.document.scenes.len() {
                    self.current_scene_idx += 1;
                    self.current_step_idx = None;
                    self.rebuild_overlay();
                    return true;
                }
                return false;
            }
        };

        self.current_step_idx = Some(next_step_idx);
        self.rebuild_overlay();
        true
    }

    /// Go back to the previous step (or last step of previous scene).
    /// Returns `true` if the position changed.
    pub fn previous_step(&mut self) -> bool {
        match self.current_step_idx {
            None => {
                // At the beginning of the current scene.
                if self.current_scene_idx == 0 {
                    return false;
                }
                self.current_scene_idx -= 1;
                let last_step = self
                    .document
                    .scenes
                    .get(self.current_scene_idx)
                    .map(|s| if s.steps.is_empty() { None } else { Some(s.steps.len() - 1) })
                    .unwrap_or(None);
                self.current_step_idx = last_step;
                self.rebuild_overlay();
                true
            }
            Some(0) => {
                self.current_step_idx = None;
                self.rebuild_overlay();
                true
            }
            Some(i) => {
                self.current_step_idx = Some(i - 1);
                self.rebuild_overlay();
                true
            }
        }
    }

    /// Jump directly to a scene by ID, resetting to its initial state.
    /// Returns `true` if the scene was found.
    pub fn jump_to_scene(&mut self, id: SceneId) -> bool {
        if let Some(idx) = self.document.scenes.iter().position(|s| s.id == id) {
            self.current_scene_idx = idx;
            self.current_step_idx = None;
            self.rebuild_overlay();
            true
        } else {
            false
        }
    }

    /// Reset the current scene to its initial pre-step state.
    pub fn restart_scene(&mut self) {
        self.current_step_idx = None;
        self.rebuild_overlay();
    }

    // ------------------------------------------------------------------
    // Overlay computation
    // ------------------------------------------------------------------

    /// Rebuild the presentation overlay by replaying all steps from index 0
    /// up to and including `current_step_idx`.
    fn rebuild_overlay(&mut self) {
        let mut overlay = PresentationOverlay::default();

        let scene = match self.document.scenes.get(self.current_scene_idx) {
            Some(s) => s,
            None => {
                self.overlay = overlay;
                return;
            }
        };
        overlay.camera = scene.camera.clone();

        let end = match self.current_step_idx {
            Some(i) => i + 1,
            None => 0,
        };

        let steps: Vec<_> = scene.steps[..end].to_vec();
        for step in &steps {
            for cmd in &step.commands {
                apply_presentation_command(&mut overlay, cmd);
            }
        }

        self.overlay = overlay;
    }
}

// ------------------------------------------------------------------
// Presentation command application
// ------------------------------------------------------------------

fn apply_presentation_command(overlay: &mut PresentationOverlay, cmd: &PresentationCommand) {
    match cmd {
        PresentationCommand::Reveal { target } => {
            overlay.node_states.entry(*target).or_default().visible = Some(true);
        }
        PresentationCommand::Hide { target } => {
            overlay.node_states.entry(*target).or_default().visible = Some(false);
        }
        PresentationCommand::Focus { target } => {
            // Focus: highlight the target; dim others (handled by renderer).
            overlay.node_states.entry(*target).or_default().focused = true;
            overlay.dim_others_target = Some(*target);
        }
        PresentationCommand::Highlight { target } => {
            overlay.node_states.entry(*target).or_default().focused = true;
        }
        PresentationCommand::DimOthers { target } => {
            let entry = overlay.node_states.entry(*target).or_default();
            entry.dim_factor = 1.0; // target stays bright
            overlay.dim_others_target = Some(*target);
        }
        PresentationCommand::SetProperty { node, property: _, value: _ } => {
            // SetProperty is applied directly to the document via a Command,
            // not via a step command.  Mark the node as "touched" at least.
            overlay.node_states.entry(*node).or_default();
        }
        PresentationCommand::ReplaceText { node, .. } => {
            overlay.node_states.entry(*node).or_default();
        }
        PresentationCommand::CameraFocus { target: _, zoom } => {
            if let Some(z) = zoom {
                overlay.camera.zoom = *z;
            }
        }
        PresentationCommand::CameraMove { state, .. } => {
            overlay.camera = state.clone();
        }
        PresentationCommand::StaggeredReveal { targets, .. } => {
            for target in targets {
                overlay.node_states.entry(*target).or_default().visible = Some(true);
            }
        }
        PresentationCommand::ChartHighlightSeries { .. } => {}
        PresentationCommand::Morph { .. } => {}
    }
}

// ------------------------------------------------------------------
// Property path application
// ------------------------------------------------------------------

/// Apply a value to a node by dotted property path.
fn apply_property(
    node: &mut Node,
    path: &str,
    value: serde_json::Value,
) -> Result<(), EngineError> {
    match path {
        "name" => {
            node.name = value
                .as_str()
                .ok_or_else(|| EngineError::InvalidPropertyPath(path.to_string()))?
                .to_string();
        }
        "visible" => {
            node.visible = value
                .as_bool()
                .ok_or_else(|| EngineError::InvalidPropertyPath(path.to_string()))?;
        }
        "locked" => {
            node.locked = value
                .as_bool()
                .ok_or_else(|| EngineError::InvalidPropertyPath(path.to_string()))?;
        }
        // --- Transform ---
        "transform.x" => node.transform.x = as_f32(&value, path)?,
        "transform.y" => node.transform.y = as_f32(&value, path)?,
        "transform.width" => node.transform.width = as_f32(&value, path)?,
        "transform.height" => node.transform.height = as_f32(&value, path)?,
        "transform.rotation" => node.transform.rotation = as_f32(&value, path)?,
        "transform.scale_x" => node.transform.scale_x = as_f32(&value, path)?,
        "transform.scale_y" => node.transform.scale_y = as_f32(&value, path)?,
        // --- Style ---
        "style.opacity" => {
            let v = as_f32(&value, path)?;
            node.style.opacity = crate::node::StyleValue::Literal(v);
        }
        // --- Node-type-specific ---
        "content" => {
            if let NodeKind::Text(ref mut t) = node.data {
                t.content = value
                    .as_str()
                    .ok_or_else(|| EngineError::InvalidPropertyPath(path.to_string()))?
                    .to_string();
            }
        }
        "font_size" => {
            if let NodeKind::Text(ref mut t) = node.data {
                t.font_size = crate::node::StyleValue::Literal(as_f32(&value, path)?);
            }
        }
        "font_weight" => {
            if let NodeKind::Text(ref mut t) = node.data {
                t.font_weight = Some(
                    value
                        .as_u64()
                        .ok_or_else(|| EngineError::InvalidPropertyPath(path.to_string()))?
                        as u32,
                );
            }
        }
        "animation.enter_preset" => {
            node.animation.enter_preset = value
                .as_str()
                .map(|raw| crate::node::StyleValue::Literal(raw.to_string()));
        }
        "animation.exit_preset" => {
            node.animation.exit_preset = value
                .as_str()
                .map(|raw| crate::node::StyleValue::Literal(raw.to_string()));
        }
        "animation.stagger_delay" => {
            node.animation.stagger_delay = value
                .as_f64()
                .map(|raw| crate::node::StyleValue::Literal(raw as f32));
        }
        _ => {
            return Err(EngineError::InvalidPropertyPath(path.to_string()));
        }
    }
    Ok(())
}

fn as_f32(v: &serde_json::Value, path: &str) -> Result<f32, EngineError> {
    v.as_f64()
        .map(|x| x as f32)
        .ok_or_else(|| EngineError::InvalidPropertyPath(path.to_string()))
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        command::{AddStepCommand, CreateNodeCommand, DeleteNodeCommand, SetPropertyCommand},
        document::Document,
        node::{FrameNode, NodeKind, TextNode, Transform},
        scene::{PresentationCommand, Scene, SceneId},
    };

    fn make_doc_with_scene() -> (Document, SceneId) {
        let mut doc = Document::new("Test");
        let root = Node::new("Root", NodeKind::Frame(FrameNode { clip_content: false, corner_radius: None }));
        let root_id = root.id;
        doc.insert_node(root);
        let scene = Scene::new("Scene 1", root_id);
        let scene_id = scene.id;
        doc.scenes.push(scene);
        (doc, scene_id)
    }

    #[test]
    fn create_and_delete_node() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        engine
            .apply_command(Command::CreateNode(CreateNodeCommand {
                scene_id,
                parent_id: None,
                index: None,
                kind: NodeKind::Text(TextNode::default()),
                name: "Hello".into(),
                transform: None,
            }))
            .unwrap();

        assert_eq!(engine.document().nodes.len(), 2); // root + text

        // Get the text node id
        let text_id = engine
            .document()
            .nodes
            .values()
            .find(|n| n.name == "Hello")
            .unwrap()
            .id;

        engine
            .apply_command(Command::DeleteNode(DeleteNodeCommand { scene_id, node_id: text_id }))
            .unwrap();

        assert_eq!(engine.document().nodes.len(), 1); // only root
    }

    #[test]
    fn undo_redo() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        engine
            .apply_command(Command::CreateNode(CreateNodeCommand {
                scene_id,
                parent_id: None,
                index: None,
                kind: NodeKind::Text(TextNode::default()),
                name: "Hello".into(),
                transform: None,
            }))
            .unwrap();

        assert_eq!(engine.document().nodes.len(), 2);

        let undone = engine.undo();
        assert!(undone);
        assert_eq!(engine.document().nodes.len(), 1);

        let redone = engine.redo();
        assert!(redone);
        assert_eq!(engine.document().nodes.len(), 2);
    }

    #[test]
    fn set_property() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        engine
            .apply_command(Command::CreateNode(CreateNodeCommand {
                scene_id,
                parent_id: None,
                index: None,
                kind: NodeKind::Text(TextNode::default()),
                name: "Text".into(),
                transform: Some(Transform::default()),
            }))
            .unwrap();

        let text_id = engine
            .document()
            .nodes
            .values()
            .find(|n| n.name == "Text")
            .unwrap()
            .id;

        engine
            .apply_command(Command::SetProperty(SetPropertyCommand {
                scene_id,
                node_id: text_id,
                property: "transform.x".into(),
                value: serde_json::json!(42.0),
            }))
            .unwrap();

        let x = engine.document().nodes[&text_id].transform.x;
        assert!((x - 42.0).abs() < 1e-5);
    }

    #[test]
    fn navigation_steps() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        engine
            .apply_command(Command::AddStep(AddStepCommand {
                scene_id,
                name: "Step 1".into(),
                commands: vec![],
                transition: None,
                notes: None,
            }))
            .unwrap();
        engine
            .apply_command(Command::AddStep(AddStepCommand {
                scene_id,
                name: "Step 2".into(),
                commands: vec![],
                transition: None,
                notes: None,
            }))
            .unwrap();

        assert_eq!(engine.position(), (0, None));
        engine.next_step();
        assert_eq!(engine.position(), (0, Some(0)));
        engine.next_step();
        assert_eq!(engine.position(), (0, Some(1)));
        engine.previous_step();
        assert_eq!(engine.position(), (0, Some(0)));
        engine.previous_step();
        assert_eq!(engine.position(), (0, None));
    }

    #[test]
    fn reveal_hide_overlay() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        let root_id = engine.document().scenes[0].root;

        // Create a node to reveal/hide
        engine
            .apply_command(Command::CreateNode(CreateNodeCommand {
                scene_id,
                parent_id: None,
                index: None,
                kind: NodeKind::Text(TextNode::default()),
                name: "Bullet".into(),
                transform: None,
            }))
            .unwrap();
        let bullet_id = engine
            .document()
            .nodes
            .values()
            .find(|n| n.name == "Bullet")
            .unwrap()
            .id;

        engine
            .apply_command(Command::AddStep(AddStepCommand {
                scene_id,
                name: "Reveal bullet".into(),
                commands: vec![PresentationCommand::Reveal { target: bullet_id }],
                transition: None,
                notes: None,
            }))
            .unwrap();

        // Before step: no overlay entry
        assert!(engine.overlay().node_states.get(&bullet_id).is_none());

        engine.next_step();
        let state = engine.overlay().node_states.get(&bullet_id).unwrap();
        assert_eq!(state.visible, Some(true));

        // Suppress unused variable warning
        let _ = root_id;
    }

    #[test]
    fn dim_others_tracks_target() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        engine
            .apply_command(Command::CreateNode(CreateNodeCommand {
                scene_id,
                parent_id: None,
                index: None,
                kind: NodeKind::Text(TextNode::default()),
                name: "Focus target".into(),
                transform: None,
            }))
            .unwrap();
        let target_id = engine
            .document()
            .nodes
            .values()
            .find(|n| n.name == "Focus target")
            .unwrap()
            .id;

        engine
            .apply_command(Command::AddStep(AddStepCommand {
                scene_id,
                name: "Dim others".into(),
                commands: vec![PresentationCommand::DimOthers { target: target_id }],
                transition: None,
                notes: None,
            }))
            .unwrap();

        engine.next_step();
        assert_eq!(engine.overlay().dim_others_target, Some(target_id));
    }

    #[test]
    fn set_stagger_delay_property() {
        let (doc, scene_id) = make_doc_with_scene();
        let mut engine = DocumentEngine::new(doc);

        engine
            .apply_command(Command::CreateNode(CreateNodeCommand {
                scene_id,
                parent_id: None,
                index: None,
                kind: NodeKind::Text(TextNode::default()),
                name: "Stagger target".into(),
                transform: None,
            }))
            .unwrap();
        let node_id = engine
            .document()
            .nodes
            .values()
            .find(|n| n.name == "Stagger target")
            .unwrap()
            .id;

        engine
            .apply_command(Command::SetProperty(SetPropertyCommand {
                scene_id,
                node_id,
                property: "animation.stagger_delay".into(),
                value: serde_json::json!(45.0),
            }))
            .unwrap();

        let node = engine.document().node(node_id).unwrap();
        match node.animation.stagger_delay.as_ref() {
            Some(crate::node::StyleValue::Literal(delay)) => assert!((*delay - 45.0).abs() < f32::EPSILON),
            _ => panic!("expected stagger delay literal to be set"),
        }
    }
}
