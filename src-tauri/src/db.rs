//! The local SQLite store: autosave values, the assessments index and desktop settings.
//!
//! Every function here takes plain values that the command layer has already validated. Nothing in this module
//! decrypts anything: an encrypted assessment arrives as its envelope and is stored, and indexed, as that envelope.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Schema migrations, applied in order. `PRAGMA user_version` records how many have run.
const MIGRATIONS: &[&str] = &[include_str!("../migrations/0001_init.sql")];

/// The autosave key the web build uses for the assessment itself (`STORAGE_KEY` in `persistence.ts`).
pub const ASSESSMENT_KEY: &str = "crownguard:v1";
/// The index row for the autosaved assessment.
pub const AUTOSAVE_ID: &str = "autosave";
/// Setting name for the optional update check.
pub const UPDATE_CHECK: &str = "update_check";

pub type Result<T> = std::result::Result<T, String>;

fn err(e: rusqlite::Error) -> String {
    format!("database error: {e}")
}

/// Open (or create) the database and bring its schema up to date.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).map_err(err)?;
    prepare(&conn)?;
    Ok(conn)
}

/// Connection settings and migrations. Split from `open` so tests can use an in-memory database.
pub fn prepare(conn: &Connection) -> Result<()> {
    // secure_delete zeroes freed pages, so a value overwritten (for example plain progress replaced by its encrypted
    // envelope once a passphrase is set) does not linger in the file. The rollback journal is deleted on commit.
    conn.execute_batch(
        "PRAGMA secure_delete = ON; PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;",
    )
    .map_err(err)?;
    let version: usize = conn
        .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map_err(err)?
        .try_into()
        .map_err(|_| "database error: negative schema version".to_string())?;
    if version > MIGRATIONS.len() {
        return Err(format!(
            "this database was written by a newer crownguard (schema {version}); update the app to open it"
        ));
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.unchecked_transaction().map_err(err)?;
        tx.execute_batch(sql).map_err(err)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))
            .map_err(err)?;
        tx.commit().map_err(err)?;
    }
    Ok(())
}

/// Seconds since the Unix epoch, as an RFC 3339 UTC timestamp.
pub fn now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    rfc3339(secs)
}

fn rfc3339(secs: u64) -> String {
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Civil-from-days (Howard Hinnant), valid for every date after 1970.
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(mo <= 2);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// What the index may record about an assessment. Encrypted assessments give up nothing but the fact.
#[derive(Debug, PartialEq, Eq)]
pub struct Summary {
    pub encrypted: bool,
    pub org_name: Option<String>,
    pub platforms: Option<String>,
    pub mode: Option<String>,
}

/// True for the crownguard encryption envelope (`crypto.ts`), whatever else it carries.
pub fn is_envelope(v: &Value) -> bool {
    v.get("crownguardEncrypted").is_some()
}

/// Read the index fields from an autosave value (`{"state":{"assessment":…}}`) or a saved file (the assessment
/// itself). An envelope, or anything that isn't JSON, yields no plaintext fields at all.
pub fn summarise(json: &str) -> Summary {
    let none = |encrypted| Summary {
        encrypted,
        org_name: None,
        platforms: None,
        mode: None,
    };
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return none(false);
    };
    if is_envelope(&v) {
        return none(true);
    }
    let a = v.pointer("/state/assessment").unwrap_or(&v);
    let org_name = a
        .pointer("/org/name")
        .and_then(Value::as_str)
        .map(|s| s.chars().take(200).collect::<String>())
        .filter(|s| !s.trim().is_empty());
    let platforms = a.get("platforms").and_then(Value::as_array).map(|p| {
        let ids: Vec<&str> = p.iter().filter_map(Value::as_str).take(16).collect();
        ids.join(",")
    });
    let mode = a
        .get("mode")
        .and_then(Value::as_str)
        .map(|m| m.chars().take(32).collect());
    Summary {
        encrypted: false,
        org_name,
        platforms,
        mode,
    }
}

/// Every autosave value, so the webview can serve the web build's synchronous storage reads from memory.
pub fn autosave_all(conn: &Connection) -> Result<HashMap<String, String>> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM autosave")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    rows.collect::<std::result::Result<_, _>>().map_err(err)
}

pub fn autosave_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    let at = now();
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO autosave (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, at],
    )
    .map_err(err)?;
    if key == ASSESSMENT_KEY {
        upsert_index(&tx, AUTOSAVE_ID, None, &summarise(value), &at)?;
    }
    tx.commit().map_err(err)
}

