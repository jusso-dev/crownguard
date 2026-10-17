//! The `.crownguard.json` file, read and written in the same format as the web app (schema 4), so a file can move
//! between the browser and the terminal. Fields the TUI doesn't edit (SOC answers, the AI register, scan evidence,
//! the logo, wizard progress and anything newer) are carried through a save untouched.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// File format version this build writes, as `SCHEMA_VERSION` in `src/wizard/assessmentSchema.ts`.
pub const SCHEMA_VERSION: u64 = 4;
pub const SCHEMA_URL: &str = "https://jusso-dev.github.io/crownguard/schema/crownguard-assessment.v4.json";
pub const NOTE_MAX: usize = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Answer {
    Yes,
    Partial,
    No,
    Unknown,
    Na,
}

impl Answer {
    pub fn label(self) -> &'static str {
        match self {
            Answer::Yes => "Yes",
            Answer::Partial => "Partial",
            Answer::No => "No",
            Answer::Unknown => "Unknown",
            Answer::Na => "N/A",
        }
    }
}

pub const CLASSIFICATIONS: [(&str, &str); 4] = [
    ("public", "Public"),
    ("internal", "Internal"),
    ("confidential", "Confidential"),
    ("highly-confidential", "Highly confidential"),
];

pub const DSLS: [(&str, &str); 6] = [
    ("dsl-0", "DSL-0"),
    ("dsl-1", "DSL-1"),
    ("dsl-2", "DSL-2"),
    ("dsl-3", "DSL-3"),
    ("dsl-4", "DSL-4"),
    ("dsl-5-plus", "DSL-5+"),
];

pub const REGULATIONS: [(&str, &str); 7] = [
    ("privacy-act", "Privacy Act 1988 / Notifiable Data Breaches"),
    ("soci", "SOCI Act (critical infrastructure)"),
    ("cps-234", "APRA CPS 234"),
    ("pci", "PCI DSS"),
    ("gdpr", "GDPR"),
    ("hipaa", "HIPAA"),
    ("other", "Other regulatory or contractual obligation"),
];

pub const EXPOSURES: [(&str, &str); 7] = [
    (
        "external-sharing",
        "Content can be shared with people outside the organisation",
    ),
    ("guest-access", "Guest or external accounts have access"),
    (
        "internet-facing",
        "Reachable from the internet without a trusted network or device",
    ),
    (
        "standing-admin",
        "Administrators hold permanent (not just-in-time) privileges",
    ),
    (
        "third-party-apps",
        "Third-party apps or integrations hold delegated or application access",
    ),
    ("unmanaged-devices", "Accessible from unmanaged or personal devices"),
    (
        "ai-grounding",
        "Indexed by an AI assistant (Copilot / Gemini) that answers users' questions",
    ),
];

pub const SECTORS: [&str; 11] = [
    "Government",
    "Health",
    "Education",
    "Financial services",
    "Critical infrastructure",
    "Legal & professional services",
    "Not-for-profit / community",
    "Retail & hospitality",
    "Technology",
    "Manufacturing",
    "Other",
];

pub const SIZES: [&str; 5] = [
    "1–19 staff",
    "20–199 staff",
    "200–999 staff",
    "1,000–4,999 staff",
    "5,000+ staff",
];

