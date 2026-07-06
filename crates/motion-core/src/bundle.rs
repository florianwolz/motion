//! Compiled deck bundle — the runtime artifact produced by the deck compiler.
//!
//! A [`DeckBundle`] is the thing that gets shared, opened, and presented.
//! It is produced from an authoring document by the CLI `compile` command and
//! consumed by the browser presenter runtime and the WASM engine.
//!
//! The bundle format is intentionally document-like so existing tooling (diff,
//! version control, inspection) still applies.

use serde::{Deserialize, Serialize};

use crate::document::Document;

/// Current bundle format version.  Increment when the shape changes in a
/// backwards-incompatible way.
pub const BUNDLE_FORMAT_VERSION: &str = "1";

/// Static metadata that does not require loading the full document.
///
/// The manifest is always the first thing the runtime reads, allowing it to
/// display progress, verify compatibility, and decide which runtime features to
/// enable before fully parsing the rest of the bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckManifest {
    /// Bundle format version — consumers should reject bundles whose version
    /// they do not understand.
    pub format_version: String,
    /// Semver string of the engine that compiled this bundle.
    pub engine_version: String,
    /// Human-readable presentation title.
    pub title: String,
    /// Number of scenes in the presentation.
    pub scene_count: usize,
    /// Total number of presentation steps across all scenes.
    pub total_steps: usize,
    /// Whether any scene or step contains presenter notes.
    pub has_notes: bool,
    /// Number of bundled assets (fonts, images, etc.).
    pub asset_count: usize,
    /// ISO-8601 UTC timestamp at which the bundle was compiled.
    pub compiled_at: String,
}

/// Runtime capability hints compiled into the bundle.
///
/// These allow the runtime to skip capability detection for features that are
/// statically known at compile time (e.g. "this deck has no video — skip video
/// codec checks").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityHints {
    /// Deck contains at least one `ChartNode` with inline data.
    pub has_charts: bool,
    /// Deck contains at least one video asset.
    pub has_video: bool,
    /// Deck contains external data assets (CSV, JSON, etc.).
    pub has_data_assets: bool,
    /// Minimum render tier required for full fidelity.
    ///
    /// Values: `"canvas"` (Tier 3), `"web_gl2"` (Tier 2), `"web_gpu"` (Tier 1).
    pub min_render_tier: String,
}

impl Default for CapabilityHints {
    fn default() -> Self {
        Self {
            has_charts: false,
            has_video: false,
            has_data_assets: false,
            min_render_tier: "canvas".to_string(),
        }
    }
}

/// A compiled presentation deck bundle.
///
/// This is the runtime artifact — a self-contained package containing:
/// - a manifest with static metadata
/// - the fully resolved document (scene graph, tokens, assets)
/// - capability hints for the runtime loader
///
/// Bundles are serialized as JSON with the `.motiondeck` extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeckBundle {
    /// Static manifest — read first during load.
    pub manifest: DeckManifest,
    /// The compiled runtime document.
    pub document: Document,
    /// Capability hints compiled from the document.
    pub capabilities: CapabilityHints,
}

impl DeckBundle {
    /// Compile a [`Document`] into a [`DeckBundle`].
    ///
    /// This resolves static metadata and analyses the document for capability
    /// hints.  The document is consumed as-is; the caller is responsible for
    /// resolving tokens and bundling assets before calling this.
    pub fn compile(document: Document) -> Self {
        let total_steps: usize = document.scenes.iter().map(|s| s.steps.len()).sum();
        let has_notes = document.scenes.iter().any(|s| {
            s.notes.is_some() || s.steps.iter().any(|step| step.notes.is_some())
        });
        let asset_count = document.assets.assets.len();

        let has_charts = document.nodes.values().any(|n| {
            matches!(n.data, crate::node::NodeKind::Chart(_))
        });
        let has_video = document.assets.assets.iter().any(|a| {
            matches!(a.kind, crate::document::AssetKind::Video)
        });
        let has_data_assets = document.assets.assets.iter().any(|a| {
            matches!(a.kind, crate::document::AssetKind::Data)
        });

        let manifest = DeckManifest {
            format_version: BUNDLE_FORMAT_VERSION.to_string(),
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            title: document.metadata.title.clone(),
            scene_count: document.scenes.len(),
            total_steps,
            has_notes,
            asset_count,
            compiled_at: String::new(), // caller sets if needed
        };

        let capabilities = CapabilityHints {
            has_charts,
            has_video,
            has_data_assets,
            min_render_tier: "canvas".to_string(),
        };

        Self { manifest, document, capabilities }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        document::{Asset, AssetId, AssetKind},
        node::{FrameNode, Node, NodeKind},
        scene::{Scene, Step},
    };

    fn make_doc() -> Document {
        let mut doc = Document::new("Test Deck");
        let root = Node::new("Root", NodeKind::Frame(FrameNode { clip_content: false, corner_radius: None }));
        let root_id = root.id;
        doc.insert_node(root);
        let mut scene = Scene::new("Scene 1", root_id);
        let mut step = Step::new("Step 1");
        step.notes = Some("Presenter note".to_string());
        scene.steps.push(step);
        doc.scenes.push(scene);
        doc
    }

    #[test]
    fn compile_sets_manifest_fields() {
        let doc = make_doc();
        let bundle = DeckBundle::compile(doc);
        assert_eq!(bundle.manifest.format_version, BUNDLE_FORMAT_VERSION);
        assert_eq!(bundle.manifest.title, "Test Deck");
        assert_eq!(bundle.manifest.scene_count, 1);
        assert_eq!(bundle.manifest.total_steps, 1);
        assert!(bundle.manifest.has_notes);
    }

    #[test]
    fn compile_detects_video_asset() {
        let mut doc = make_doc();
        doc.assets.assets.push(Asset {
            id: AssetId::new(),
            kind: AssetKind::Video,
            uri: "data:video/mp4;base64,fake".into(),
            hash: "abc".into(),
            name: None,
        });
        let bundle = DeckBundle::compile(doc);
        assert!(bundle.capabilities.has_video);
        assert_eq!(bundle.manifest.asset_count, 1);
    }

    #[test]
    fn bundle_roundtrips_via_json() {
        let doc = make_doc();
        let bundle = DeckBundle::compile(doc);
        let json = serde_json::to_string(&bundle).unwrap();
        let restored: DeckBundle = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.manifest.title, "Test Deck");
        assert_eq!(restored.manifest.scene_count, 1);
    }
}
