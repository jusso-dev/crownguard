-- Autosave: the same keys the web build keeps in localStorage (crownguard:v1 and friends).
-- An encrypted assessment is stored here only as its encryption envelope.
CREATE TABLE autosave (
  key        TEXT PRIMARY KEY NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Assessments this device has worked on: the autosave slot ('autosave') and every file opened or saved.
-- org_name, platforms and mode stay NULL for encrypted assessments, so the index never holds their plaintext.
CREATE TABLE assessments (
  id         TEXT PRIMARY KEY NOT NULL,
  org_name   TEXT,
  platforms  TEXT,
  mode       TEXT,
  encrypted  INTEGER NOT NULL DEFAULT 0,
  file_path  TEXT,
  updated_at TEXT NOT NULL
);

-- Desktop-only settings. update_check is off unless the user turns it on.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
