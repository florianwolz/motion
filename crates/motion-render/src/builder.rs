//! Render tree builder — converts a scene graph into a resolved `RenderTree`.
//!
//! All token references are resolved using the document's `TokenStore` and the
//! presentation overlay's per-node overrides are applied so that the renderer
//! receives fully concrete values.

use motion_core::{
    document::Document,
    engine::PresentationOverlay,
    node::{ChartDataSource, ChartKind as CoreChartKind, Color, NodeId, NodeKind},
    scene::SceneId,
    tokens::TokenStore,
};

use crate::{
    material::{CardMaterial, GlassMaterial, GlowMaterial, GradientSpec, GradientStop, ResolvedMaterial},
    passes::assign_draw_pass,
    render_tree::{AnimationFrame, ChartKind, RenderContent, RenderNode, RenderTree, ResolvedBar, ResolvedLineSeries, ShapeKind},
};

const DEFAULT_DIM_OTHERS_FACTOR: f32 = 0.3;

/// Builds a [`RenderTree`] for one scene frame.
pub struct RenderTreeBuilder<'a> {
    document: &'a Document,
    overlay: &'a PresentationOverlay,
    tokens: &'a TokenStore,
    animation: &'a AnimationFrame,
}

impl<'a> RenderTreeBuilder<'a> {
    /// Create a new builder with no active animation.
    pub fn new(document: &'a Document, overlay: &'a PresentationOverlay) -> Self {
        static EMPTY_FRAME: std::sync::OnceLock<AnimationFrame> = std::sync::OnceLock::new();
        let animation = EMPTY_FRAME.get_or_init(AnimationFrame::default);
        Self { document, overlay, tokens: &document.tokens, animation }
    }

    /// Create a new builder with an active animation frame.
    pub fn with_animation(
        document: &'a Document,
        overlay: &'a PresentationOverlay,
        animation: &'a AnimationFrame,
    ) -> Self {
        Self { document, overlay, tokens: &document.tokens, animation }
    }

    /// Build a render tree for the given scene.
    ///
    /// Returns `None` if the scene or its root node cannot be found.
    pub fn build(&self, scene_id: SceneId, viewport_width: f32, viewport_height: f32, dpr: f32) -> Option<RenderTree> {
        let scene = self.document.scene(scene_id)?;
        let mut tree = RenderTree {
            nodes: Vec::new(),
            roots: vec![scene.root],
            viewport_width,
            viewport_height,
            device_pixel_ratio: dpr,
        };

        self.visit(scene.root, &mut tree);

        Some(tree)
    }

    fn visit(&self, node_id: NodeId, tree: &mut RenderTree) {
        let node = match self.document.nodes.get(&node_id) {
            Some(n) => n,
            None => return,
        };

        let overlay_state = self.overlay.node_states.get(&node_id);

        // Visibility: overlay wins over the node's own flag.
        let visible = overlay_state
            .and_then(|s| s.visible)
            .unwrap_or(node.visible);

        if !visible {
            // Still push a placeholder so children can be skipped cleanly.
            tree.nodes.push(RenderNode {
                id: node_id,
                transform: node.transform.clone(),
                opacity: 0.0,
                visible: false,
                children: node.children.clone(),
                content: RenderContent::Group,
                material: None,
                blur_radius: 0.0,
                clip: false,
                draw_pass: crate::passes::DrawPass::Shape,
            });
            return;
        }

        // Opacity: animation override → node base opacity × dim factor.
        let dim = self.resolve_dim_factor(node_id);
        let opacity = if let Some(&anim_opacity) = self.animation.opacity.get(&node_id) {
            (anim_opacity * dim).clamp(0.0, 1.0)
        } else {
            let base_opacity = self.tokens.resolve_f32(&node.style.opacity).unwrap_or(1.0);
            (base_opacity * dim).clamp(0.0, 1.0)
        };

        // Transform: apply animated scale and y-offset on top of the node's own transform.
        let mut transform = node.transform.clone();
        if let Some(&scale) = self.animation.scale.get(&node_id) {
            transform.scale_x *= scale;
            transform.scale_y *= scale;
        }
        if let Some(&dy) = self.animation.y_offset.get(&node_id) {
            transform.y += dy;
        }

        let blur_radius = self
            .tokens
            .resolve_f32_or(&node.style.blur_radius, 0.0);

        let material = self.resolve_material(node);

        let content = self.resolve_content(node);

        let clip = match &node.data {
            NodeKind::Frame(f) => f.clip_content,
            _ => false,
        };

        let draw_pass = assign_draw_pass(&content, material.as_ref(), blur_radius);

        tree.nodes.push(RenderNode {
            id: node_id,
            transform,
            opacity,
            visible: true,
            children: node.children.clone(),
            content,
            material,
            blur_radius,
            clip,
            draw_pass,
        });

        // Recurse into children.
        for &child_id in &node.children {
            self.visit(child_id, tree);
        }
    }

