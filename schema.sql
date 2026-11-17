CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  course TEXT NOT NULL,
  rnum INTEGER NOT NULL,
  race_name TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  images TEXT DEFAULT '[]',
  horses TEXT,
  research TEXT,
  yosou TEXT,
  kekka TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT UNIQUE,
  date TEXT, course TEXT, r INTEGER, race_name TEXT, class TEXT,
  bet_type TEXT, bets TEXT, invest INTEGER, payout INTEGER, hit INTEGER,
  honmei_rank TEXT, axis_rank TEXT, good_points TEXT, bad_points TEXT, memo TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT,
  text TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
