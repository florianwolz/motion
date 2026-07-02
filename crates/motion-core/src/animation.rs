//! Animation system — easing, keyframes, and timeline evaluation.

use serde::{Deserialize, Serialize};

use crate::tokens::TokenRef;

/// A cubic-bezier easing curve.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CubicBezier {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
}

impl CubicBezier {
    pub const LINEAR: Self = Self { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 };
    pub const EASE: Self = Self { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1.0 };
    /// Motion-design "precise" curve from the token spec.
    pub const PRECISE: Self = Self { x1: 0.2, y1: 0.0, x2: 0.0, y2: 1.0 };
    /// Motion-design "premium" spring-like curve.
    pub const PREMIUM: Self = Self { x1: 0.16, y1: 1.0, x2: 0.3, y2: 1.0 };
}

/// Spring physics parameters for spring-based animation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpringParams {
    pub mass: f32,
    pub stiffness: f32,
    pub damping: f32,
}

impl Default for SpringParams {
    fn default() -> Self {
        Self {
            mass: 1.0,
            stiffness: 180.0,
            damping: 24.0,
        }
    }
}

/// An easing specification — either a cubic-bezier or a spring.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Easing {
    CubicBezier(CubicBezier),
    Spring(SpringParams),
    /// Resolved at runtime from a token reference.
    Token(TokenRef),
}

impl Default for Easing {
    fn default() -> Self {
        Self::CubicBezier(CubicBezier::PRECISE)
    }
}

/// Named animation preset identifiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnimationPreset {
    FadeIn,
    FadeOut,
    SlideIn,
    ScaleIn,
    PopIn,
    Draw,
    Grow,
    Morph,
    Focus,
    Highlight,
    Collapse,
    Expand,
    Ripple,
    Pulse,
    Float,
    Orbit,
    CameraZoom,
    CameraPan,
    StaggeredReveal,
    KineticTextReveal,
    Custom(String),
}

/// A single keyframe for a named property.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    /// Time offset in milliseconds from the start of the animation.
    pub time_ms: f32,
    pub value: serde_json::Value,
    pub easing: Option<Easing>,
}

/// An animation track targeting one property on one node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimationTrack {
    pub node_id: crate::node::NodeId,
    /// Dotted property path, e.g. `"transform.x"`.
    pub property: String,
    pub keyframes: Vec<Keyframe>,
}

/// The runtime state machine for a live presentation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeState {
    Loading,
    Preflight,
    Ready,
    Presenting,
    Paused,
    FallbackMode,
    Error,
}

/// High-level navigation commands during presentation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NavigationCommand {
    NextStep,
    PreviousStep,
    JumpToScene { scene_id: crate::scene::SceneId },
    JumpToStep { step_id: crate::scene::StepId },
    RestartCurrentScene,
    Pause,
    Resume,
    BlackScreen,
}