    /// Resolve the effective dim multiplier for a node.
    ///
    /// When `dim_others_target` is set the focal node stays at full brightness
    /// while every other node is dimmed to `DEFAULT_DIM_OTHERS_FACTOR`.
    fn resolve_dim_factor(&self, node_id: NodeId) -> f32 {
        if let Some(target) = self.overlay.dim_others_target {
            if target == node_id {
                self.overlay
                    .node_states
                    .get(&node_id)
                    .map(|s| s.dim_factor)
                    .unwrap_or(1.0)
            } else {
                self.overlay
                    .node_states
                    .get(&node_id)
                    .map(|s| s.dim_factor)
                    .unwrap_or(DEFAULT_DIM_OTHERS_FACTOR)
            }
        } else {
            self.overlay
                .node_states
                .get(&node_id)
                .map(|s| s.dim_factor)
                .unwrap_or(1.0)
        }
    }

    fn resolve_material(&self, node: &motion_core::node::Node) -> Option<ResolvedMaterial> {
        let material_name = node
            .style
            .material
            .as_ref()
            .and_then(|m| self.tokens.resolve_string(m));

        if let Some(name) = material_name {
            return Some(self.resolve_named_material(name, node));
        }

        // Default: solid fill from node style.
        if let Some(fill_sv) = &node.style.fill {
            let color = self
                .tokens
                .resolve_color(fill_sv)
                .unwrap_or(Color::WHITE);
            return Some(ResolvedMaterial::Solid { color });
        }

        None
    }

    fn resolve_named_material(&self, name: &str, _node: &motion_core::node::Node) -> ResolvedMaterial {
        match name {
            "glass" => ResolvedMaterial::Glass(GlassMaterial {
                tint: Color { r: 1.0, g: 1.0, b: 1.0, a: 0.1 },
                opacity: 0.7,
                blur_radius: 16.0,
                saturation: 1.2,
                edge_highlight: Color { r: 1.0, g: 1.0, b: 1.0, a: 0.3 },
                noise_strength: 0.03,
            }),
            "glow" => ResolvedMaterial::Glow(GlowMaterial {
                color: Color { r: 0.4, g: 0.6, b: 1.0, a: 1.0 },
                radius: 24.0,
                intensity: 0.8,
            }),
            "card" => ResolvedMaterial::MatteCard(CardMaterial {
                background: Color { r: 0.12, g: 0.12, b: 0.14, a: 1.0 },
                corner_radius: 12.0,
                shadow_color: Color { r: 0.0, g: 0.0, b: 0.0, a: 0.4 },
                shadow_blur: 24.0,
                shadow_offset_y: 8.0,
            }),
            _ => {
                // Try to resolve as a token-based color.
                let color = self
                    .tokens
                    .resolve(&format!("material.{name}.color"), 4)
                    .and_then(|v| v.as_str())
                    .and_then(|s| motion_core::tokens::parse_hex_color(s))
                    .unwrap_or(Color::WHITE);
                ResolvedMaterial::Solid { color }
            }
        }
    }

