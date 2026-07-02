//! Render tree builder — converts a scene graph into a resolved `RenderTree`.
//!
//! All token references are resolved using the document's `TokenStore` and the
//! presentation overlay's per-node overrides are applied so that the renderer
//! receives fully concrete values.

use motion_core::{
    document::Document,
    engine::PresentationOverlay,
    node::{Color, NodeId, NodeKind},
    scene::SceneId,
    tokens::TokenStore,
};

use crate::{
    material::{CardMaterial, GlassMaterial, GlowMaterial, GradientSpec, GradientStop, ResolvedMaterial},
    render_tree::{RenderContent, RenderNode, RenderTree, ShapeKind},
};

const DEFAULT_DIM_OTHERS_FACTOR: f32 = 0.3;

/// Builds a [`RenderTree`] for one scene frame.
pub struct RenderTreeBuilder<'a> {
    document: &'a Document,
    overlay: &'a PresentationOverlay,
    tokens: &'a TokenStore,
}

impl<'a> RenderTreeBuilder<'a> {
    /// Create a new builder.
    pub fn new(document: &'a Document, overlay: &'a PresentationOverlay) -> Self {
        Self { document, overlay, tokens: &document.tokens }
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
            });
            return;
        }

        // Opacity: multiply node opacity by dim factor from overlay.
        let base_opacity = self.tokens.resolve_f32(&node.style.opacity).unwrap_or(1.0);
        let dim = if let Some(target) = self.overlay.dim_others_target {
            if target == node_id {
                overlay_state.map(|s| s.dim_factor).unwrap_or(1.0)
            } else {
                overlay_state
                    .map(|s| s.dim_factor)
                    .unwrap_or(DEFAULT_DIM_OTHERS_FACTOR)
            }
        } else {
            overlay_state.map(|s| s.dim_factor).unwrap_or(1.0)
        };
        let opacity = (base_opacity * dim).clamp(0.0, 1.0);

        let blur_radius = self
            .tokens
            .resolve_f32_or(&node.style.blur_radius, 0.0);

        let material = self.resolve_material(node);

        let content = self.resolve_content(node);

        let clip = match &node.data {
            NodeKind::Frame(f) => f.clip_content,
            _ => false,
        };

        tree.nodes.push(RenderNode {
            id: node_id,
            transform: node.transform.clone(),
            opacity,
            visible: true,
            children: node.children.clone(),
            content,
            material,
            blur_radius,
            clip,
        });

        // Recurse into children.
        for &child_id in &node.children {
            self.visit(child_id, tree);
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
            // Non-renderable node types fall back to a Group placeholder.
            NodeKind::Chart(_)
            | NodeKind::Equation(_)
            | NodeKind::Diagram(_)
            | NodeKind::ComponentInstance(_) => RenderContent::Group,
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
}
