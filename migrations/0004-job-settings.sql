-- Job settings (General / Notifications / Job Boards / Application Form).
ALTER TABLE jobs ADD COLUMN salary TEXT;
ALTER TABLE jobs ADD COLUMN subtitle TEXT;
ALTER TABLE jobs ADD COLUMN state TEXT;
ALTER TABLE jobs ADD COLUMN city TEXT;
ALTER TABLE jobs ADD COLUMN boards TEXT;      -- JSON: {monster,jooble,careerjet,indeed,linkedin,linkedinPostedAt}
ALTER TABLE jobs ADD COLUMN formConfig TEXT;  -- JSON: {fields:{key:{visible,required}} for the 9 apply-form fields}
ALTER TABLE users ADD COLUMN notifPref TEXT NOT NULL DEFAULT 'off';  -- 'off' | 'daily'
ALTER TABLE applications ADD COLUMN personalWebsite TEXT;
ALTER TABLE applications ADD COLUMN education TEXT;
ALTER TABLE applications ADD COLUMN workExperience TEXT;
ALTER TABLE applications ADD COLUMN files TEXT;  -- JSON array of uploaded file names (names only in the demo)