    fn resolve_content(&self, node: &motion_core::node::Node) -> RenderContent {
        match &node.data {
            NodeKind::Frame(_) => RenderContent::Frame,
            NodeKind::Group(_) => RenderContent::Group,
            NodeKind::Shape(s) => {
                let fill = node
                    .style
                    .fill
                    .as_ref()
                    .and_then(|sv| self.tokens.resolve_color(sv));
                let stroke = node
                    .style
                    .stroke
                    .as_ref()
                    .and_then(|sv| self.tokens.resolve_color(sv));
                let stroke_width = self
                    .tokens
                    .resolve_f32_or(&node.style.stroke_width, 0.0);

                RenderContent::Shape {
                    kind: map_shape_kind(&s.kind),
                    fill,
                    stroke,
                    stroke_width,
                }
            }
            NodeKind::Text(t) => {
                let color = self
                    .tokens
                    .resolve_color(&t.color)
                    .unwrap_or(Color::BLACK);
                let font_family = self
                    .tokens
                    .resolve_string(&t.font_family)
                    .unwrap_or("sans-serif")
                    .to_string();
                let font_size = self
                    .tokens
                    .resolve_f32(&t.font_size)
                    .unwrap_or(16.0);
                let line_height = t
                    .line_height
                    .as_ref()
                    .and_then(|v| self.tokens.resolve_f32(v))
                    .unwrap_or(1.4);

                RenderContent::Text {
                    content: t.content.clone(),
                    color,
                    font_family,
                    font_size,
                    line_height,
                }
            }
            NodeKind::Image(img) => {
                let uri = self
                    .document
                    .assets
                    .assets
                    .iter()
                    .find(|a| a.id == img.asset_id)
                    .map(|a| a.uri.clone())
                    .unwrap_or_default();
                RenderContent::Image { uri }
            }
            NodeKind::Video(vid) => {
                let uri = self
                    .document
                    .assets
                    .assets
                    .iter()
                    .find(|a| a.id == vid.asset_id)
                    .map(|a| a.uri.clone())
                    .unwrap_or_default();
                RenderContent::Video { uri }
            }
            NodeKind::Chart(chart) => {
                self.build_chart_content(chart, node.id)
            }
            // Non-renderable node types fall back to a Group placeholder.
            NodeKind::Equation(_)
            | NodeKind::Diagram(_)
            | NodeKind::ComponentInstance(_) => RenderContent::Group,
        }
    }

    fn build_chart_content(
        &self,
        chart: &motion_core::node::ChartNode,
        node_id: NodeId,
    ) -> RenderContent {
        let chart_state = self.overlay.chart_states.get(&node_id);
        let highlighted: Vec<String> = chart_state
            .map(|s| s.highlighted_series.iter().cloned().collect())
            .unwrap_or_default();

        // Resolve title / subtitle.
        let title = chart
            .title
            .as_ref()
            .and_then(|v| self.tokens.resolve_string(v))
            .map(str::to_string)
            .or_else(|| match chart.title.as_ref() {
                Some(motion_core::node::StyleValue::Literal(s)) => Some(s.clone()),
                _ => None,
            });
        let subtitle = chart
            .subtitle
            .as_ref()
            .and_then(|v| self.tokens.resolve_string(v))
            .map(str::to_string)
            .or_else(|| match chart.subtitle.as_ref() {
                Some(motion_core::node::StyleValue::Literal(s)) => Some(s.clone()),
                _ => None,
            });

        let kind = map_chart_kind(&chart.kind);

        // Default palette for up to 8 series — resolved from brand tokens when available.
        let palette = default_chart_palette(self.tokens);

        match &chart.kind {
            CoreChartKind::Bar | CoreChartKind::Histogram => {
                let bars = resolve_bars(chart, &palette, self.tokens);
                RenderContent::Chart { kind, bars, lines: Vec::new(), title, subtitle, highlighted_series: highlighted }
            }
            CoreChartKind::Line | CoreChartKind::Area => {
                let filled = matches!(chart.kind, CoreChartKind::Area);
                let lines = resolve_lines(chart, &palette, self.tokens, filled);
                RenderContent::Chart { kind, bars: Vec::new(), lines, title, subtitle, highlighted_series: highlighted }
            }
            _ => {
                // All other kinds: emit bars if inline data is available, else group.
                let bars = resolve_bars(chart, &palette, self.tokens);
                if bars.is_empty() {
                    RenderContent::Group
                } else {
                    RenderContent::Chart { kind, bars, lines: Vec::new(), title, subtitle, highlighted_series: highlighted }
                }
            }
        }
    }
}

