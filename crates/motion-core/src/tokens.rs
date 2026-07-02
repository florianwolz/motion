//! Token system — design tokens, motion tokens, chart tokens, and modes.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::node::{Color, StyleValue};

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

    /// Resolve a `StyleValue<f32>` to a concrete float.
    pub fn resolve_f32(&self, value: &StyleValue<f32>) -> Option<f32> {
        match value {
            StyleValue::Literal(v) => Some(*v),
            StyleValue::Token(r) => {
                let v = self.resolve(&r.path, 8)?;
                match v {
                    serde_json::Value::Number(n) => n.as_f64().map(|x| x as f32),
                    serde_json::Value::String(s) => {
                        // Handle values like "24px", "420ms", "1.5"
                        let trimmed = s.trim_end_matches(|c: char| c.is_alphabetic());
                        trimmed.parse().ok()
                    }
                    _ => None,
                }
            }
        }
    }

    /// Resolve a `StyleValue<String>` to a concrete string.
    pub fn resolve_string<'a>(&'a self, value: &'a StyleValue<String>) -> Option<&'a str> {
        match value {
            StyleValue::Literal(s) => Some(s.as_str()),
            StyleValue::Token(r) => {
                let v = self.resolve(&r.path, 8)?;
                if let serde_json::Value::String(s) = v {
                    Some(s.as_str())
                } else {
                    None
                }
            }
        }
    }

    /// Resolve a `StyleValue<Color>` to a concrete `Color`.
    ///
    /// Tokens may store colors as hex strings (`"#RRGGBB"` or `"#RRGGBBAA"`).
    pub fn resolve_color(&self, value: &StyleValue<Color>) -> Option<Color> {
        match value {
            StyleValue::Literal(c) => Some(c.clone()),
            StyleValue::Token(r) => {
                let v = self.resolve(&r.path, 8)?;
                if let serde_json::Value::String(s) = v {
                    parse_hex_color(s)
                } else {
                    None
                }
            }
        }
    }

    /// Resolve an optional `StyleValue<f32>`, returning a fallback if absent or unresolvable.
    pub fn resolve_f32_or(&self, value: &Option<StyleValue<f32>>, fallback: f32) -> f32 {
        value
            .as_ref()
            .and_then(|v| self.resolve_f32(v))
            .unwrap_or(fallback)
    }
}

/// Parse a CSS hex color string into a `Color`.
/// Supports `#RGB`, `#RRGGBB`, and `#RRGGBBAA`.
pub fn parse_hex_color(s: &str) -> Option<Color> {
    let s = s.strip_prefix('#')?;
    let expand = |nibble: u8| -> f32 { ((nibble << 4 | nibble) as f32) / 255.0 };
    match s.len() {
        3 => {
            let digits: Vec<u8> = s
                .chars()
                .map(|c| c.to_digit(16).map(|d| d as u8))
                .collect::<Option<Vec<_>>>()?;
            Some(Color {
                r: expand(digits[0]),
                g: expand(digits[1]),
                b: expand(digits[2]),
                a: 1.0,
            })
        }
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16).ok()?;
            let g = u8::from_str_radix(&s[2..4], 16).ok()?;
            let b = u8::from_str_radix(&s[4..6], 16).ok()?;
            Some(Color {
                r: r as f32 / 255.0,
                g: g as f32 / 255.0,
                b: b as f32 / 255.0,
                a: 1.0,
            })
        }
        8 => {
            let r = u8::from_str_radix(&s[0..2], 16).ok()?;
            let g = u8::from_str_radix(&s[2..4], 16).ok()?;
            let b = u8::from_str_radix(&s[4..6], 16).ok()?;
            let a = u8::from_str_radix(&s[6..8], 16).ok()?;
            Some(Color {
                r: r as f32 / 255.0,
                g: g as f32 / 255.0,
                b: b as f32 / 255.0,
                a: a as f32 / 255.0,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_scalar_f32() {
        let mut store = TokenStore::default();
        store
            .tokens
            .insert("spacing.md".into(), TokenValue::Scalar(serde_json::json!(16.0)));
        let val = StyleValue::<f32>::token("spacing.md");
        assert_eq!(store.resolve_f32(&val), Some(16.0));
    }

    #[test]
    fn resolve_alias_chain() {
        let mut store = TokenStore::default();
        store.tokens.insert(
            "alias".into(),
            TokenValue::Alias(TokenRef::new("target")),
        );
        store
            .tokens
            .insert("target".into(), TokenValue::Scalar(serde_json::json!(42.0)));
        let val = StyleValue::<f32>::token("alias");
        assert_eq!(store.resolve_f32(&val), Some(42.0));
    }

    #[test]
    fn resolve_hex_color() {
        let mut store = TokenStore::default();
        store.tokens.insert(
            "color.brand".into(),
            TokenValue::Scalar(serde_json::json!("#EC6602")),
        );
        let val = StyleValue::<Color>::token("color.brand");
        let color = store.resolve_color(&val).unwrap();
        assert!((color.r - 0.925).abs() < 0.01);
        assert!((color.g - 0.400).abs() < 0.01);
        assert!((color.b - 0.008).abs() < 0.01);
        assert_eq!(color.a, 1.0);
    }

    #[test]
    fn parse_hex_color_formats() {
        let short = parse_hex_color("#F00").unwrap();
        assert_eq!(short.r, 1.0);
        assert_eq!(short.g, 0.0);
        assert_eq!(short.b, 0.0);

        let full = parse_hex_color("#0080FF").unwrap();
        assert!((full.r).abs() < 0.01);
        assert!((full.g - 128.0 / 255.0).abs() < 0.01);
        assert_eq!(full.b, 1.0);
    }
}
