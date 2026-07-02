//! motion-core — document model, scene graph, tokens, commands, layout, and animation engine.

pub mod animation;
pub mod command;
pub mod document;
pub mod engine;
pub mod layout;
pub mod node;
pub mod preflight;
pub mod scene;
pub mod tokens;

pub use document::Document;
pub use engine::DocumentEngine;
pub use node::{Node, NodeId, NodeKind};
pub use scene::{Scene, SceneId};
pub use tokens::{TokenRef, TokenStore};