fn map_shape_kind(kind: &motion_core::node::ShapeKind) -> ShapeKind {
    match kind {
        motion_core::node::ShapeKind::Rectangle => ShapeKind::Rectangle,
        motion_core::node::ShapeKind::Ellipse => ShapeKind::Ellipse,
        motion_core::node::ShapeKind::RoundedRectangle { corner_radius } => {
            ShapeKind::RoundedRectangle { corner_radius: *corner_radius }
        }
        motion_core::node::ShapeKind::Line => ShapeKind::Line,
    }
}

fn map_chart_kind(kind: &CoreChartKind) -> ChartKind {
    match kind {
        CoreChartKind::Bar => ChartKind::Bar,
        CoreChartKind::Line => ChartKind::Line,
        CoreChartKind::Area => ChartKind::Area,
        CoreChartKind::Scatter => ChartKind::Scatter,
        CoreChartKind::Histogram => ChartKind::Histogram,
        CoreChartKind::Waterfall => ChartKind::Waterfall,
        CoreChartKind::Heatmap => ChartKind::Heatmap,
        CoreChartKind::Timeline => ChartKind::Timeline,
        CoreChartKind::Combo => ChartKind::Combo,
        CoreChartKind::StackedBar => ChartKind::StackedBar,
        CoreChartKind::StackedArea => ChartKind::StackedArea,
        CoreChartKind::Lollipop => ChartKind::Lollipop,
        CoreChartKind::Pareto => ChartKind::Pareto,
        CoreChartKind::Funnel => ChartKind::Funnel,
        CoreChartKind::Bullet => ChartKind::Bullet,
        CoreChartKind::Waffle => ChartKind::Waffle,
        CoreChartKind::Table => ChartKind::Table,
        CoreChartKind::Matrix => ChartKind::Matrix,
        CoreChartKind::KpiCard => ChartKind::KpiCard,
        CoreChartKind::Gantt => ChartKind::Gantt,
        CoreChartKind::Sparkline => ChartKind::Sparkline,
        CoreChartKind::Sankey => ChartKind::Sankey,
        CoreChartKind::Treemap => ChartKind::Treemap,
        CoreChartKind::Sunburst => ChartKind::Sunburst,
        CoreChartKind::Chord => ChartKind::Chord,
        CoreChartKind::Alluvial => ChartKind::Alluvial,
        CoreChartKind::Network => ChartKind::Network,
        CoreChartKind::RadialTree => ChartKind::RadialTree,
        CoreChartKind::Dendrogram => ChartKind::Dendrogram,
        CoreChartKind::Box => ChartKind::Box,
        CoreChartKind::Violin => ChartKind::Violin,
        CoreChartKind::Ridgeline => ChartKind::Ridgeline,
        CoreChartKind::Density => ChartKind::Density,
        CoreChartKind::ParallelCoordinates => ChartKind::ParallelCoordinates,
        CoreChartKind::Hexbin => ChartKind::Hexbin,
        CoreChartKind::Contour => ChartKind::Contour,
        CoreChartKind::ErrorBar => ChartKind::ErrorBar,
        CoreChartKind::Candlestick => ChartKind::Candlestick,
        CoreChartKind::Ohlc => ChartKind::Ohlc,
        CoreChartKind::WindRose => ChartKind::WindRose,
        CoreChartKind::Ternary => ChartKind::Ternary,
    }
}