pub fn autosave_remove(conn: &Connection, key: &str) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute("DELETE FROM autosave WHERE key = ?1", params![key])
        .map_err(err)?;
    if key == ASSESSMENT_KEY {
        tx.execute(
            "DELETE FROM assessments WHERE id = ?1",
            params![AUTOSAVE_ID],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

fn upsert_index(
    conn: &Connection,
    id: &str,
    file_path: Option<&str>,
    s: &Summary,
    at: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO assessments (id, org_name, platforms, mode, encrypted, file_path, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET org_name = excluded.org_name, platforms = excluded.platforms,
           mode = excluded.mode, encrypted = excluded.encrypted, file_path = excluded.file_path,
           updated_at = excluded.updated_at",
        params![
            id,
            s.org_name,
            s.platforms,
            s.mode,
            s.encrypted,
            file_path,
            at
        ],
    )
    .map_err(err)?;
    Ok(())
}

/// Record a file the user opened or saved. Only the summary is kept, never the contents.
pub fn record_file(conn: &Connection, path: &str, contents: &str) -> Result<()> {
    upsert_index(conn, path, Some(path), &summarise(contents), &now())?;
    // Keep the index to the files someone is likely to want again.
    conn.execute(
        "DELETE FROM assessments WHERE file_path IS NOT NULL AND id NOT IN
           (SELECT id FROM assessments WHERE file_path IS NOT NULL ORDER BY updated_at DESC LIMIT 50)",
        [],
    )
    .map_err(err)?;
    Ok(())
}

pub fn forget_file(conn: &Connection, path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM assessments WHERE id = ?1 AND file_path IS NOT NULL",
        params![path],
    )
    .map_err(err)?;
    Ok(())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentAssessment {
    pub id: String,
    pub org_name: Option<String>,
    pub platforms: Vec<String>,
    pub mode: Option<String>,
    pub encrypted: bool,
    pub file_path: Option<String>,
    pub updated_at: String,
}

pub fn recent(conn: &Connection) -> Result<Vec<RecentAssessment>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, org_name, platforms, mode, encrypted, file_path, updated_at
             FROM assessments ORDER BY updated_at DESC, id LIMIT 50",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let platforms: Option<String> = r.get(2)?;
            Ok(RecentAssessment {
                id: r.get(0)?,
                org_name: r.get(1)?,
                platforms: platforms
                    .map(|p| {
                        p.split(',')
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default(),
                mode: r.get(3)?,
                encrypted: r.get(4)?,
                file_path: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })
        .map_err(err)?;
    rows.collect::<std::result::Result<_, _>>().map_err(err)
}

pub fn setting_bool(conn: &Connection, key: &str) -> Result<bool> {
    let v: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(v.as_deref() == Some("1"))
}

pub fn set_setting_bool(conn: &Connection, key: &str, on: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, if on { "1" } else { "0" }],
    )
    .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: &str = r#"{"state":{"assessment":{"org":{"name":"Acme Secret Pty Ltd"},"platforms":["microsoft","aws"],"answers":{"q1":"yes"}}},"version":4}"#;
    const ENVELOPE: &str = r#"{"crownguardEncrypted":1,"kdf":"PBKDF2-SHA-256","iterations":600000,"salt":"c2FsdHNhbHRzYWx0c2FsdA==","iv":"aXZpdml2aXZpdml2","ciphertext":"Q0lQSEVSVEVYVA=="}"#;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        prepare(&c).unwrap();
        c
    }

    #[test]
    fn migrations_are_idempotent_and_versioned() {
        let c = mem();
        prepare(&c).unwrap();
        let v: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn refuses_a_newer_schema() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA user_version = 99").unwrap();
        assert!(prepare(&c).unwrap_err().contains("newer crownguard"));
    }

    #[test]
    fn autosave_round_trips_and_indexes_plain_progress() {
        let c = mem();
        autosave_set(&c, ASSESSMENT_KEY, PLAIN).unwrap();
        autosave_set(&c, "crownguard:v1:ephemeral", "1").unwrap();
        let all = autosave_all(&c).unwrap();
        assert_eq!(all.get(ASSESSMENT_KEY).map(String::as_str), Some(PLAIN));
        let r = recent(&c).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].id, AUTOSAVE_ID);
        assert_eq!(r[0].org_name.as_deref(), Some("Acme Secret Pty Ltd"));
        assert_eq!(r[0].platforms, vec!["microsoft", "aws"]);
        autosave_remove(&c, ASSESSMENT_KEY).unwrap();
        assert!(recent(&c).unwrap().is_empty());
        assert!(!autosave_all(&c).unwrap().contains_key(ASSESSMENT_KEY));
    }

    #[test]
    fn summary_of_an_envelope_carries_no_plaintext() {
        assert_eq!(
            summarise(ENVELOPE),
            Summary {
                encrypted: true,
                org_name: None,
                platforms: None,
                mode: None
            }
        );
        let file = r#"{"schemaVersion":5,"org":{"name":"Org"},"platforms":["google"],"mode":"ai-register"}"#;
        let s = summarise(file);
        assert_eq!(s.org_name.as_deref(), Some("Org"));
        assert_eq!(s.platforms.as_deref(), Some("google"));
        assert_eq!(s.mode.as_deref(), Some("ai-register"));
        assert_eq!(
            summarise("not json"),
            Summary {
                encrypted: false,
                org_name: None,
                platforms: None,
                mode: None
            }
        );
    }

    /// The acceptance test for encryption at rest: read the database file itself, byte for byte, after plain
    /// progress was replaced by its encrypted envelope, and after an encrypted file was recorded.
    #[test]
    fn encrypted_assessments_never_reach_the_database_file_in_plaintext() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("crownguard.db");
        {
            let c = open(&path).unwrap();
            // Plain progress first, as before a passphrase was set; then the passphrase is set and the same key is
            // rewritten as an envelope. The long note pushes the plain value onto overflow pages, which are freed
            // (not rewritten) by the update, so this also checks that freed pages are zeroed.
            let long = PLAIN.replace(
                r#""answers""#,
                &format!(
                    r#""notes":{{"q1":"{}"}},"answers""#,
                    "Acme Secret Pty Ltd ".repeat(800)
                ),
            );
            autosave_set(&c, ASSESSMENT_KEY, &long).unwrap();
            autosave_set(&c, ASSESSMENT_KEY, ENVELOPE).unwrap();
            record_file(
                &c,
                "/Users/x/Documents/assessment.crownguard.json",
                ENVELOPE,
            )
            .unwrap();
        }
        let bytes = std::fs::read(&path).unwrap();
        let haystack = String::from_utf8_lossy(&bytes);
        for secret in ["Acme Secret Pty Ltd", "microsoft", "\"answers\""] {
            assert!(
                !haystack.contains(secret),
                "found {secret:?} in the database file"
            );
        }
        assert!(!dir.path().join("crownguard.db-journal").exists());
        assert!(!dir.path().join("crownguard.db-wal").exists());

        let c = open(&path).unwrap();
        for r in recent(&c).unwrap() {
            assert!(r.encrypted);
            assert_eq!(r.org_name, None);
            assert!(r.platforms.is_empty());
        }
        let stored = autosave_all(&c).unwrap();
        assert!(is_envelope(
            &serde_json::from_str(&stored[ASSESSMENT_KEY]).unwrap()
        ));
    }

    #[test]
    fn index_keeps_the_fifty_most_recent_files() {
        let c = mem();
        for i in 0..55 {
            record_file(&c, &format!("/f/{i:02}.crownguard.json"), "{}").unwrap();
            c.execute(
                "UPDATE assessments SET updated_at = ?1 WHERE id = ?2",
                params![
                    format!("2026-01-01T00:00:{i:02}Z"),
                    format!("/f/{i:02}.crownguard.json")
                ],
            )
            .unwrap();
        }
        record_file(&c, "/f/new.crownguard.json", "{}").unwrap();
        let r = recent(&c).unwrap();
        assert_eq!(r.len(), 50);
        assert_eq!(r[0].id, "/f/new.crownguard.json");
        forget_file(&c, "/f/new.crownguard.json").unwrap();
        assert_eq!(recent(&c).unwrap().len(), 49);
    }

    #[test]
    fn update_check_is_off_by_default() {
        let c = mem();
        assert!(!setting_bool(&c, UPDATE_CHECK).unwrap());
        set_setting_bool(&c, UPDATE_CHECK, true).unwrap();
        assert!(setting_bool(&c, UPDATE_CHECK).unwrap());
        set_setting_bool(&c, UPDATE_CHECK, false).unwrap();
        assert!(!setting_bool(&c, UPDATE_CHECK).unwrap());
    }

    #[test]
    fn timestamps_are_rfc3339() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(1_788_000_000), "2026-08-29T10:40:00Z");
        assert_eq!(rfc3339(951_782_400), "2000-02-29T00:00:00Z");
    }
}
