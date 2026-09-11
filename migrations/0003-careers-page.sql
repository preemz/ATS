-- Careers page: single-row config + public job content fields.
CREATE TABLE IF NOT EXISTS careers_page (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

ALTER TABLE jobs ADD COLUMN publicTitle TEXT;
ALTER TABLE jobs ADD COLUMN descriptionHtml TEXT;
ALTER TABLE jobs ADD COLUMN questions TEXT;
