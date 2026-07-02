//! Top-level document model.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use std::collections::HashMap;

use crate::{
    node::{Node, NodeId},
    scene::{Scene, SceneId},
    tokens::TokenStore,
};

/// Unique identifier for a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DocumentId(pub Uuid);

impl DocumentId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for DocumentId {
    fn default() -> Self {
        Self::new()
    }
}

/// Document-level metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub title: String,
    pub author: Option<String>,
    pub description: Option<String>,
    /// Semantic version of the document schema (e.g. "1.0.0").
    pub schema_version: String,
    pub created_at: String,
    pub updated_at: String,
}

impl Default for DocumentMetadata {
    fn default() -> Self {
        Self {
            title: "Untitled Presentation".to_string(),
            author: None,
            description: None,
            schema_version: "0.1.0".to_string(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}

/// Reference to a brand package (name + version).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandBinding {
    pub name: String,
    pub version: String,
}

/// Content-addressed asset identifier.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AssetId(pub Uuid);

impl AssetId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for AssetId {
    fn default() -> Self {
        Self::new()
    }
}

/// Kind of asset stored in the document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetKind {
    Font,
    Image,
    Video,
    Svg,
    Icon,
    Data,
    ComponentPackage,
    BrandPackage,
}

/// A single asset in the store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: AssetId,
    pub kind: AssetKind,
    /// URI or relative path to the asset.
    pub uri: String,
    /// SHA-256 hex digest for integrity validation.
    pub hash: String,
    pub name: Option<String>,
}

/// Collection of assets associated with a document.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AssetStore {
    pub assets: Vec<Asset>,
}

/// Export settings embedded in the document.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ExportSettings {
    pub pdf_enabled: bool,
    pub png_enabled: bool,
    pub mp4_enabled: bool,
    pub offline_bundle_enabled: bool,
}

/// The top-level presentation document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: DocumentId,
    pub metadata: DocumentMetadata,
    /// Resolved token store for this document.
    pub tokens: TokenStore,
    /// Optional reference to an external brand package.
    pub brand: Option<BrandBinding>,
    pub assets: AssetStore,
    pub scenes: Vec<Scene>,
    pub export_settings: ExportSettings,
    /// All nodes in the scene graph, keyed by their ID.
    pub nodes: HashMap<NodeId, Node>,
}

impl Document {
    pub fn new(title: impl Into<String>) -> Self {
        let mut metadata = DocumentMetadata::default();
        metadata.title = title.into();
        Self {
            id: DocumentId::new(),
            metadata,
            tokens: TokenStore::default(),
            brand: None,
            assets: AssetStore::default(),
            scenes: Vec::new(),
            export_settings: ExportSettings::default(),
            nodes: HashMap::new(),
        }
    }

    /// Look up a scene by its ID.
    pub fn scene(&self, id: SceneId) -> Option<&Scene> {
        self.scenes.iter().find(|s| s.id == id)
    }

    /// Look up a scene mutably by its ID.
    pub fn scene_mut(&mut self, id: SceneId) -> Option<&mut Scene> {
        self.scenes.iter_mut().find(|s| s.id == id)
    }

    /// Look up a node by its ID.
    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(&id)
    }

    /// Look up a node mutably by its ID.
    pub fn node_mut(&mut self, id: NodeId) -> Option<&mut Node> {
        self.nodes.get_mut(&id)
    }

    /// Insert a node into the scene graph.
    pub fn insert_node(&mut self, node: Node) {
        self.nodes.insert(node.id, node);
    }

    /// Remove a node and detach it from its parent's child list.
    /// Returns the removed node if it existed.
    pub fn remove_node(&mut self, id: NodeId) -> Option<Node> {
        let node = self.nodes.remove(&id)?;
        if let Some(parent_id) = node.parent {
            if let Some(parent) = self.nodes.get_mut(&parent_id) {
                parent.children.retain(|c| *c != id);
            }
        }
        Some(node)
    }

    /// Return the children IDs of a given node in order.
    pub fn children_of(&self, id: NodeId) -> Vec<NodeId> {
        self.nodes
            .get(&id)
            .map(|n| n.children.clone())
            .unwrap_or_default()
    }

    /// Walk the subtree rooted at `root` in depth-first pre-order and
    /// collect all node IDs (including the root itself).
    pub fn subtree_ids(&self, root: NodeId) -> Vec<NodeId> {
        let mut result = Vec::new();
        let mut stack = vec![root];
        while let Some(id) = stack.pop() {
            result.push(id);
            if let Some(node) = self.nodes.get(&id) {
                for &child in node.children.iter().rev() {
                    stack.push(child);
                }
            }
        }
        result
    }
}
