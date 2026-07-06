//! Command system — all document mutations flow through typed commands.

use serde::{Deserialize, Serialize};

use crate::{
    node::{NodeId, NodeKind, Transform},
    scene::{PresentationCommand, SceneId, StepId, TransitionSpec},
};

/// A single undoable document mutation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    /// Create a new node in the scene graph.
    CreateNode(CreateNodeCommand),
    /// Remove a node (and its subtree) from the scene graph.
    DeleteNode(DeleteNodeCommand),
    /// Reposition a node to a new parent or index.
    MoveNode(MoveNodeCommand),
    /// Set a scalar property on a node by dotted path.
    SetProperty(SetPropertyCommand),
    /// Group a set of sibling nodes under a new frame.
    GroupNodes(GroupNodesCommand),
    /// Dissolve a group, promoting its children to the parent.
    UngroupNodes(UngroupNodesCommand),
    /// Add a presentation step to a scene.
    AddStep(AddStepCommand),
    /// Replace the commands inside an existing step.
    SetStepCommands(SetStepCommandsCommand),
    /// Apply a named template to a scene.
    ApplyTemplate(ApplyTemplateCommand),
    /// Apply a brand package override to the document.
    SetBrand(SetBrandCommand),
    /// Set or update a token value in the document token store.
    SetToken(SetTokenCommand),
}

// --- Command payloads ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNodeCommand {
    pub scene_id: SceneId,
    pub parent_id: Option<NodeId>,
    pub index: Option<usize>,
    pub kind: NodeKind,
    pub name: String,
    pub transform: Option<Transform>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteNodeCommand {
    pub scene_id: SceneId,
    pub node_id: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveNodeCommand {
    pub scene_id: SceneId,
    pub node_id: NodeId,
    pub new_parent_id: Option<NodeId>,
    pub new_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetPropertyCommand {
    pub scene_id: SceneId,
    pub node_id: NodeId,
    /// Dotted property path, e.g. `"transform.x"` or `"style.opacity"`.
    pub property: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupNodesCommand {
    pub scene_id: SceneId,
    pub node_ids: Vec<NodeId>,
    pub group_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UngroupNodesCommand {
    pub scene_id: SceneId,
    pub group_id: NodeId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddStepCommand {
    pub scene_id: SceneId,
    pub name: String,
    pub commands: Vec<PresentationCommand>,
    pub transition: Option<TransitionSpec>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetStepCommandsCommand {
    pub scene_id: SceneId,
    pub step_id: StepId,
    pub commands: Vec<PresentationCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyTemplateCommand {
    pub scene_id: SceneId,
    pub template_id: String,
    pub properties: serde_json::Value,
    #[serde(default)]
    pub instance_node_id: Option<NodeId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetBrandCommand {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetTokenCommand {
    pub path: String,
    pub value: serde_json::Value,
}