/// Return up to 8 RGBA colours from the brand token palette, falling back to
/// a built-in set when tokens are absent.
fn default_chart_palette(tokens: &TokenStore) -> Vec<Color> {
    let token_paths = [
        "color.chart.positive",
        "color.chart.warning",
        "color.chart.neutral",
        "color.chart.best",
        "color.brand",
        "color.brand.alt",
    ];
    let built_in: [Color; 6] = [
        Color { r: 0.0, g: 0.745, b: 0.863, a: 1.0 }, // #00BEDC
        Color { r: 0.925, g: 0.4, b: 0.008, a: 1.0 },  // #EC6602
        Color { r: 0.486, g: 0.553, b: 0.651, a: 1.0 }, // #7C8DA6
        Color { r: 0.239, g: 0.863, b: 0.592, a: 1.0 }, // #3DDC97
        Color { r: 0.925, g: 0.4, b: 0.008, a: 1.0 },  // #EC6602 (brand)
        Color { r: 0.0, g: 0.745, b: 0.863, a: 1.0 },  // #00BEDC (brand alt)
    ];
    token_paths
        .iter()
        .zip(built_in.iter())
        .map(|(path, fallback)| {
            tokens
                .resolve(path, 4)
                .and_then(|v| v.as_str().and_then(motion_core::tokens::parse_hex_color))
                .unwrap_or_else(|| fallback.clone())
        })
        .collect()
}

/// Resolve inline table data from a chart into a list of [`ResolvedBar`]s.
///
/// Uses the first series that has a `y_field`; falls back to the first
/// numeric column if no series spec is present.  Returns an empty vec when
/// no usable data is found.
fn resolve_bars(
    chart: &motion_core::node::ChartNode,
    palette: &[Color],
    _tokens: &TokenStore,
) -> Vec<ResolvedBar> {
    let table = match &chart.data_source {
        ChartDataSource::Inline { table } => table,
        ChartDataSource::Asset { .. } => return Vec::new(),
    };
    if table.columns.is_empty() || table.rows.is_empty() {
        return Vec::new();
    }

    // Find label column (x-field) and value column (y-field).
    let x_col_idx = chart
        .series
        .first()
        .and_then(|s| s.x_field.as_deref())
        .and_then(|xf| table.columns.iter().position(|c| c.key == xf))
        .unwrap_or(0);
    let y_col_idx = chart
        .series
        .first()
        .and_then(|s| s.y_field.as_deref())
        .and_then(|yf| table.columns.iter().position(|c| c.key == yf))
        .or_else(|| {
            // Fall back to first numeric-looking column that is not the x column.
            table.columns.iter().position(|c| {
                matches!(
                    c.data_type,
                    motion_core::node::ChartValueType::Number
                )
            })
        })
        .unwrap_or(1.min(table.columns.len().saturating_sub(1)));

    // Collect raw values.
    let raw_values: Vec<(String, f64)> = table
        .rows
        .iter()
        .map(|row| {
            let label = row
                .values
                .get(x_col_idx)
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    row.values.get(x_col_idx).map(|v| v.to_string())
                })
                .unwrap_or_default();
            let value = row
                .values
                .get(y_col_idx)
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            (label, value)
        })
        .collect();

    let max_val = raw_values
        .iter()
        .map(|(_, v)| *v)
        .fold(f64::MIN, f64::max)
        .max(1.0);

    raw_values
        .into_iter()
        .enumerate()
        .map(|(i, (label, value))| {
            let series = chart
                .series
                .get(i)
                .map(|s| s.id.clone())
                .unwrap_or_else(|| format!("series-{i}"));
            let color = palette.get(i % palette.len()).cloned().unwrap_or(Color::WHITE);
            ResolvedBar {
                label,
                value_norm: (value / max_val) as f32,
                value,
                color,
                series_id: series,
            }
        })
        .collect()
}

