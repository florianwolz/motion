//! The render tree — a resolved, numeric representation of the scene ready for GPU submission.

use std::collections::HashMap;

use motion_core::node::{Color, NodeId, Transform};
use serde::{Deserialize, Serialize};

use crate::material::ResolvedMaterial;

/// Per-node animated value overrides for a single render frame.
///
/// These are computed from active [`motion_core::animation::AnimationTrack`]s
/// evaluated at the current timestamp and applied on top of the static render
/// tree.
#[derive(Debug, Clone, Default)]
pub struct AnimationFrame {
    /// Opacity override in `[0, 1]`.  Replaces the node's computed opacity.
    pub opacity: HashMap<NodeId, f32>,
    /// Uniform scale override — multiplies both `scale_x` and `scale_y`.
    pub scale: HashMap<NodeId, f32>,
    /// Y-axis translation offset in CSS pixels (additive on top of the node's
    /// own `transform.y`).
    pub y_offset: HashMap<NodeId, f32>,
}

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
