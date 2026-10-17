//! The question catalogue, read from the same `content/` YAML the web app uses and embedded in the binary at build
//! time, so the TUI needs no files beside it. Only the fields the TUI shows or scores with are parsed; the web app's
//! loader (`src/content/loader.ts`) and `pnpm validate:content` stay the authority on whether the content is valid.

use anyhow::{Context, Result, anyhow};
use include_dir::{Dir, include_dir};
use serde::Deserialize;

static CONTENT: Dir = include_dir!("$CARGO_MANIFEST_DIR/../content");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

impl Severity {
    /// Weight used by the scoring, as `severities` in `src/content/schema.ts`.
    pub fn weight(self) -> f64 {
        match self {
            Severity::Critical => 4.0,
            Severity::High => 3.0,
            Severity::Medium => 2.0,
            Severity::Low => 1.0,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Severity::Critical => "critical",
            Severity::High => "high",
            Severity::Medium => "medium",
            Severity::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Effort {
    S,
    M,
    L,
}

impl Effort {
    pub fn cost(self) -> f64 {
        match self {
            Effort::S => 1.0,
            Effort::M => 2.0,
            Effort::L => 3.0,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Effort::S => "S",
            Effort::M => "M",
            Effort::L => "L",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub description: String,
    pub optional: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LicenceTier {
    pub id: String,
    pub name: String,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Named {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Domain {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Platform {
    pub id: String,
    pub name: String,
    pub description: String,
    pub modules: Vec<Module>,
    pub licence_tiers: Vec<LicenceTier>,
    pub licence_features: Vec<Named>,
    pub domains: Vec<Domain>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetType {
    pub id: String,
    pub module: String,
    pub name: String,
    pub description: String,
    pub examples: Vec<String>,
    pub discovery_prompts: Vec<String>,
    pub exposures: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct E8Tag {
    pub strategy: String,
    pub level: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub module: String,
    pub domain: String,
    pub applies_to: Vec<String>,
    pub severity: Severity,
    pub question: String,
    pub why: String,
    pub yes_looks_like: String,
    pub remediation: String,
    pub effort: Effort,
    #[serde(default)]
    pub licence: Vec<String>,
    #[serde(default)]
    pub e8: Vec<E8Tag>,
    /// Platform the question belongs to; set by the loader.
    #[serde(skip)]
    pub platform: String,
}

impl Question {
    /// Whether this question protects a crown jewel of the given asset type (`questionsForJewel`).
    pub fn applies_to_type(&self, asset_type: &str) -> bool {
        self.applies_to.iter().any(|t| t == "*" || t == asset_type)
    }
}

#[derive(Debug, Clone)]
pub struct Bundle {
    pub platform: Platform,
    pub asset_types: Vec<AssetType>,
    pub questions: Vec<Question>,
}

#[derive(Debug, Clone, Deserialize)]
struct Control {
    id: String,
    title: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Framework {
    #[serde(default)]
    controls: Vec<Control>,
}

#[derive(Debug, Clone)]
pub struct Catalogue {
    /// In the web loader's order: platform directories sorted by path.
    pub bundles: Vec<Bundle>,
    /// Essential Eight strategy id to title.
    e8_titles: Vec<(String, String)>,
}

/// Essential Eight strategies in the order the web app reports them (`e8Strategies`).
pub const E8_STRATEGIES: [&str; 8] = [
    "application-control",
    "patch-applications",
    "office-macros",
    "user-application-hardening",
    "restrict-admin-privileges",
    "patch-operating-systems",
    "mfa",
    "regular-backups",
];

impl Catalogue {
    pub fn bundle(&self, platform: &str) -> Option<&Bundle> {
        self.bundles.iter().find(|b| b.platform.id == platform)
    }

    pub fn e8_title<'a>(&'a self, strategy: &'a str) -> &'a str {
        self.e8_titles
            .iter()
            .find(|(id, _)| id == strategy)
            .map_or(strategy, |(_, t)| t.as_str())
    }

    pub fn asset_type(&self, platform: &str, id: &str) -> Option<&AssetType> {
        self.bundle(platform)?.asset_types.iter().find(|a| a.id == id)
    }

    /// Load the catalogue embedded at build time.
    pub fn embedded() -> Result<Catalogue> {
        let mut files = Vec::new();
        collect(&CONTENT, &mut files);
        Self::from_files(files)
    }

    /// Build a catalogue from `(path relative to content/, text)` pairs.
    pub fn from_files(mut files: Vec<(String, String)>) -> Result<Catalogue> {
        files.sort_by(|a, b| a.0.cmp(&b.0));
        let text = |path: &str| files.iter().find(|(p, _)| p == path).map(|(_, t)| t.as_str());

        let mut dirs: Vec<&str> = files
            .iter()
            .filter_map(|(p, _)| p.strip_prefix("platforms/")?.split_once('/').map(|(d, _)| d))
            .collect();
        dirs.dedup();

        let mut bundles = Vec::new();
        for dir in dirs {
            let prefix = format!("platforms/{dir}/");
            let platform_path = format!("{prefix}platform.yaml");
            let assets_path = format!("{prefix}assets.yaml");
            let platform: Platform = parse(&platform_path, text(&platform_path))?;
            let asset_types: Vec<AssetType> = parse(&assets_path, text(&assets_path))?;
            let mut questions = Vec::new();
            for (path, body) in files
                .iter()
                .filter(|(p, _)| p.starts_with(&format!("{prefix}questions/")))
            {
                let mut qs: Vec<Question> = parse(path, Some(body))?;
                for q in &mut qs {
                    q.platform = platform.id.clone();
                }
                questions.extend(qs);
            }
            // The web app and `pnpm cg` see questions sorted by id (`contentDigest` sorts each bundle in place), and
            // that order decides list order and roadmap ties, so match it.
            questions.sort_by(|a, b| a.id.cmp(&b.id));
            bundles.push(Bundle {
                platform,
                asset_types,
                questions,
            });
        }
        if bundles.is_empty() {
            return Err(anyhow!("no platforms found under content/platforms"));
        }

        let e8_path = "frameworks/essential-eight.yaml";
        let e8: Framework = parse(e8_path, text(e8_path))?;
        let e8_titles = e8.controls.into_iter().map(|c| (c.id, c.title)).collect();
        Ok(Catalogue { bundles, e8_titles })
    }
}

fn parse<T: serde::de::DeserializeOwned>(path: &str, text: Option<&str>) -> Result<T> {
    let text = text.ok_or_else(|| anyhow!("content/{path} is missing"))?;
    serde_yaml_ng::from_str(text).with_context(|| format!("content/{path}"))
}

fn collect(dir: &Dir<'_>, out: &mut Vec<(String, String)>) {
    for file in dir.files() {
        let path = file.path().to_string_lossy().replace('\\', "/");
        if path.ends_with(".yaml") {
            if let Some(text) = file.contents_utf8() {
                out.push((path, text.to_string()));
            }
        }
    }
    for sub in dir.dirs() {
        collect(sub, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalogue_loads_every_platform() {
        let cat = Catalogue::embedded().expect("embedded content parses");
        let ids: Vec<_> = cat.bundles.iter().map(|b| b.platform.id.as_str()).collect();
        assert_eq!(ids, ["aws", "google", "microsoft"]);
        for b in &cat.bundles {
            assert!(!b.questions.is_empty(), "{} has questions", b.platform.id);
            assert!(!b.asset_types.is_empty(), "{} has asset types", b.platform.id);
        }
        assert_eq!(cat.e8_title("mfa"), "Multi-factor authentication");
    }
}