/// Resolve inline table data into line/area series.
fn resolve_lines(
    chart: &motion_core::node::ChartNode,
    palette: &[Color],
    _tokens: &TokenStore,
    filled: bool,
) -> Vec<ResolvedLineSeries> {
    let table = match &chart.data_source {
        ChartDataSource::Inline { table } => table,
        ChartDataSource::Asset { .. } => return Vec::new(),
    };
    if table.columns.is_empty() || table.rows.is_empty() {
        return Vec::new();
    }

    // One series per spec; default to a single series using col 0 (x) + col 1 (y).
    let specs: Vec<(String, String, usize, usize)> = if chart.series.is_empty() {
        vec![("series-1".to_string(), "Series 1".to_string(), 0, 1.min(table.columns.len().saturating_sub(1)))]
    } else {
        chart
            .series
            .iter()
            .map(|s| {
                let xi = s
                    .x_field
                    .as_deref()
                    .and_then(|f| table.columns.iter().position(|c| c.key == f))
                    .unwrap_or(0);
                let yi = s
                    .y_field
                    .as_deref()
                    .and_then(|f| table.columns.iter().position(|c| c.key == f))
                    .unwrap_or(1.min(table.columns.len().saturating_sub(1)));
                (s.id.clone(), s.label.clone().unwrap_or_else(|| s.id.clone()), xi, yi)
            })
            .collect()
    };

    specs
        .into_iter()
        .enumerate()
        .map(|(si, (id, label, xi, yi))| {
            let raw: Vec<(f64, f64)> = table
                .rows
                .iter()
                .map(|row| {
                    let x = row.values.get(xi).and_then(|v| v.as_f64()).unwrap_or(si as f64);
                    let y = row.values.get(yi).and_then(|v| v.as_f64()).unwrap_or(0.0);
                    (x, y)
                })
                .collect();
            let x_min = raw.iter().map(|(x, _)| *x).fold(f64::MAX, f64::min);
            let x_max = raw.iter().map(|(x, _)| *x).fold(f64::MIN, f64::max).max(x_min + 1.0);
            let y_min = 0.0_f64;
            let y_max = raw.iter().map(|(_, y)| *y).fold(f64::MIN, f64::max).max(1.0);
            let points = raw
                .into_iter()
                .map(|(x, y)| {
                    [
                        ((x - x_min) / (x_max - x_min)) as f32,
                        ((y - y_min) / (y_max - y_min)) as f32,
                    ]
                })
                .collect();
            let color = palette.get(si % palette.len()).cloned().unwrap_or(Color::WHITE);
            ResolvedLineSeries { series_id: id, label, points, color, filled }
        })
        .collect()
}

// ------------------------------------------------------------------
// Gradient helpers (used when resolving CSS-like gradient tokens)
// ------------------------------------------------------------------

