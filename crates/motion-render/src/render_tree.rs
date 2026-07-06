//! The render tree — a resolved, numeric representation of the scene ready for GPU submission.

use std::collections::HashMap;

use motion_core::node::{Color, NodeId, Transform};
use serde::{Deserialize, Serialize};

use crate::{material::ResolvedMaterial, passes::DrawPass};

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
    /// Which render pass this node belongs to. Assigned by [`crate::passes::assign_draw_pass`].
    pub draw_pass: DrawPass,
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
    /// A resolved chart ready for runtime rendering.
    ///
    /// The builder resolves inline table data and series colours so the
    /// renderer never needs to touch token stores or data sources.
    Chart {
        /// Chart type — drives which drawing primitive the renderer uses.
        kind: ChartKind,
        /// Resolved bar/column data (used when `kind` is `Bar`).
        bars: Vec<ResolvedBar>,
        /// Resolved line/area series (used when `kind` is `Line` or `Area`).
        lines: Vec<ResolvedLineSeries>,
        /// Optional title string.
        title: Option<String>,
        /// Optional subtitle string.
        subtitle: Option<String>,
        /// Series IDs currently highlighted via presentation overlay.
        highlighted_series: Vec<String>,
    },
}

/// Chart type — mirrors `motion_core::node::ChartKind` but is standalone so
/// the render crate does not re-export core internals.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChartKind {
    Bar,
    Line,
    Area,
    Scatter,
    Histogram,
    Waterfall,
    Heatmap,
    Timeline,
    Combo,
    StackedBar,
    StackedArea,
    Lollipop,
    Pareto,
    Funnel,
    Bullet,
    Waffle,
    Table,
    Matrix,
    KpiCard,
    Gantt,
    Sparkline,
    Sankey,
    Treemap,
    Sunburst,
    Chord,
    Alluvial,
    Network,
    RadialTree,
    Dendrogram,
    Box,
    Violin,
    Ridgeline,
    Density,
    ParallelCoordinates,
    Hexbin,
    Contour,
    ErrorBar,
    Candlestick,
    Ohlc,
    WindRose,
    Ternary,
}

/// A single resolved bar/column with its display value and colour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedBar {
    /// Bar label (from the x-field column of the first row).
    pub label: String,
    /// Normalised height in [0, 1] relative to the maximum value.
    pub value_norm: f32,
    /// Absolute numeric value (for axis labels).
    pub value: f64,
    /// RGBA fill colour resolved from the series colour token.
    pub color: Color,
    /// Series identifier — used to match against `highlighted_series`.
    pub series_id: String,
}

/// A single resolved line/area series with ordered data points.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedLineSeries {
    pub series_id: String,
    pub label: String,
    /// Normalised (x, y) points in [0, 1] × [0, 1] space.
    pub points: Vec<[f32; 2]>,
    pub color: Color,
    pub filled: bool,
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

impl RenderTree {
    /// Build an O(1) lookup map from node ID to node reference.
    pub fn node_map(&self) -> HashMap<NodeId, &RenderNode> {
        self.nodes.iter().map(|n| (n.id, n)).collect()
    }

    /// Return only the visible nodes, sorted by [`DrawPass`] in ascending order
    /// (lowest pass number drawn first — see [`DrawPass`] variant order).
    ///
    /// Within the same pass, tree insertion order is preserved.  This is the
    /// ordered sequence a GPU command scheduler should iterate.
    pub fn pass_ordered_nodes(&self) -> Vec<&RenderNode> {
        let mut visible: Vec<&RenderNode> =
            self.nodes.iter().filter(|n| n.visible).collect();
        // Stable sort preserves intra-pass tree order.
        visible.sort_by_key(|n| n.draw_pass);
        visible
    }

    /// Return all visible nodes whose [`DrawPass`] matches `pass`, in tree insertion order.
    pub fn nodes_in_pass(&self, pass: DrawPass) -> Vec<&RenderNode> {
        self.nodes
            .iter()
            .filter(|n| n.visible && n.draw_pass == pass)
            .collect()
    }
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{material::GlassMaterial, passes::DrawPass};
    use motion_core::node::Color;

    fn make_id() -> NodeId {
        NodeId::new()
    }

    fn make_shape_node(id: NodeId, visible: bool) -> RenderNode {
        RenderNode {
            id,
            transform: Transform::default(),
            opacity: 1.0,
            visible,
            children: vec![],
            content: RenderContent::Shape {
                kind: ShapeKind::Rectangle,
                fill: Some(Color { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }),
                stroke: None,
                stroke_width: 0.0,
            },
            material: None,
            blur_radius: 0.0,
            clip: false,
            draw_pass: DrawPass::Shape,
        }
    }

