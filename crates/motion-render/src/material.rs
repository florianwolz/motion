//! Material system — resolved surface materials for rendering.

use motion_core::node::Color;
use serde::{Deserialize, Serialize};

/// A fully resolved material with no remaining token references.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResolvedMaterial {
    Solid { color: Color },
    Gradient(GradientSpec),
    Glass(GlassMaterial),
    MatteCard(CardMaterial),
    Glow(GlowMaterial),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientStop {
    pub offset: f32,
    pub color: Color,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GradientKind {
    Linear { angle_deg: f32 },
    Radial,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientSpec {
    pub kind: GradientKind,
    pub stops: Vec<GradientStop>,
}

/// Glass / frosted-glass material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlassMaterial {
    pub tint: Color,
    pub opacity: f32,
    pub blur_radius: f32,
    pub saturation: f32,
    pub edge_highlight: Color,
    pub noise_strength: f32,
}

/// Matte card (solid surface with optional shadow).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CardMaterial {
    pub background: Color,
    pub corner_radius: f32,
    pub shadow_color: Color,
    pub shadow_blur: f32,
    pub shadow_offset_y: f32,
}

/// Glow / neon material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlowMaterial {
    pub color: Color,
    pub radius: f32,
    pub intensity: f32,
}
