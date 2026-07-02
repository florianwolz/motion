//! Top-level document model.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
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
}
