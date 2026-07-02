//! Draw passes — ordered GPU render passes for a full scene frame.

use serde::{Deserialize, Serialize};

/// The ordered set of draw passes executed per frame.
///
/// Each pass writes into an offscreen texture (or directly to the swap chain).
/// The composite pass combines them into the final output.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DrawPass {
    /// Rasterize solid/gradient shapes.
    Shape,
    /// Render glyph atlas text.
    Text,
    /// Draw image and video textures.
    ImageVideo,
    /// Directional/ambient shadow maps.
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

/// Describes which render tiers are supported by the current browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderTier {
    /// Full WebGPU with all effects.
    WebGpu,
    /// Reduced effects via WebGL2.
    WebGl2,
    /// Static/Canvas fallback with minimal effects.
    Canvas,
}
