//! Brand package loading and compilation helpers.

use std::{
    fs,
    path::{Path, PathBuf},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    document::{Asset, AssetId, AssetKind, BrandBinding, Document},
    tokens::{TokenRef, TokenValue},
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BrandManifestFont {
    pub family: String,
    pub file: String,
    #[serde(default)]
    pub usage: Option<String>,
    #[serde(default, rename = "subsetAllowed")]
    pub subset_allowed: bool,
    #[serde(default)]
    pub license: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BrandManifest {
    pub name: String,
    #[serde(default)]
    pub id: Option<String>,
    pub version: String,
    #[serde(default, rename = "engineCompatibility")]
    pub engine_compatibility: Option<String>,
    #[serde(default)]
    pub modes: Vec<String>,
    #[serde(default)]
    pub fonts: Vec<BrandManifestFont>,
    #[serde(default)]
    pub components: Vec<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandPackageAsset {
    pub kind: AssetKind,
    pub path: String,
    pub uri: String,
    pub hash: String,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandPackage {
    pub manifest: BrandManifest,
    pub tokens: Value,
    #[serde(default)]
    pub assets: Vec<BrandPackageAsset>,
}

pub fn build_brand_package(dir: &Path) -> Result<BrandPackage, String> {
    let manifest_path = dir.join("manifest.json");
    let manifest: BrandManifest = read_json_file(&manifest_path)?;

    let tokens_path = dir.join("tokens.json");
    let tokens: Value = read_json_file(&tokens_path)?;
    if collect_tokens(&tokens).is_empty() {
        return Err(format!(
            "brand package at {} does not define any dotted token entries",
            dir.display()
        ));
    }

    let mut assets = Vec::new();
    for font in &manifest.fonts {
        assets.push(build_asset(
            dir,
            &font.file,
            AssetKind::Font,
            Some(font.family.clone()),
        )?);
    }
    assets.extend(collect_directory_assets(dir, "logos", AssetKind::Image)?);
    assets.extend(collect_directory_assets(dir, "icons", AssetKind::Icon)?);

    Ok(BrandPackage {
        manifest,
        tokens,
        assets,
    })
}

pub fn load_brand_package(document: &mut Document, package_json: &str) -> Result<(), String> {
    let payload: Value = serde_json::from_str(package_json)
        .map_err(|error| format!("failed to parse brand package: {error}"))?;

    if payload.get("manifest").is_some() {
        let package: BrandPackage = serde_json::from_value(payload)
            .map_err(|error| format!("failed to decode brand package: {error}"))?;
        apply_brand_package(document, package)
    } else {
        apply_legacy_brand_payload(document, &payload)
    }
}

pub fn collect_tokens(value: &Value) -> Vec<(String, TokenValue)> {
    let mut out = Vec::new();
    collect_tokens_inner(value, &mut out);
    out
}

pub fn verify_asset_hash(asset: &Asset) -> bool {
    if asset.hash.is_empty() {
        return false;
    }

    let Some(bytes) = decode_data_uri(&asset.uri) else {
        return false;
    };

    sha256_hex(&bytes) == asset.hash
}

fn apply_brand_package(document: &mut Document, package: BrandPackage) -> Result<(), String> {
    document.brand = Some(BrandBinding {
        name: package.manifest.name.clone(),
        version: package.manifest.version.clone(),
    });

    let collected = collect_tokens(&package.tokens);
    if collected.is_empty() {
        return Err("brand package does not contain any dotted token entries".to_string());
    }
    for (path, value) in collected {
        document.tokens.tokens.insert(path, value);
    }

    for asset in package.assets {
        let exists = document.assets.assets.iter().any(|existing| {
            existing.kind == asset.kind
                && existing.uri == asset.uri
                && existing.hash == asset.hash
                && existing.name == asset.name
        });
        if !exists {
            document.assets.assets.push(Asset {
                id: AssetId::new(),
                kind: asset.kind,
                uri: asset.uri,
                hash: asset.hash,
                name: asset.name,
            });
        }
    }

    Ok(())
}

fn apply_legacy_brand_payload(document: &mut Document, payload: &Value) -> Result<(), String> {
    if let Some(obj) = payload.as_object() {
        if let (Some(name), Some(version)) = (
            obj.get("name").and_then(Value::as_str),
            obj.get("version").and_then(Value::as_str),
        ) {
            document.brand = Some(BrandBinding {
                name: name.to_string(),
                version: version.to_string(),
            });
        }
    }

    let source = payload.get("tokens").unwrap_or(payload);
    let collected = collect_tokens(source);
    if collected.is_empty() {
        return Err("brand payload did not contain any dotted token entries".to_string());
    }

    for (path, value) in collected {
        document.tokens.tokens.insert(path, value);
    }
    Ok(())
}

fn collect_tokens_inner(value: &Value, out: &mut Vec<(String, TokenValue)>) {
    let Some(object) = value.as_object() else {
        return;
    };

    for (key, child) in object {
        if key.starts_with('_') {
            continue;
        }
        if key.contains('.') {
            out.push((key.clone(), json_to_token_value(child)));
        } else {
            collect_tokens_inner(child, out);
        }
    }
}

fn json_to_token_value(value: &Value) -> TokenValue {
    match value {
        Value::String(token_string) => parse_token_string(token_string)
            .map(|path| TokenValue::Alias(TokenRef::new(path)))
            .unwrap_or_else(|| TokenValue::Scalar(value.clone())),
        Value::Object(map) => TokenValue::Composite(
            map.iter()
                .map(|(key, child)| (key.clone(), json_to_token_value(child)))
                .collect(),
        ),
        _ => TokenValue::Scalar(value.clone()),
    }
}

fn parse_token_string(value: &str) -> Option<&str> {
    if value.starts_with('{') && value.ends_with('}') && value.len() > 2 {
        Some(&value[1..value.len() - 1])
    } else {
        None
    }
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))
}

fn build_asset(
    base_dir: &Path,
    relative_path: &str,
    kind: AssetKind,
    name: Option<String>,
) -> Result<BrandPackageAsset, String> {
    let path = base_dir.join(relative_path);
    let bytes =
        fs::read(&path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let hash = sha256_hex(&bytes);
    let mime = detect_mime_type(&path, &kind);
    let uri = format!("data:{mime};base64,{}", STANDARD.encode(bytes));
    Ok(BrandPackageAsset {
        kind,
        path: normalize_path(relative_path),
        uri,
        hash,
        name,
    })
}

fn collect_directory_assets(
    base_dir: &Path,
    relative_dir: &str,
    kind: AssetKind,
) -> Result<Vec<BrandPackageAsset>, String> {
    let dir = base_dir.join(relative_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    if !dir.is_dir() {
        return Err(format!("{} is not a directory", dir.display()));
    }

    let mut paths = Vec::new();
    collect_files_recursively(&dir, &mut paths)?;
    paths.sort();

    let mut assets = Vec::new();
    for path in paths {
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|error| format!("failed to relativize {}: {error}", path.display()))?;
        let relative_string = normalize_path(&relative.to_string_lossy());
        let name = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string());
        assets.push(build_asset(base_dir, &relative_string, kind.clone(), name)?);
    }

    Ok(assets)
}

fn collect_files_recursively(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in
        fs::read_dir(dir).map_err(|error| format!("failed to read {}: {error}", dir.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to read directory entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_files_recursively(&path, out)?;
        } else if path.is_file() {
            out.push(path);
        }
    }
    Ok(())
}

fn detect_mime_type(path: &Path, kind: &AssetKind) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
    {
        Some(ext) if ext == "woff2" => "font/woff2",
        Some(ext) if ext == "woff" => "font/woff",
        Some(ext) if ext == "ttf" => "font/ttf",
        Some(ext) if ext == "otf" => "font/otf",
        Some(ext) if ext == "svg" => "image/svg+xml",
        Some(ext) if ext == "png" => "image/png",
        Some(ext) if ext == "jpg" || ext == "jpeg" => "image/jpeg",
        Some(ext) if ext == "gif" => "image/gif",
        Some(ext) if ext == "webp" => "image/webp",
        Some(ext) if ext == "ico" => "image/x-icon",
        Some(ext) if ext == "json" => "application/json",
        _ if matches!(kind, AssetKind::Font) => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn decode_data_uri(uri: &str) -> Option<Vec<u8>> {
    let (_, payload) = uri.split_once(',')?;
    STANDARD.decode(payload).ok()
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_brand_dir() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("motion-brand-test-{suffix}"))
    }

    #[test]
    fn builds_brand_package_with_assets() {
        let dir = temp_brand_dir();
        fs::create_dir_all(dir.join("fonts")).unwrap();
        fs::create_dir_all(dir.join("logos")).unwrap();

        fs::write(
            dir.join("manifest.json"),
            r#"{
                "name":"Example Brand",
                "version":"0.1.0",
                "fonts":[{"family":"Inter","file":"fonts/inter.woff2"}]
            }"#,
        )
        .unwrap();
        fs::write(
            dir.join("tokens.json"),
            r#"{"typography":{"typography.body.font":"{font.brand}"},"primitives":{"font.brand":"Inter"}}"#,
        )
        .unwrap();
        fs::write(dir.join("fonts/inter.woff2"), b"fake-font").unwrap();
        fs::write(dir.join("logos/logo.svg"), "<svg/>").unwrap();

        let package = build_brand_package(&dir).unwrap();
        assert_eq!(package.manifest.name, "Example Brand");
        assert_eq!(package.assets.len(), 2);
        assert!(package
            .assets
            .iter()
            .any(|asset| matches!(asset.kind, AssetKind::Font)
                && asset.uri.starts_with("data:font/woff2;base64,")));
        assert!(package
            .assets
            .iter()
            .any(|asset| matches!(asset.kind, AssetKind::Image)
                && asset.uri.starts_with("data:image/svg+xml;base64,")));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn loads_compiled_brand_package_into_document() {
        let mut document = Document::new("Demo");
        let package = serde_json::json!({
            "manifest": {
                "name": "Example Brand",
                "version": "0.1.0",
                "fonts": [{ "family": "Inter", "file": "fonts/inter.woff2" }]
            },
            "tokens": {
                "primitives": {
                    "font.brand": "Inter",
                    "color.brand.orange.500": "#EC6602"
                },
                "typography": {
                    "typography.body.font": "{font.brand}"
                }
            },
            "assets": [{
                "kind": "font",
                "path": "fonts/inter.woff2",
                "uri": "data:font/woff2;base64,ZmFrZS1mb250",
                "hash": "9c47bfdc428fd054eb19c751dbedf3d47d5d04f4892ae8addec08ac9595f2101",
                "name": "Inter"
            }]
        });

        load_brand_package(&mut document, &package.to_string()).unwrap();
        assert_eq!(document.brand.unwrap().name, "Example Brand");
        assert!(document.tokens.tokens.contains_key("typography.body.font"));
        assert_eq!(document.assets.assets.len(), 1);
        assert_eq!(document.assets.assets[0].name.as_deref(), Some("Inter"));
        assert!(verify_asset_hash(&document.assets.assets[0]));
    }
}
