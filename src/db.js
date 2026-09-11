// Daya Pipeline — D1 data access + password hashing + helpers.
// No npm deps. Same PBKDF2 scheme as KerjaBoard (100k iters, 256-bit hex).

const ITERATIONS = 100000;

export function randomHex(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations: ITERATIONS },
    key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexEquals(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Tolerant JSON parse for anything read from D1 (may be NULL / empty / truncated).
export function safeJson(v, fallback) {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

export function makeDal(db) {
  const first = async (sql, ...params) => (await db.prepare(sql).bind(...params).first());
  const all = async (sql, ...params) => (await db.prepare(sql).bind(...params).all()).results;
  const run = async (sql, ...params) => db.prepare(sql).bind(...params).run();
  const allIn = async (sqlPrefix, ids, suffix = '') => {
    const out = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const rows = await all(`${sqlPrefix} IN (${chunk.map(() => '?').join(',')})${suffix}`, ...chunk);
      out.push(...rows);
    }
    return out;
  };
  const updateRow = async (table, id, fields) => {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    await run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
      ...keys.map((k) => fields[k]), id);
  };

  return {
    // users / sessions
    findUserByEmail: async (email) => first('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email),
    findUserById: async (id) => first('SELECT * FROM users WHERE id = ?', id),
    listUsers: () => all('SELECT id, email, name, role, notifPref FROM users ORDER BY name'),
    updateUser: (id, fields) => updateRow('users', id, fields),
    createSession: (token, userId) => run('INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)',
      token, userId, new Date().toISOString()),
    findSession: async (token) => first('SELECT * FROM sessions WHERE token = ?', token),
    deleteSession: (token) => run('DELETE FROM sessions WHERE token = ?', token),

    // jobs
    listJobs: () => all('SELECT * FROM jobs ORDER BY id'),
    listJobsWithCounts: () => all(`SELECT j.*, (SELECT COUNT(*) FROM applications a WHERE a.jobId = j.id) AS nApps
      FROM jobs j ORDER BY j.id`),
    findJob: async (id) => first('SELECT * FROM jobs WHERE id = ?', id),
    insertJob: (fields) => run(
      'INSERT INTO jobs (title, status, jobType, location, createdAt) VALUES (?, ?, ?, ?, ?)',
      fields.title, fields.status || 'active', fields.jobType || 'Other', fields.location || null,
      fields.createdAt || new Date().toISOString()),
    updateJob: (id, fields) => updateRow('jobs', id, fields),

    // candidates
    findCandidate: async (id) => first('SELECT * FROM candidates WHERE id = ?', id),
    findCandidateByEmail: async (email) => email
      ? first('SELECT * FROM candidates WHERE email = ? COLLATE NOCASE', email) : null,
    insertCandidate: (fields) => run(
      'INSERT INTO candidates (firstName, lastName, email, linkedIn, createdAt) VALUES (?, ?, ?, ?, ?)',
      fields.firstName || '', fields.lastName || '', fields.email || '', fields.linkedIn || null,
      fields.createdAt || new Date().toISOString()),
    updateCandidate: (id, fields) => updateRow('candidates', id, fields),
    deleteCandidate: (id) => run('DELETE FROM candidates WHERE id = ?', id),
    // Candidates table rows = ONE row per candidate, showing their LATEST application
    // (same semantics as Hirefly's candidates list).
    listCandidateRows: async ({ offset = 0, limit = 50, tagIds = [], sort = 'applied', dir = 'desc' } = {}) => {
      const params = [];
      let where = `WHERE a.id = (SELECT a2.id FROM applications a2 WHERE a2.candidateId = c.id ORDER BY a2.createdAt DESC, a2.id DESC LIMIT 1)`;
      if (tagIds.length) {
        where += ` AND c.id IN (SELECT candidateId FROM candidate_tags WHERE tagId IN (${tagIds.map(() => '?').join(',')}))`;
        params.push(...tagIds.map(Number));
      }
      const order = sort === 'name'
        ? `c.lastName COLLATE NOCASE ${dir === 'asc' ? 'ASC' : 'DESC'}, c.firstName COLLATE NOCASE ${dir === 'asc' ? 'ASC' : 'DESC'}`
        : `a.createdAt ${dir === 'asc' ? 'ASC' : 'DESC'}`;
      return all(`SELECT a.id AS appId, a.jobId, a.createdAt AS appliedAt,
                         c.id AS candidateId, c.firstName, c.lastName, c.email, c.linkedIn,
                         j.title AS jobTitle
                  FROM applications a
                  JOIN candidates c ON c.id = a.candidateId
                  JOIN jobs j ON j.id = a.jobId
                  ${where}
                  ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset);
    },
    countCandidateRows: async ({ tagIds = [] } = {}) => {
      const conds = ['EXISTS (SELECT 1 FROM applications a WHERE a.candidateId = c.id)'];
      const params = [];
      if (tagIds.length) {
        conds.push(`c.id IN (SELECT candidateId FROM candidate_tags WHERE tagId IN (${tagIds.map(() => '?').join(',')}))`);
        params.push(...tagIds.map(Number));
      }
      const r = await first(`SELECT COUNT(*) AS n FROM candidates c WHERE ${conds.join(' AND ')}`, ...params);
      return r ? r.n : 0;
    },
    // Legacy applications without a candidate link (defensive: show them with a null join).
    listApplicationRowsForCandidates: () => all(`SELECT a.id AS appId, a.jobId, a.createdAt AS appliedAt,
        a.candidateId, a.firstName, a.lastName, a.email, j.title AS jobTitle
      FROM applications a JOIN jobs j ON j.id = a.jobId ORDER BY a.createdAt DESC`),

    // tags
    listTags: () => all('SELECT * FROM tags ORDER BY id'),
    findTag: async (id) => first('SELECT * FROM tags WHERE id = ?', id),
    insertTag: (title) => run('INSERT INTO tags (title, createdAt) VALUES (?, ?)',
      String(title).trim(), new Date().toISOString()),
    listTagsForCandidates: async (candidateIds) => {
      if (!candidateIds.length) return [];
      const rows = await allIn('SELECT * FROM candidate_tags WHERE candidateId', candidateIds);
      return rows;
    },
    setCandidateTag: (candidateId, tagId, isAdd) => isAdd
      ? run('INSERT OR IGNORE INTO candidate_tags (candidateId, tagId) VALUES (?, ?)', candidateId, tagId)
      : run('DELETE FROM candidate_tags WHERE candidateId = ? AND tagId = ?', candidateId, tagId),
    deleteCandidateTagRows: (candidateId) => run('DELETE FROM candidate_tags WHERE candidateId = ?', candidateId),

    // stages
    listStagesByJob: (jobId) => all('SELECT * FROM stages WHERE jobId = ? ORDER BY sort', jobId),
    insertStage: (fields) => run(
      'INSERT INTO stages (jobId, title, variant, sort) VALUES (?, ?, ?, ?)',
      fields.jobId, fields.title, fields.variant || 'default', fields.sort ?? 0),
    updateStage: (id, fields) => updateRow('stages', id, fields),
    deleteStage: (id) => run('DELETE FROM stages WHERE id = ?', id),

    // applications
    listApplicationsByJob: (jobId) => all('SELECT * FROM applications WHERE jobId = ? ORDER BY sort, id', jobId),
    listApplicationsByJobIds: async (jobIds) => allIn('SELECT * FROM applications WHERE jobId', jobIds),
    findApplication: async (id) => first('SELECT * FROM applications WHERE id = ?', id),
    insertApplication: (fields) => run(
      `INSERT INTO applications (jobId, stageId, candidateId, sort, firstName, lastName, email, linkedIn, phone, personalWebsite, education, workExperience, files, originType, isFavorite, interviewSuggested, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fields.jobId, fields.stageId, fields.candidateId ?? null, fields.sort ?? 0, fields.firstName || '', fields.lastName || '',
      fields.email || '', fields.linkedIn || null, fields.phone || null, fields.personalWebsite || null,
      fields.education || null, fields.workExperience || null, fields.files || null, fields.originType || 'applied',
      fields.isFavorite ? 1 : 0, fields.interviewSuggested ? 1 : 0, fields.createdAt || new Date().toISOString()),
    updateApplication: (id, fields) => updateRow('applications', id, fields),
    deleteApplication: (id) => run('DELETE FROM applications WHERE id = ?', id),

    // stage-change history
    insertStageHistory: (applicationId, stageId, sort, movedAt) =>
      run('INSERT INTO application_stages (applicationId, stageId, sort, movedAt) VALUES (?, ?, ?, ?)',
        applicationId, stageId, sort, movedAt || new Date().toISOString()),
    deleteStageHistoryForApplication: (applicationId) =>
      run('DELETE FROM application_stages WHERE applicationId = ?', applicationId),
    listStageHistory: (applicationIds) => allIn(
      'SELECT * FROM application_stages WHERE applicationId', applicationIds, ' ORDER BY movedAt DESC'),

    // careers page (single-row config)
    getCareersPage: async () => first('SELECT * FROM careers_page WHERE id = 1'),
    saveCareersPage: (configJson) => run(
      `INSERT INTO careers_page (id, config, updatedAt) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET config = excluded.config, updatedAt = excluded.updatedAt`,
      configJson, new Date().toISOString()),
    listActiveJobs: () => all("SELECT * FROM jobs WHERE status = 'active' ORDER BY id"),

    // outbox (demo mail log — no real provider wired)
    insertOutbox: (fields) => run(
      'INSERT INTO outbox (recipient, subject, body, createdAt, delivered, note) VALUES (?, ?, ?, ?, ?, ?)',
      fields.recipient, fields.subject, fields.body, new Date().toISOString(),
      fields.delivered ? 1 : 0, fields.note || 'Demo mode — email logged, not sent'),
    listOutbox: (limit = 100) => all(`SELECT * FROM outbox ORDER BY id DESC LIMIT ${Number(limit) || 100}`),
  };
}