pub fn label_of(table: &[(&'static str, &'static str)], id: &str) -> String {
    table
        .iter()
        .find(|(k, _)| *k == id)
        .map_or_else(|| id.to_string(), |(_, v)| v.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Org {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abn: Option<String>,
    pub sector: String,
    pub size: String,
    pub jurisdiction: String,
    pub regulations: Vec<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Jewel {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub asset_type: String,
    pub description: String,
    pub classification: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dsl: Option<String>,
    pub confidentiality: u8,
    pub integrity: u8,
    pub availability: u8,
    pub regulations: Vec<String>,
    pub exposures: Vec<String>,
    pub business_processes: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Branding {
    pub primary: String,
    pub accent: String,
    pub marking: String,
    pub prepared_by: String,
    pub prepared_for: String,
    /// Logo and backdrop: set in the web app, kept as they are here.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Assessment {
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub schema_version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    pub org: Org,
    pub platforms: Vec<String>,
    pub modules: IndexMap<String, Vec<String>>,
    pub licence: IndexMap<String, String>,
    pub jewels: Vec<Jewel>,
    pub answers: IndexMap<String, Answer>,
    pub notes: IndexMap<String, String>,
    pub branding: Branding,
    pub created_at: String,
    pub updated_at: String,
    /// Everything else in the file: savedBy, soc, aiRegister, evidence, imports, orphans, ismBaseline, progress and
    /// fields from newer builds.
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

impl Assessment {
    /// A blank assessment, as `emptyAssessment()` in the web app.
    pub fn empty() -> Assessment {
        let now = now_iso();
        let mut rest = Map::new();
        rest.insert("progress".into(), json!({ "step": 0, "layout": 3 }));
        Assessment {
            schema: None,
            schema_version: SCHEMA_VERSION,
            mode: None,
            org: Org {
                name: String::new(),
                abn: None,
                sector: String::new(),
                size: String::new(),
                jurisdiction: "Australia".into(),
                regulations: vec![],
                extra: Map::new(),
            },
            platforms: vec![],
            modules: IndexMap::new(),
            licence: IndexMap::new(),
            jewels: vec![],
            answers: IndexMap::new(),
            notes: IndexMap::new(),
            branding: Branding {
                primary: "#1f3a5f".into(),
                accent: "#d97706".into(),
                marking: "OFFICIAL: Sensitive".into(),
                prepared_by: String::new(),
                prepared_for: String::new(),
                extra: Map::new(),
            },
            created_at: now.clone(),
            updated_at: now,
            rest,
        }
    }

    pub fn touch(&mut self) {
        self.updated_at = now_iso();
    }

    pub fn evidence(&self, question: &str) -> Option<&Value> {
        self.rest.get("evidence")?.get(question)
    }
}

/// What opening a file found, besides the assessment itself.
#[derive(Debug, Default, Clone)]
pub struct Opened {
    /// Schema version the file was written at, when it was migrated up.
    pub migrated_from: Option<u64>,
    /// The file is newer than this build: shown, but never saved over.
    pub read_only: bool,
    /// Sections the TUI keeps but can't edit.
    pub web_only: Vec<&'static str>,
}

/// Parse a saved file, migrating older formats as the web app does (`src/wizard/migrations.ts`).
pub fn parse(text: &str) -> Result<(Assessment, Opened)> {
    let mut raw: Map<String, Value> = match serde_json::from_str(text).context("not valid JSON")? {
        Value::Object(m) => m,
        _ => bail!("not a crownguard assessment (expected a JSON object)"),
    };
    if raw.contains_key("crownguardEncrypted") {
        bail!("this file is encrypted with a passphrase; open it in the web app and save an unencrypted copy");
    }
    let from = match (
        raw.get("schemaVersion").and_then(Value::as_u64),
        raw.get("version").and_then(Value::as_u64),
    ) {
        (Some(v), _) if v >= 1 => v,
        (_, Some(1)) => 1,
        _ => bail!("not a crownguard assessment (no schemaVersion)"),
    };
    let mut opened = Opened::default();
    if from > SCHEMA_VERSION {
        opened.read_only = true;
    } else if from < SCHEMA_VERSION {
        // 1 → 2 drops the legacy `version` marker; 2 → 3 and 3 → 4 only added optional fields.
        raw.remove("version");
        raw.insert("schemaVersion".into(), json!(SCHEMA_VERSION));
        opened.migrated_from = Some(from);
    }
    if raw.get("mode").and_then(Value::as_str) == Some("ai-register") {
        bail!(
            "this is an AI-register-only assessment; the terminal app runs the full crown-jewel assessment, so open it in the web app"
        );
    }
    let assessment: Assessment =
        serde_json::from_value(Value::Object(raw)).map_err(|e| anyhow!("invalid assessment: {e}"))?;
    for (i, j) in assessment.jewels.iter().enumerate() {
        for (field, v) in [
            ("confidentiality", j.confidentiality),
            ("integrity", j.integrity),
            ("availability", j.availability),
        ] {
            if !(1..=5).contains(&v) {
                bail!("invalid assessment: jewels.{i}.{field}: must be 1 to 5, not {v}");
            }
        }
    }
    for (key, label) in [
        ("soc", "SOC maturity"),
        ("aiRegister", "AI register"),
        ("evidence", "scan evidence"),
    ] {
        if assessment.rest.contains_key(key) {
            opened.web_only.push(label);
        }
    }
    Ok((assessment, opened))
}

pub fn load(path: &Path) -> Result<(Assessment, Opened)> {
    let text = fs::read_to_string(path).with_context(|| format!("can't read {}", path.display()))?;
    parse(&text).with_context(|| path.display().to_string())
}

/// The file contents, as `toSaveFile` in the web app: `$schema`, current `schemaVersion` and a `savedBy` stamp.
pub fn to_save_file(a: &Assessment) -> Result<String> {
    let mut out = a.clone();
    out.schema = Some(SCHEMA_URL.into());
    out.schema_version = SCHEMA_VERSION;
    let content_hash = a.rest.get("savedBy").and_then(|s| s.get("contentHash")).cloned();
    let mut saved_by = json!({
        "app": "crownguard-tui",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "savedAt": now_iso(),
    });
    if let Some(hash) = content_hash {
        saved_by["contentHash"] = hash;
    }
    out.rest.insert("savedBy".into(), saved_by);
    Ok(serde_json::to_string_pretty(&out)?)
}

/// Write via a temporary file and rename, so a crash mid-write never leaves half a file.
pub fn save(a: &Assessment, path: &Path) -> Result<()> {
    let text = to_save_file(a)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).with_context(|| format!("can't write {}", tmp.display()))?;
    fs::rename(&tmp, path).with_context(|| format!("can't write {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../e2e/fixtures");

    #[test]
    fn opens_and_migrates_legacy_file() {
        let (a, opened) = load(Path::new(&format!("{FIXTURES}/legacy.crownguard.json"))).unwrap();
        assert_eq!(opened.migrated_from, Some(1));
        assert_eq!(a.schema_version, SCHEMA_VERSION);
        assert!(!a.rest.contains_key("version"));
    }

    #[test]
    fn round_trip_keeps_fields_the_tui_does_not_edit() {
        let path = format!("{FIXTURES}/current.crownguard.json");
        let original: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let (a, opened) = load(Path::new(&path)).unwrap();
        assert!(opened.web_only.contains(&"SOC maturity"));
        let saved: Value = serde_json::from_str(&to_save_file(&a).unwrap()).unwrap();
        for (key, value) in original.as_object().unwrap() {
            if ["schemaVersion", "savedBy", "$schema"].contains(&key.as_str()) {
                continue;
            }
            assert_eq!(saved.get(key), Some(value), "{key} survives a save");
        }
        assert_eq!(saved["savedBy"]["app"], "crownguard-tui");
        assert_eq!(saved["schemaVersion"], SCHEMA_VERSION);
    }

    #[test]
    fn empty_assessment_round_trips() {
        let text = to_save_file(&Assessment::empty()).unwrap();
        let (a, opened) = parse(&text).unwrap();
        assert!(opened.migrated_from.is_none() && !opened.read_only);
        assert_eq!(a.org.jurisdiction, "Australia");
    }

    #[test]
    fn refuses_encrypted_and_ai_register_files() {
        assert!(parse(r#"{"crownguardEncrypted":1,"ciphertext":"x"}"#).is_err());
        let mut v: Value = serde_json::from_str(&to_save_file(&Assessment::empty()).unwrap()).unwrap();
        v["mode"] = json!("ai-register");
        assert!(parse(&v.to_string()).is_err());
    }

    /// Whatever the TUI writes must pass the JSON Schema the web app publishes for this format.
    #[test]
    fn saved_files_match_the_published_schema() {
        let schema_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../public/schema/crownguard-assessment.v4.json"
        );
        let schema: Value = serde_json::from_str(&fs::read_to_string(schema_path).unwrap()).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        let mut filled = Assessment::empty();
        filled.org.name = "Riverbend Health".into();
        filled.org.abn = Some("51824753556".into());
        filled.platforms.push("microsoft".into());
        filled.answers.insert("MS-ID-001".into(), Answer::Na);
        filled.notes.insert("MS-ID-001".into(), "No users".into());
        let mut cases = vec![filled, Assessment::empty()];
        for f in ["legacy", "current", "branded"] {
            cases.push(load(Path::new(&format!("{FIXTURES}/{f}.crownguard.json"))).unwrap().0);
        }
        for a in cases {
            let saved: Value = serde_json::from_str(&to_save_file(&a).unwrap()).unwrap();
            let errors: Vec<String> = validator
                .iter_errors(&saved)
                .map(|e| format!("{}: {e}", e.instance_path))
                .collect();
            assert!(errors.is_empty(), "{errors:#?}");
        }
    }

    #[test]
    fn refuses_ratings_outside_one_to_five() {
        let mut v: Value =
            serde_json::from_str(&fs::read_to_string(format!("{FIXTURES}/current.crownguard.json")).unwrap()).unwrap();
        v["jewels"][0]["integrity"] = json!(9);
        assert!(parse(&v.to_string()).unwrap_err().to_string().contains("integrity"));
    }

    #[test]
    fn newer_files_open_read_only() {
        let mut v: Value = serde_json::from_str(&to_save_file(&Assessment::empty()).unwrap()).unwrap();
        v["schemaVersion"] = json!(SCHEMA_VERSION + 1);
        let (_, opened) = parse(&v.to_string()).unwrap();
        assert!(opened.read_only);
    }
}
