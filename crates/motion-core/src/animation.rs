//! Animation system — easing, keyframes, interpolation, and timeline evaluation.

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

    /// Evaluate the easing curve at input time `t ∈ [0, 1]` and return the
    /// output value `y ∈ [0, 1]`.
    ///
    /// Uses Newton's method to invert the x-axis Bézier, then evaluates the
    /// y-axis at the resulting Bézier parameter.
    pub fn evaluate(&self, t: f32) -> f32 {
        if t <= 0.0 {
            return 0.0;
        }
        if t >= 1.0 {
            return 1.0;
        }
        // Find the Bézier parameter `s` such that `bezier_x(s) == t`.
        let s = self.solve_t_for_x(t);
        self.bezier_y(s)
    }

    fn bezier_x(&self, s: f32) -> f32 {
        let inv = 1.0 - s;
        3.0 * inv * inv * s * self.x1 + 3.0 * inv * s * s * self.x2 + s * s * s
    }

    fn bezier_y(&self, s: f32) -> f32 {
        let inv = 1.0 - s;
        3.0 * inv * inv * s * self.y1 + 3.0 * inv * s * s * self.y2 + s * s * s
    }

    fn bezier_x_deriv(&self, s: f32) -> f32 {
        let inv = 1.0 - s;
        3.0 * inv * inv * self.x1 + 6.0 * inv * s * (self.x2 - self.x1) + 3.0 * s * s * (1.0 - self.x2)
    }

    fn solve_t_for_x(&self, x: f32) -> f32 {
        let mut s = x; // initial guess
        for _ in 0..8 {
            let current_x = self.bezier_x(s) - x;
            if current_x.abs() < 1e-6 {
                break;
            }
            let deriv = self.bezier_x_deriv(s);
            if deriv.abs() < 1e-8 {
                break;
            }
            s -= current_x / deriv;
            s = s.clamp(0.0, 1.0);
        }
        s
    }
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

