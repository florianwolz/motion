//! Token system — design tokens, motion tokens, chart tokens, and modes.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A reference to a named token by its dotted path, e.g. `"color.text.primary"`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TokenRef {
    pub path: String,
}

impl TokenRef {
    pub fn new(path: impl Into<String>) -> Self {
        Self { path: path.into() }
    }
}

/// The raw value stored for a token.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TokenValue {
    /// A raw scalar or string (e.g. `"#EC6602"`, `"420ms"`, `24`).
    Scalar(serde_json::Value),
    /// An alias to another token path (Style Dictionary `{token.path}` syntax).
    Alias(TokenRef),
    /// A composite value with named sub-fields (e.g. material tokens).
    Composite(HashMap<String, TokenValue>),
}

/// Active presentation modes that affect token resolution.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ActiveModes {
    /// Color scheme: `"light"`, `"dark"`, `"high_contrast"`.
    pub theme: Option<String>,
    /// Presentation medium: `"live"`, `"teams"`, `"projector"`, `"pdf"`, `"video"`.
    pub medium: Option<String>,
    /// Audience density: `"executive"`, `"technical"`, `"scientific"`.
    pub audience: Option<String>,
}

/// All tokens for a document, keyed by dotted path.
///
/// Token values may reference other tokens via alias.  Callers should use
/// [`TokenStore::resolve`] to walk aliases and return a final scalar.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenStore {
    pub tokens: HashMap<String, TokenValue>,
    pub modes: ActiveModes,
}

impl TokenStore {
    /// Look up a token by path, following at most `max_depth` alias hops.
    pub fn resolve(&self, path: &str, max_depth: usize) -> Option<&serde_json::Value> {
        let mut current = path;
        let mut depth = 0;
        loop {
            if depth > max_depth {
                return None;
            }
            match self.tokens.get(current)? {
                TokenValue::Scalar(v) => return Some(v),
                TokenValue::Alias(r) => {
                    current = &r.path;
                    depth += 1;
                }
                TokenValue::Composite(_) => return None,
            }
        }
    }
}
