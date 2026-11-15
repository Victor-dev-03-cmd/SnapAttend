PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS institutions (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 admin_hash TEXT NOT NULL, subscription_tier TEXT NOT NULL DEFAULT 'trial',
 active_until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
 id TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
 code TEXT NOT NULL, name TEXT NOT NULL, teacher_pin_hash TEXT NOT NULL,
 UNIQUE(institution_id,code)
);
CREATE TABLE IF NOT EXISTS students (
 id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
 roll_no TEXT NOT NULL, name TEXT NOT NULL, parent_phone TEXT,
 parent_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(parent_opt_in IN (0,1)),
 fee_status TEXT NOT NULL DEFAULT 'paid', fee_due_date TEXT,
 UNIQUE(class_id,roll_no)
);
CREATE INDEX IF NOT EXISTS students_class ON students(class_id);
CREATE TABLE IF NOT EXISTS attendance_batches (
 id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id), date TEXT NOT NULL,
 submitted_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(class_id,date)
);
CREATE TABLE IF NOT EXISTS attendance_logs (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES attendance_batches(id) ON DELETE CASCADE,
 student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
 class_id TEXT NOT NULL REFERENCES classes(id), date TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('present','absent')),
 parent_reply_status TEXT NOT NULL DEFAULT 'pending',
 emergency_flag INTEGER NOT NULL DEFAULT 0, acknowledged_at TEXT,
 UNIQUE(student_id,date)
);
CREATE INDEX IF NOT EXISTS attendance_class_date ON attendance_logs(class_id,date);
CREATE INDEX IF NOT EXISTS attendance_emergencies ON attendance_logs(emergency_flag,acknowledged_at);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, institution_id TEXT NOT NULL REFERENCES institutions(id),
 class_id TEXT, role TEXT NOT NULL CHECK(role IN ('admin','teacher')),
 expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_jobs (
 id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL CHECK(kind IN ('absence','fee')),
 student_id TEXT NOT NULL REFERENCES students(id),
 attendance_id TEXT REFERENCES attendance_logs(id),
 status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_events (
 id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS homework_broadcasts (
 id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id),
 date TEXT NOT NULL, audio_path TEXT, mime_type TEXT, transcript_text TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Student device access is explicitly issued by an administrator. Raw tokens never enter SQLite.
CREATE TABLE IF NOT EXISTS student_access_tokens (
  token_hash TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS student_access_expiry ON student_access_tokens(expires_at);

-- A parent request never reveals location by itself. A student must choose to share.
CREATE TABLE IF NOT EXISTS location_requests (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','shared','expired'))
);
CREATE INDEX IF NOT EXISTS location_request_lookup ON location_requests(student_id,status,expires_at);

-- Precise coordinates are transient (24h maximum in active DB; production backups require separate policy).
CREATE TABLE IF NOT EXISTS safety_events (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('checkin','sos','parent_request')),
  latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy_m REAL NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  notification_status TEXT NOT NULL DEFAULT 'not_configured',
  location_request_id TEXT REFERENCES location_requests(id)
);
CREATE INDEX IF NOT EXISTS safety_events_recent ON safety_events(institution_id,created_at);
CREATE INDEX IF NOT EXISTS safety_events_expiry ON safety_events(expires_at);
