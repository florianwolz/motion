//! Preflight validation — checks run before a live presentation.

use serde::{Deserialize, Serialize};

/// Overall preflight result status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightStatus {
    Ready,
    Warning,
    Error,
}

/// Severity of an individual check result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckSeverity {
    Info,
    Warning,
    Error,
}

/// Category of a preflight check.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckCategory {
    Assets,
    Fonts,
    Renderer,
    Brand,
    Accessibility,
    DataLinks,
    PresenterView,
    Cache,
}

/// Result of a single preflight check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightCheck {
    pub id: String,
    pub category: CheckCategory,
    pub severity: CheckSeverity,
    pub passed: bool,
    pub message: String,
    pub details: Option<String>,
}

/// A suggested fix for a failed check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixSuggestion {
    pub check_id: String,
    pub description: String,
    pub auto_fixable: bool,
}

/// The full preflight report returned before presenting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightReport {
    pub status: PreflightStatus,
    pub checks: Vec<PreflightCheck>,
    pub suggestions: Vec<FixSuggestion>,
}

impl PreflightReport {
    /// Create an empty report defaulting to `Ready`.
    pub fn new() -> Self {
        Self {
            status: PreflightStatus::Ready,
            checks: Vec::new(),
            suggestions: Vec::new(),
        }
    }

    /// Recalculate the overall status from individual check results.
    pub fn recalculate_status(&mut self) {
        let has_error = self.checks.iter().any(|c| !c.passed && c.severity == CheckSeverity::Error);
        let has_warning = self.checks.iter().any(|c| !c.passed && c.severity == CheckSeverity::Warning);
        self.status = if has_error {
            PreflightStatus::Error
        } else if has_warning {
            PreflightStatus::Warning
        } else {
            PreflightStatus::Ready
        };
    }
}

impl Default for PreflightReport {
    fn default() -> Self {
        Self::new()
    }
}