/// Build a simple two-stop linear gradient from two hex colors.
pub fn linear_gradient(
    angle_deg: f32,
    from_hex: &str,
    to_hex: &str,
) -> Option<GradientSpec> {
    let from = motion_core::tokens::parse_hex_color(from_hex)?;
    let to = motion_core::tokens::parse_hex_color(to_hex)?;
    Some(GradientSpec {
        kind: crate::material::GradientKind::Linear { angle_deg },
        stops: vec![
            GradientStop { offset: 0.0, color: from },
            GradientStop { offset: 1.0, color: to },
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use motion_core::{
        document::Document,
        engine::PresentationOverlay,
        node::{FrameNode, Node, NodeKind, ShapeNode, ShapeKind as CoreShapeKind, TextNode},
        scene::Scene,
    };

    fn make_doc() -> (Document, SceneId) {
        let mut doc = Document::new("Test");
        let root = Node::new("Root", NodeKind::Frame(FrameNode { clip_content: false, corner_radius: None }));
        let root_id = root.id;
        doc.insert_node(root);
        let scene = Scene::new("S1", root_id);
        let sid = scene.id;
        doc.scenes.push(scene);
        (doc, sid)
    }

    #[test]
    fn builds_empty_scene() {
        let (doc, sid) = make_doc();
        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        assert_eq!(tree.viewport_width, 1920.0);
        assert_eq!(tree.roots.len(), 1);
        // Only the root frame
        assert_eq!(tree.nodes.len(), 1);
    }

    #[test]
    fn text_node_resolved() {
        let (mut doc, sid) = make_doc();
        doc.tokens.tokens.insert(
            "color.text.primary".into(),
            motion_core::tokens::TokenValue::Scalar(serde_json::json!("#FFFFFF")),
        );
        doc.tokens.tokens.insert(
            "typography.body.size".into(),
            motion_core::tokens::TokenValue::Scalar(serde_json::json!(18.0)),
        );
        doc.tokens.tokens.insert(
            "typography.body.font".into(),
            motion_core::tokens::TokenValue::Scalar(serde_json::json!("Inter")),
        );

        let root_id = doc.scenes[0].root;
        let mut text_node = Node::new("Title", NodeKind::Text(TextNode::default()));
        text_node.parent = Some(root_id);
        let text_id = text_node.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(text_id);
        doc.insert_node(text_node);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let render_node = tree.nodes.iter().find(|n| n.id == text_id).unwrap();
        if let RenderContent::Text { color, font_size, font_family, .. } = &render_node.content {
            assert!((color.r - 1.0).abs() < 0.01);
            assert!((font_size - 18.0).abs() < 0.01);
            assert_eq!(font_family, "Inter");
        } else {
            panic!("expected Text content");
        }
    }

    #[test]
    fn hidden_node_via_overlay() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Box", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let mut overlay = PresentationOverlay::default();
        overlay.node_states.entry(shape_id).or_default().visible = Some(false);

        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert!(!rn.visible);
        assert_eq!(rn.opacity, 0.0);
    }

    #[test]
    fn dim_others_overlay_applies_default_dimming() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;

        let mut first = Node::new("First", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        first.parent = Some(root_id);
        let first_id = first.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(first_id);
        doc.insert_node(first);

        let mut second = Node::new("Second", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        second.parent = Some(root_id);
        let second_id = second.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(second_id);
        doc.insert_node(second);

        let mut overlay = PresentationOverlay::default();
        overlay.dim_others_target = Some(first_id);

        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let first_node = tree.nodes.iter().find(|n| n.id == first_id).unwrap();
        let second_node = tree.nodes.iter().find(|n| n.id == second_id).unwrap();
        const FLOAT_COMPARISON_TOLERANCE: f32 = 0.01;
        assert_eq!(first_node.opacity, 1.0);
        assert!(second_node.opacity < DEFAULT_DIM_OTHERS_FACTOR + FLOAT_COMPARISON_TOLERANCE);
    }

    #[test]
    fn animation_frame_opacity_override_applied() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Box", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let mut anim = AnimationFrame::default();
        anim.opacity.insert(shape_id, 0.5);

        let builder = RenderTreeBuilder::with_animation(&doc, &overlay, &anim);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert!((rn.opacity - 0.5).abs() < 0.01, "opacity should be 0.5 but got {}", rn.opacity);
    }

    #[test]
    fn animation_frame_scale_override_applied() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Box", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let mut anim = AnimationFrame::default();
        anim.scale.insert(shape_id, 0.5);

        let builder = RenderTreeBuilder::with_animation(&doc, &overlay, &anim);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        // Default scale_x/y is 1.0, multiplied by 0.5
        assert!((rn.transform.scale_x - 0.5).abs() < 0.01);
        assert!((rn.transform.scale_y - 0.5).abs() < 0.01);
    }

    #[test]
    fn animation_frame_y_offset_applied() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Box", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let base_y = doc.nodes[&shape_id].transform.y;
        let overlay = PresentationOverlay::default();
        let mut anim = AnimationFrame::default();
        anim.y_offset.insert(shape_id, 40.0);

        let builder = RenderTreeBuilder::with_animation(&doc, &overlay, &anim);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert!((rn.transform.y - (base_y + 40.0)).abs() < 0.01);
    }

    // ── Draw pass assignment ───────────────────────────────────────────────────

    #[test]
    fn shape_node_gets_shape_pass() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Box", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Shape);
    }

    #[test]
    fn text_node_gets_text_pass() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut text_node = Node::new("Title", NodeKind::Text(TextNode::default()));
        text_node.parent = Some(root_id);
        let text_id = text_node.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(text_id);
        doc.insert_node(text_node);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == text_id).unwrap();
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Text);
    }

    #[test]
    fn hidden_node_placeholder_has_shape_pass() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Hidden", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let mut overlay = PresentationOverlay::default();
        overlay.node_states.entry(shape_id).or_default().visible = Some(false);

        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert!(!rn.visible);
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Shape);
    }

    #[test]
    fn frame_root_gets_shape_pass() {
        let (doc, sid) = make_doc();
        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let root = &tree.nodes[0];
        assert_eq!(root.draw_pass, crate::passes::DrawPass::Shape);
    }

    #[test]
    fn blurred_node_gets_blur_pass() {
        use motion_core::node::{StyleValue};
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Blurry", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        shape.style.blur_radius = Some(StyleValue::Literal(8.0));
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Blur);
    }

    #[test]
    fn glass_material_node_gets_glass_pass() {
        use motion_core::node::StyleValue;
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Glass", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        shape.style.material = Some(StyleValue::Literal("glass".into()));
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Glass);
    }

    #[test]
    fn card_material_node_gets_shadow_pass() {
        use motion_core::node::StyleValue;
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Card", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        shape.style.material = Some(StyleValue::Literal("card".into()));
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        // MatteCard is a CSS drop-shadow surface — it renders in the Shape pass.
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Shape);
    }

    #[test]
    fn glow_material_node_gets_composite_pass() {
        use motion_core::node::StyleValue;
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;
        let mut shape = Node::new("Glow", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        shape.style.material = Some(StyleValue::Literal("glow".into()));
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();
        let rn = tree.nodes.iter().find(|n| n.id == shape_id).unwrap();
        assert_eq!(rn.draw_pass, crate::passes::DrawPass::Composite);
    }

    #[test]
    fn pass_ordered_traversal_shape_before_text() {
        let (mut doc, sid) = make_doc();
        let root_id = doc.scenes[0].root;

        let mut text_node = Node::new("Title", NodeKind::Text(TextNode::default()));
        text_node.parent = Some(root_id);
        let text_id = text_node.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(text_id);
        doc.insert_node(text_node);

        let mut shape = Node::new("BgBox", NodeKind::Shape(ShapeNode { kind: CoreShapeKind::Rectangle }));
        shape.parent = Some(root_id);
        let shape_id = shape.id;
        doc.nodes.get_mut(&root_id).unwrap().children.push(shape_id);
        doc.insert_node(shape);

        let overlay = PresentationOverlay::default();
        let builder = RenderTreeBuilder::new(&doc, &overlay);
        let tree = builder.build(sid, 1920.0, 1080.0, 1.0).unwrap();

        let ordered = tree.pass_ordered_nodes();
        let shape_pos = ordered.iter().position(|n| n.id == shape_id).unwrap();
        let text_pos = ordered.iter().position(|n| n.id == text_id).unwrap();
        assert!(shape_pos < text_pos, "shape should be drawn before text");
    }
}
