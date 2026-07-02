//! Draw passes — ordered GPU render passes for a full scene frame.

use serde::{Deserialize, Serialize};

use crate::{material::ResolvedMaterial, render_tree::RenderContent};

/// The ordered set of draw passes executed per frame.
///
/// Variants are declared in draw order (lowest discriminant = drawn first).
/// Deriving [`Ord`] therefore gives correct back-to-front pass ordering.
///
/// | Pass        | When used |
/// |-------------|-----------|
/// | `Shape`     | Solid/gradient fills, rectangle/ellipse/line primitives |
/// | `ImageVideo`| Image and video textures |
/// | `Text`      | Glyph-atlas text |
/// | `Shadow`    | Matte-card drop shadows rendered before overlying surfaces |
/// | `Blur`      | Gaussian / backdrop blur passes |
/// | `Mask`      | Stencil-based clip/mask application |
/// | `Glass`     | Frosted-glass refraction (requires backdrop to be rendered first) |
/// | `Particles` | GPU particle systems |
/// | `Composite` | Final alpha compositing of all layers |
/// | `ColorGrade`| Post-process color grading / tone mapping |
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawPass {
    /// Rasterize solid/gradient shapes.
    Shape,
    /// Draw image and video textures.
    ImageVideo,
    /// Render glyph atlas text.
    Text,
    /// Directional/ambient shadow maps (rendered before overlying surfaces).
    Shadow,
    /// Gaussian/backdrop blur.
    Blur,
    /// Stencil-based clip/mask application.
    Mask,
    /// Glass surface with refraction approximation.
    Glass,
    /// GPU particle systems.
    Particles,
    /// Final alpha compositing of all layers.
    Composite,
    /// Post-process color grading / tone mapping.
    ColorGrade,
}

/// Assign a [`DrawPass`] to a node based on its resolved content and material.
///
/// This is a pure function so that it can be called both during render-tree
/// construction and inside GPU command schedulers.
///
/// Priority (highest wins):
/// 1. Glass material  → [`DrawPass::Glass`]
/// 2. Glow material → [`DrawPass::Composite`]
/// 3. Blur radius > 0 → [`DrawPass::Blur`]
/// 4. Text content → [`DrawPass::Text`]
/// 5. Image / Video content → [`DrawPass::ImageVideo`]
/// 6. Everything else (including `MatteCard`) → [`DrawPass::Shape`]
///
/// Note: [`DrawPass::Shadow`] is reserved for future depth shadow map pre-passes
/// (à la GPU shadow mapping).  Matte-card drop shadows are CSS-style decorations
/// attached to the card surface and therefore belong in the [`DrawPass::Shape`] pass.
pub fn assign_draw_pass(
    content: &RenderContent,
    material: Option<&ResolvedMaterial>,
    blur_radius: f32,
) -> DrawPass {
    // Material-driven overrides take highest precedence.
    if let Some(mat) = material {
        match mat {
            ResolvedMaterial::Glass(_) => return DrawPass::Glass,
            ResolvedMaterial::Glow(_) => return DrawPass::Composite,
            // MatteCard is a solid surface with a CSS-style drop shadow —
            // it renders in the Shape pass alongside other background surfaces.
            ResolvedMaterial::Solid { .. }
            | ResolvedMaterial::MatteCard(_)
            | ResolvedMaterial::Gradient(_) => {}
        }
    }

    // Blur passes need their own layer.
    if blur_radius > 0.0 {
        return DrawPass::Blur;
    }

    // Content-driven assignment.
    match content {
        RenderContent::Text { .. } => DrawPass::Text,
        RenderContent::Image { .. } | RenderContent::Video { .. } => DrawPass::ImageVideo,
        _ => DrawPass::Shape,
    }
}

