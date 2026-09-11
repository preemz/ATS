-- Daya Pipeline schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  passwordHash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  notifPref TEXT NOT NULL DEFAULT 'off',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES users(id),
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  jobType TEXT NOT NULL DEFAULT 'Other',
  location TEXT,
  publicTitle TEXT,
  descriptionHtml TEXT,
  questions TEXT,
  salary TEXT,
  subtitle TEXT,
  state TEXT,
  city TEXT,
  boards TEXT,
  formConfig TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId INTEGER NOT NULL REFERENCES jobs(id),
  title TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'default',  -- 'application' | 'default' | 'rejection'
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId INTEGER NOT NULL REFERENCES jobs(id),
  stageId INTEGER NOT NULL REFERENCES stages(id),
  candidateId INTEGER REFERENCES candidates(id),
  sort INTEGER NOT NULL DEFAULT 0,
  firstName TEXT NOT NULL DEFAULT '',
  lastName TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  linkedIn TEXT,
  phone TEXT,
  personalWebsite TEXT,
  education TEXT,
  workExperience TEXT,
  files TEXT,
  originType TEXT NOT NULL DEFAULT 'applied',  -- 'applied' | 'sourced'
  isFavorite INTEGER NOT NULL DEFAULT 0,
  interviewSuggested INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firstName TEXT NOT NULL DEFAULT '',
  lastName TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  linkedIn TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS candidate_tags (
  candidateId INTEGER NOT NULL REFERENCES candidates(id),
  tagId INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (candidateId, tagId)
);

CREATE TABLE IF NOT EXISTS careers_page (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS application_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicationId INTEGER NOT NULL REFERENCES applications(id),
  stageId INTEGER NOT NULL REFERENCES stages(id),
  sort INTEGER NOT NULL DEFAULT 0,
  movedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
