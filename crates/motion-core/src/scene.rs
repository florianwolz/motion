//! Scene and step model.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::node::NodeId;
use crate::tokens::TokenRef;

/// Unique identifier for a scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SceneId(pub Uuid);

impl SceneId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for SceneId {
    fn default() -> Self {
        Self::new()
    }
}

/// Unique identifier for a step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StepId(pub Uuid);

impl StepId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for StepId {
    fn default() -> Self {
        Self::new()
    }
}

/// Camera state for a scene.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraState {
    pub x: f32,
    pub y: f32,
    pub zoom: f32,
    pub rotation: f32,
}

impl Default for CameraState {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
            rotation: 0.0,
        }
    }
}

/// A semantic presentation command within a step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PresentationCommand {
    Focus {
        target: NodeId,
    },
    Highlight {
        target: NodeId,
    },
    DimOthers {
        target: NodeId,
    },
    Reveal {
        target: NodeId,
    },
    Hide {
        target: NodeId,
    },
    Morph {
        from: NodeId,
        to: NodeId,
    },
    SetProperty {
        node: NodeId,
        property: String,
        value: serde_json::Value,
    },
    ReplaceText {
        node: NodeId,
        new_text: String,
    },
    ChartHighlightSeries {
        chart: NodeId,
        series: String,
    },
    CameraFocus {
        target: NodeId,
        zoom: Option<f32>,
    },
    CameraMove {
        state: CameraState,
        duration_ms: Option<u32>,
        easing: Option<TokenRef>,
    },
}

/// Controls how long a step's animations run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DurationPolicy {
    /// Use the default duration from motion tokens.
    Token(TokenRef),
    /// Explicit duration in milliseconds.
    Fixed(u32),
    /// Wait for all animations to finish.
    Auto,
}

impl Default for DurationPolicy {
    fn default() -> Self {
        Self::Auto
    }
}

/// Transition specification for entering/leaving a step.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransitionSpec {
    pub preset: Option<TokenRef>,
    pub duration_policy: DurationPolicy,
}

/// A semantic presentation step — an advance that triggers animated state changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: StepId,
    pub name: String,
    pub commands: Vec<PresentationCommand>,
    pub transition: TransitionSpec,
    pub notes: Option<String>,
}

impl Step {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: StepId::new(),
            name: name.into(),
            commands: Vec::new(),
            transition: TransitionSpec::default(),
            notes: None,
        }
    }
}

/// A scene — a canvas state or animated sequence roughly equivalent to a slide.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub id: SceneId,
    pub name: String,
    /// ID of the root node for this scene's content.
    pub root: NodeId,
    /// Initial camera state for this scene.
    pub camera: CameraState,
    /// Ordered list of semantic presentation steps.
    pub steps: Vec<Step>,
    pub notes: Option<String>,
}

impl Scene {
    pub fn new(name: impl Into<String>, root: NodeId) -> Self {
        Self {
            id: SceneId::new(),
            name: name.into(),
            root,
            camera: CameraState::default(),
            steps: Vec::new(),
            notes: None,
        }
    }
}