impl SpringParams {
    /// Evaluate the spring displacement at time `t_sec` (seconds).
    ///
    /// Assumes initial displacement of 1.0 and initial velocity of 0.0,
    /// targeting a final displacement of 0.0 (spring rest position).
    /// Returns the *progress* value in `[0, 1]` (i.e. `1.0 - displacement`).
    pub fn evaluate(&self, t_sec: f32) -> f32 {
        if t_sec <= 0.0 {
            return 0.0;
        }
        let k = self.stiffness;
        let m = self.mass;
        let c = self.damping;

        let omega0 = (k / m).sqrt(); // natural frequency
        let zeta = c / (2.0 * (k * m).sqrt()); // damping ratio

        let displacement = if zeta < 1.0 {
            // Underdamped
            let omega_d = omega0 * (1.0 - zeta * zeta).sqrt();
            (-zeta * omega0 * t_sec).exp()
                * (zeta * omega0 / omega_d * (omega_d * t_sec).sin()
                    + (omega_d * t_sec).cos())
        } else if (zeta - 1.0).abs() < 1e-6 {
            // Critically damped
            (-(omega0 * t_sec)).exp() * (1.0 + omega0 * t_sec)
        } else {
            // Overdamped
            let omega_d = omega0 * (zeta * zeta - 1.0).sqrt();
            let alpha = zeta * omega0;
            let c1 = (alpha + omega_d) / (2.0 * omega_d);
            let c2 = (omega_d - alpha) / (2.0 * omega_d);
            c1 * ((-alpha + omega_d) * t_sec).exp() + c2 * ((-alpha - omega_d) * t_sec).exp()
        };

        // Convert displacement → progress (spring settles toward 1.0)
        (1.0 - displacement).clamp(0.0, 1.0)
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

impl Easing {
    /// Evaluate the easing at normalized time `t ∈ [0, 1]`.
    /// Spring easings accept `t` as seconds; use [`Self::evaluate_spring_sec`]
    /// for those.
    pub fn evaluate(&self, t: f32) -> f32 {
        match self {
            Easing::CubicBezier(cb) => cb.evaluate(t),
            Easing::Spring(sp) => sp.evaluate(t),
            Easing::Token(_) => t, // unresolved: fall back to linear
        }
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

impl AnimationTrack {
    /// Evaluate the interpolated value at time `t_ms`.
    ///
    /// Returns the interpolated JSON value, or `None` if the track has no
    /// keyframes.  Only numeric (f64) values are interpolated; other types
    /// snap to the nearest keyframe.
    pub fn evaluate_at(&self, t_ms: f32) -> Option<serde_json::Value> {
        if self.keyframes.is_empty() {
            return None;
        }
        // Before the first keyframe
        if t_ms <= self.keyframes[0].time_ms {
            return Some(self.keyframes[0].value.clone());
        }
        // After the last keyframe
        let last = &self.keyframes[self.keyframes.len() - 1];
        if t_ms >= last.time_ms {
            return Some(last.value.clone());
        }
        // Find surrounding keyframes
        for window in self.keyframes.windows(2) {
            let (a, b) = (&window[0], &window[1]);
            if t_ms >= a.time_ms && t_ms <= b.time_ms {
                let span = b.time_ms - a.time_ms;
                let local_t = if span > 0.0 { (t_ms - a.time_ms) / span } else { 1.0 };
                let eased = a
                    .easing
                    .as_ref()
                    .map(|e| e.evaluate(local_t))
                    .unwrap_or(local_t);
                return Some(interpolate_json(&a.value, &b.value, eased));
            }
        }
        None
    }
}

// ------------------------------------------------------------------
// Preset track builders
// ------------------------------------------------------------------

/// Default animation duration in milliseconds (used when no token is set).
pub const DEFAULT_ANIMATION_DURATION_MS: f32 = 400.0;

/// Y-axis slide offset in CSS pixels for slide_in / slide_out.
const SLIDE_OFFSET_PX: f32 = 40.0;

/// Starting scale factor for scale_in / scale_out.
const SCALE_IN_FROM: f32 = 0.85;

/// Scale overshoot factor for pop_in.
const POP_IN_OVERSHOOT: f32 = 1.15;

/// Build enter-animation tracks for `node_id` using the named `preset`.
///
/// `duration_ms` is the full animation length; `offset_ms` shifts the
/// animation forward in time (used for stagger effects).  Returns an empty
/// `Vec` if the preset is empty or unrecognised.
pub fn build_enter_tracks(
    node_id: crate::node::NodeId,
    preset: &str,
    duration_ms: f32,
    offset_ms: f32,
) -> Vec<AnimationTrack> {
    let start = offset_ms;
    let end = offset_ms + duration_ms;
    match preset {
        "slide_in" => slide_in_tracks(node_id, start, end),
        "scale_in" => scale_in_tracks(node_id, start, end),
        "pop_in" => pop_in_tracks(node_id, start, end),
        "grow" => grow_tracks(node_id, start, end),
        // "fade_in" or any unrecognised name → fade
        _ => fade_in_tracks(node_id, start, end),
    }
}

/// Build exit-animation tracks for `node_id` using the named `preset`.
pub fn build_exit_tracks(
    node_id: crate::node::NodeId,
    preset: &str,
    duration_ms: f32,
    offset_ms: f32,
) -> Vec<AnimationTrack> {
    let start = offset_ms;
    let end = offset_ms + duration_ms;
    match preset {
        "slide_out" => slide_out_tracks(node_id, start, end),
        "scale_out" => scale_out_tracks(node_id, start, end),
        // "fade_out" or any unrecognised name → fade
        _ => fade_out_tracks(node_id, start, end),
    }
}

/// Return the maximum `time_ms` across all keyframes in all tracks (i.e. the
/// total timeline length in ms).
pub fn tracks_total_duration(tracks: &[AnimationTrack]) -> f32 {
    tracks
        .iter()
        .flat_map(|t| t.keyframes.iter().map(|kf| kf.time_ms))
        .fold(0.0_f32, f32::max)
}

// ── Individual preset builders ─────────────────────────────────────────────

fn fade_in_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    vec![AnimationTrack {
        node_id,
        property: "opacity".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(0.0),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(1.0), easing: None },
        ],
    }]
}

fn fade_out_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    vec![AnimationTrack {
        node_id,
        property: "opacity".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(1.0),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(0.0), easing: None },
        ],
    }]
}

fn slide_in_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    let mut tracks = fade_in_tracks(node_id, start, end);
    tracks.push(AnimationTrack {
        node_id,
        property: "transform.y_offset".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(SLIDE_OFFSET_PX),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(0.0), easing: None },
        ],
    });
    tracks
}

