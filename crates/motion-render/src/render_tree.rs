//! The render tree — a resolved, numeric representation of the scene ready for GPU submission.

use motion_core::node::{Color, NodeId, Transform};
use serde::{Deserialize, Serialize};

use crate::material::ResolvedMaterial;

/// A fully resolved node ready for rendering.
///
/// All token references have been resolved to concrete values and layout has
/// been evaluated.  This is the input to the GPU draw pass.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderNode {
    pub id: NodeId,
    pub transform: Transform,
    pub opacity: f32,
    pub visible: bool,
    pub children: Vec<NodeId>,
    pub content: RenderContent,
    pub material: Option<ResolvedMaterial>,
    pub blur_radius: f32,
    pub clip: bool,
}

/// The concrete drawable content of a render node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RenderContent {
    Frame,
    Group,
    Shape {
        kind: ShapeKind,
        fill: Option<Color>,
        stroke: Option<Color>,
        stroke_width: f32,
    },
    Text {
        content: String,
        color: Color,
        font_family: String,
        font_size: f32,
        line_height: f32,
    },
    Image {
        uri: String,
    },
    Video {
        uri: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    RoundedRectangle { corner_radius: f32 },
    Line,
}

/// The full render tree for a single scene frame.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RenderTree {
    pub nodes: Vec<RenderNode>,
    /// Root node IDs in draw order (back-to-front).
    pub roots: Vec<NodeId>,
    pub viewport_width: f32,
    pub viewport_height: f32,
    pub device_pixel_ratio: f32,
}
