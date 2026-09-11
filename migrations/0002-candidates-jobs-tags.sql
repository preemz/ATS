-- Candidates, job metadata, and tags (Candidates + Jobs pages).
ALTER TABLE jobs ADD COLUMN jobType TEXT NOT NULL DEFAULT 'Other';
ALTER TABLE jobs ADD COLUMN location TEXT;

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  firstName TEXT NOT NULL DEFAULT '',
  lastName TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  linkedIn TEXT,
  createdAt TEXT NOT NULL
);

ALTER TABLE applications ADD COLUMN candidateId INTEGER REFERENCES candidates(id);

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