    fn make_text_node(id: NodeId) -> RenderNode {
        RenderNode {
            id,
            transform: Transform::default(),
            opacity: 1.0,
            visible: true,
            children: vec![],
            content: RenderContent::Text {
                content: "hello".into(),
                color: Color { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                font_family: "sans-serif".into(),
                font_size: 16.0,
                line_height: 1.4,
            },
            material: None,
            blur_radius: 0.0,
            clip: false,
            draw_pass: DrawPass::Text,
        }
    }

    fn make_glass_node(id: NodeId) -> RenderNode {
        let white = Color { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
        RenderNode {
            id,
            transform: Transform::default(),
            opacity: 1.0,
            visible: true,
            children: vec![],
            content: RenderContent::Frame,
            material: Some(ResolvedMaterial::Glass(GlassMaterial {
                tint: white.clone(),
                opacity: 0.7,
                blur_radius: 16.0,
                saturation: 1.2,
                edge_highlight: white,
                noise_strength: 0.03,
            })),
            blur_radius: 0.0,
            clip: false,
            draw_pass: DrawPass::Glass,
        }
    }

    fn empty_tree() -> RenderTree {
        RenderTree {
            nodes: vec![],
            roots: vec![],
            viewport_width: 1920.0,
            viewport_height: 1080.0,
            device_pixel_ratio: 1.0,
        }
    }

    #[test]
    fn node_map_lookup_finds_nodes() {
        let id_a = make_id();
        let id_b = make_id();
        let mut tree = empty_tree();
        tree.nodes.push(make_shape_node(id_a, true));
        tree.nodes.push(make_text_node(id_b));

        let map = tree.node_map();
        assert!(map.contains_key(&id_a));
        assert!(map.contains_key(&id_b));
    }

    #[test]
    fn node_map_on_empty_tree_is_empty() {
        let tree = empty_tree();
        assert!(tree.node_map().is_empty());
    }

    #[test]
    fn pass_ordered_nodes_excludes_invisible() {
        let id_a = make_id();
        let id_b = make_id();
        let mut tree = empty_tree();
        tree.nodes.push(make_shape_node(id_a, true));
        tree.nodes.push(make_shape_node(id_b, false)); // hidden

        let ordered = tree.pass_ordered_nodes();
        assert_eq!(ordered.len(), 1);
        assert_eq!(ordered[0].id, id_a);
    }

    #[test]
    fn pass_ordered_nodes_sorts_shape_before_text() {
        let id_text = make_id();
        let id_shape = make_id();
        let mut tree = empty_tree();
        // Insert text before shape intentionally.
        tree.nodes.push(make_text_node(id_text));
        tree.nodes.push(make_shape_node(id_shape, true));

        let ordered = tree.pass_ordered_nodes();
        assert_eq!(ordered.len(), 2);
        assert_eq!(ordered[0].id, id_shape, "shape should come before text");
        assert_eq!(ordered[1].id, id_text);
    }

    #[test]
    fn pass_ordered_nodes_sorts_text_before_glass() {
        let id_glass = make_id();
        let id_text = make_id();
        let mut tree = empty_tree();
        tree.nodes.push(make_glass_node(id_glass));
        tree.nodes.push(make_text_node(id_text));

        let ordered = tree.pass_ordered_nodes();
        assert_eq!(ordered[0].id, id_text, "text should come before glass");
        assert_eq!(ordered[1].id, id_glass);
    }

    #[test]
    fn pass_ordered_nodes_stable_within_same_pass() {
        let id_a = make_id();
        let id_b = make_id();
        let mut tree = empty_tree();
        tree.nodes.push(make_shape_node(id_a, true));
        tree.nodes.push(make_shape_node(id_b, true));

        let ordered = tree.pass_ordered_nodes();
        assert_eq!(ordered[0].id, id_a, "insertion order preserved within same pass");
        assert_eq!(ordered[1].id, id_b);
    }

    #[test]
    fn nodes_in_pass_filters_correctly() {
        let id_shape = make_id();
        let id_text = make_id();
        let id_glass = make_id();
        let mut tree = empty_tree();
        tree.nodes.push(make_shape_node(id_shape, true));
        tree.nodes.push(make_text_node(id_text));
        tree.nodes.push(make_glass_node(id_glass));

        let shapes = tree.nodes_in_pass(DrawPass::Shape);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].id, id_shape);

        let texts = tree.nodes_in_pass(DrawPass::Text);
        assert_eq!(texts.len(), 1);
        assert_eq!(texts[0].id, id_text);

        let glass_nodes = tree.nodes_in_pass(DrawPass::Glass);
        assert_eq!(glass_nodes.len(), 1);
        assert_eq!(glass_nodes[0].id, id_glass);
    }

    #[test]
    fn nodes_in_pass_excludes_invisible() {
        let id_a = make_id();
        let id_b = make_id();
        let mut tree = empty_tree();
        tree.nodes.push(make_shape_node(id_a, true));
        tree.nodes.push(make_shape_node(id_b, false)); // hidden

        let shapes = tree.nodes_in_pass(DrawPass::Shape);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].id, id_a);
    }

    #[test]
    fn nodes_in_pass_empty_for_unused_pass() {
        let mut tree = empty_tree();
        tree.nodes.push(make_shape_node(make_id(), true));
        assert!(tree.nodes_in_pass(DrawPass::Particles).is_empty());
    }

    #[test]
    fn render_node_serde_round_trip() {
        let id = make_id();
        let node = make_shape_node(id, true);
        let json = serde_json::to_string(&node).unwrap();
        let decoded: RenderNode = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.id, id);
        assert_eq!(decoded.draw_pass, DrawPass::Shape);
    }
}