fn slide_out_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    let mut tracks = fade_out_tracks(node_id, start, end);
    tracks.push(AnimationTrack {
        node_id,
        property: "transform.y_offset".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(0.0),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(SLIDE_OFFSET_PX), easing: None },
        ],
    });
    tracks
}

fn scale_in_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    let mut tracks = fade_in_tracks(node_id, start, end);
    tracks.push(AnimationTrack {
        node_id,
        property: "transform.scale_anim".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(SCALE_IN_FROM),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(1.0), easing: None },
        ],
    });
    tracks
}

fn scale_out_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    let mut tracks = fade_out_tracks(node_id, start, end);
    tracks.push(AnimationTrack {
        node_id,
        property: "transform.scale_anim".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(1.0),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(SCALE_IN_FROM), easing: None },
        ],
    });
    tracks
}

fn pop_in_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    let mut tracks = fade_in_tracks(node_id, start, end);
    tracks.push(AnimationTrack {
        node_id,
        property: "transform.scale_anim".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(POP_IN_OVERSHOOT),
                easing: Some(Easing::Spring(SpringParams::default())),
            },
            Keyframe { time_ms: end, value: serde_json::json!(1.0), easing: None },
        ],
    });
    tracks
}

fn grow_tracks(node_id: crate::node::NodeId, start: f32, end: f32) -> Vec<AnimationTrack> {
    vec![AnimationTrack {
        node_id,
        property: "transform.scale_y_anim".into(),
        keyframes: vec![
            Keyframe {
                time_ms: start,
                value: serde_json::json!(0.0),
                easing: Some(Easing::CubicBezier(CubicBezier::PRECISE)),
            },
            Keyframe { time_ms: end, value: serde_json::json!(1.0), easing: None },
        ],
    }]
}

// ------------------------------------------------------------------

/// Linearly interpolate between two JSON values using factor `t ∈ [0, 1]`.
/// Only f64 numbers are interpolated; all other types snap to `b` when `t >= 0.5`.
fn interpolate_json(a: &serde_json::Value, b: &serde_json::Value, t: f32) -> serde_json::Value {
    match (a, b) {
        (serde_json::Value::Number(an), serde_json::Value::Number(bn)) => {
            if let (Some(av), Some(bv)) = (an.as_f64(), bn.as_f64()) {
                let result = av + (bv - av) * t as f64;
                serde_json::Value::Number(
                    serde_json::Number::from_f64(result)
                        .unwrap_or_else(|| bn.clone()),
                )
            } else {
                b.clone()
            }
        }
        _ => {
            if t >= 0.5 {
                b.clone()
            } else {
                a.clone()
            }
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cubic_bezier_endpoints() {
        let cb = CubicBezier::LINEAR;
        assert!((cb.evaluate(0.0)).abs() < 1e-5);
        assert!((cb.evaluate(1.0) - 1.0).abs() < 1e-5);
        assert!((cb.evaluate(0.5) - 0.5).abs() < 0.01);
    }

    #[test]
    fn cubic_bezier_ease_monotone() {
        let cb = CubicBezier::EASE;
        let mut prev = 0.0_f32;
        for i in 1..=10 {
            let t = i as f32 / 10.0;
            let y = cb.evaluate(t);
            assert!(y >= prev, "ease should be monotone: t={t} y={y} prev={prev}");
            prev = y;
        }
    }

    #[test]
    fn spring_settles_to_one() {
        let sp = SpringParams::default();
        let settled = sp.evaluate(5.0);
        assert!(settled > 0.99, "spring should settle near 1.0 after 5s, got {settled}");
    }

    #[test]
    fn spring_starts_at_zero() {
        let sp = SpringParams::default();
        let start = sp.evaluate(0.0);
        assert_eq!(start, 0.0);
    }

    #[test]
    fn track_evaluate_interpolates() {
        let track = AnimationTrack {
            node_id: crate::node::NodeId::new(),
            property: "transform.x".into(),
            keyframes: vec![
                Keyframe { time_ms: 0.0, value: serde_json::json!(0.0), easing: None },
                Keyframe { time_ms: 100.0, value: serde_json::json!(100.0), easing: None },
            ],
        };
        let mid = track.evaluate_at(50.0).unwrap();
        assert!((mid.as_f64().unwrap() - 50.0).abs() < 0.01);
    }
}