/// Describes which render tiers are supported by the current browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderTier {
    /// Full WebGPU with all effects.
    WebGpu,
    /// Reduced effects via WebGL2.
    WebGl2,
    /// Static/Canvas fallback with minimal effects.
    Canvas,
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        material::{CardMaterial, GlassMaterial, GlowMaterial, GradientKind, GradientSpec, GradientStop},
        render_tree::{RenderContent, ShapeKind},
    };
    use motion_core::node::Color;

    fn white() -> Color {
        Color { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }
    }

    fn solid_material() -> ResolvedMaterial {
        ResolvedMaterial::Solid { color: white() }
    }

    fn glass_material() -> ResolvedMaterial {
        ResolvedMaterial::Glass(GlassMaterial {
            tint: white(),
            opacity: 0.7,
            blur_radius: 16.0,
            saturation: 1.2,
            edge_highlight: white(),
            noise_strength: 0.03,
        })
    }

    fn card_material() -> ResolvedMaterial {
        ResolvedMaterial::MatteCard(CardMaterial {
            background: white(),
            corner_radius: 12.0,
            shadow_color: Color { r: 0.0, g: 0.0, b: 0.0, a: 0.4 },
            shadow_blur: 24.0,
            shadow_offset_y: 8.0,
        })
    }

    fn glow_material() -> ResolvedMaterial {
        ResolvedMaterial::Glow(GlowMaterial { color: white(), radius: 24.0, intensity: 0.8 })
    }

    fn gradient_material() -> ResolvedMaterial {
        ResolvedMaterial::Gradient(GradientSpec {
            kind: GradientKind::Linear { angle_deg: 45.0 },
            stops: vec![
                GradientStop { offset: 0.0, color: white() },
                GradientStop { offset: 1.0, color: Color { r: 0.0, g: 0.0, b: 0.0, a: 1.0 } },
            ],
        })
    }

    fn shape_content() -> RenderContent {
        RenderContent::Shape { kind: ShapeKind::Rectangle, fill: None, stroke: None, stroke_width: 0.0 }
    }

    fn text_content() -> RenderContent {
        RenderContent::Text {
            content: "hello".into(),
            color: white(),
            font_family: "sans-serif".into(),
            font_size: 16.0,
            line_height: 1.4,
        }
    }

    fn image_content() -> RenderContent {
        RenderContent::Image { uri: "https://example.com/img.png".into() }
    }

    fn video_content() -> RenderContent {
        RenderContent::Video { uri: "https://example.com/vid.mp4".into() }
    }

    // ── assign_draw_pass ───────────────────────────────────────────────────────

    #[test]
    fn shape_no_material_no_blur_returns_shape_pass() {
        assert_eq!(assign_draw_pass(&shape_content(), None, 0.0), DrawPass::Shape);
    }

    #[test]
    fn shape_with_solid_material_returns_shape_pass() {
        assert_eq!(assign_draw_pass(&shape_content(), Some(&solid_material()), 0.0), DrawPass::Shape);
    }

    #[test]
    fn shape_with_gradient_material_returns_shape_pass() {
        assert_eq!(assign_draw_pass(&shape_content(), Some(&gradient_material()), 0.0), DrawPass::Shape);
    }

    #[test]
    fn text_no_material_returns_text_pass() {
        assert_eq!(assign_draw_pass(&text_content(), None, 0.0), DrawPass::Text);
    }

    #[test]
    fn text_with_solid_material_returns_text_pass() {
        // Material doesn't override text content.
        assert_eq!(assign_draw_pass(&text_content(), Some(&solid_material()), 0.0), DrawPass::Text);
    }

    #[test]
    fn image_content_returns_image_video_pass() {
        assert_eq!(assign_draw_pass(&image_content(), None, 0.0), DrawPass::ImageVideo);
    }

    #[test]
    fn video_content_returns_image_video_pass() {
        assert_eq!(assign_draw_pass(&video_content(), None, 0.0), DrawPass::ImageVideo);
    }

    #[test]
    fn glass_material_overrides_content_pass() {
        // Even a text node with a glass material renders in the Glass pass.
        assert_eq!(assign_draw_pass(&text_content(), Some(&glass_material()), 0.0), DrawPass::Glass);
        assert_eq!(assign_draw_pass(&shape_content(), Some(&glass_material()), 0.0), DrawPass::Glass);
        assert_eq!(assign_draw_pass(&image_content(), Some(&glass_material()), 0.0), DrawPass::Glass);
    }

    #[test]
    fn card_material_overrides_to_shadow_pass() {
        // MatteCard is a CSS-style drop-shadow surface — it renders in the Shape pass.
        assert_eq!(assign_draw_pass(&shape_content(), Some(&card_material()), 0.0), DrawPass::Shape);
        assert_eq!(assign_draw_pass(&text_content(), Some(&card_material()), 0.0), DrawPass::Text);
    }

    #[test]
    fn glow_material_overrides_to_composite_pass() {
        assert_eq!(assign_draw_pass(&shape_content(), Some(&glow_material()), 0.0), DrawPass::Composite);
    }

    #[test]
    fn non_zero_blur_returns_blur_pass_when_no_special_material() {
        assert_eq!(assign_draw_pass(&shape_content(), None, 8.0), DrawPass::Blur);
        assert_eq!(assign_draw_pass(&text_content(), None, 4.0), DrawPass::Blur);
    }

    #[test]
    fn blur_is_overridden_by_glass_material() {
        // Glass material wins even when blur_radius > 0.
        assert_eq!(assign_draw_pass(&shape_content(), Some(&glass_material()), 8.0), DrawPass::Glass);
    }

    #[test]
    fn blur_is_overridden_by_card_material() {
        // MatteCard doesn't override the Blur pass — blur wins over card material.
        assert_eq!(assign_draw_pass(&shape_content(), Some(&card_material()), 8.0), DrawPass::Blur);
    }

    #[test]
    fn frame_and_group_content_return_shape_pass() {
        assert_eq!(assign_draw_pass(&RenderContent::Frame, None, 0.0), DrawPass::Shape);
        assert_eq!(assign_draw_pass(&RenderContent::Group, None, 0.0), DrawPass::Shape);
    }

    // ── DrawPass ordering ─────────────────────────────────────────────────────

    #[test]
    fn draw_pass_order_is_shape_before_text() {
        assert!(DrawPass::Shape < DrawPass::Text);
    }

    #[test]
    fn draw_pass_order_is_image_before_text() {
        assert!(DrawPass::ImageVideo < DrawPass::Text);
    }

    #[test]
    fn draw_pass_order_shape_before_blur() {
        assert!(DrawPass::Shape < DrawPass::Blur);
    }

    #[test]
    fn draw_pass_order_blur_before_glass() {
        assert!(DrawPass::Blur < DrawPass::Glass);
    }

    #[test]
    fn draw_pass_order_glass_before_composite() {
        assert!(DrawPass::Glass < DrawPass::Composite);
    }

    #[test]
    fn draw_pass_order_composite_before_color_grade() {
        assert!(DrawPass::Composite < DrawPass::ColorGrade);
    }

    #[test]
    fn draw_pass_is_copy() {
        let p = DrawPass::Text;
        let _q = p; // copy
        let _r = p; // still usable
    }

    // ── RenderTier ────────────────────────────────────────────────────────────

    #[test]
    fn render_tier_equality() {
        assert_eq!(RenderTier::WebGpu, RenderTier::WebGpu);
        assert_ne!(RenderTier::WebGpu, RenderTier::Canvas);
    }

    #[test]
    fn render_tier_is_copy() {
        let t = RenderTier::WebGl2;
        let _u = t;
        let _v = t;
    }

    #[test]
    fn draw_pass_serde_round_trips() {
        for pass in [
            DrawPass::Shape,
            DrawPass::ImageVideo,
            DrawPass::Text,
            DrawPass::Shadow,
            DrawPass::Blur,
            DrawPass::Mask,
            DrawPass::Glass,
            DrawPass::Particles,
            DrawPass::Composite,
            DrawPass::ColorGrade,
        ] {
            let json = serde_json::to_string(&pass).unwrap();
            let decoded: DrawPass = serde_json::from_str(&json).unwrap();
            assert_eq!(decoded, pass, "serde round-trip failed for {:?}", pass);
        }
    }

    #[test]
    fn render_tier_serde_round_trips() {
        for tier in [RenderTier::WebGpu, RenderTier::WebGl2, RenderTier::Canvas] {
            let json = serde_json::to_string(&tier).unwrap();
            let decoded: RenderTier = serde_json::from_str(&json).unwrap();
            assert_eq!(decoded, tier);
        }
    }
}
