// Seed script: creates the 5 Daya Ventures users + imports ALL exported Hirefly
// boards (jobs, stages, applications, candidates, tags). Run against REMOTE D1:
//   node scripts/seed.mjs boards-all.json
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

function d1(sql, { local = false } = {}) {
  const f = `/tmp/dp_seed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.sql`;
  writeFileSync(f, sql);
  try {
    const args = ['npx', 'wrangler', 'd1', 'execute', 'daya-pipeline',
      local ? '--local' : '--remote', '--json', '--file', f];
    return execSync(args.join(' '), { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } finally { try { unlinkSync(f); } catch {} }
}

// Batch many statements into few wrangler calls (25 statements per call).
function makeBatcher(chunkSize = 25) {
  let buf = [];
  return {
    add(stmt) {
      buf.push(stmt);
      if (buf.length >= chunkSize) this.flush();
    },
    flush() {
      if (!buf.length) return;
      d1(buf.join('\n'));
      buf = [];
    },
  };
}
const q = (s) => String(s ?? '').replace(/'/g, "''");
const dnow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---- 1) users ----
const { randomHex, hashPassword } = await import('../src/db.js');

const USERS = [
  { email: 'jenny@daya.se', name: 'Jenny Lundkvist', notifPref: 'daily' },
  { email: 'malin@daya.se', name: 'Malin Frithiofsson', notifPref: 'off' },
  { email: 'primawan@daya.se', name: 'Primawan Satrio', notifPref: 'daily' },
  { email: 'josefine@daya.se', name: 'Josefine Hovmark', notifPref: 'off' },
  { email: 'emma@daya.se', name: 'Emma Lindholm', notifPref: 'daily' },
];
const PASSWORD = process.env.DP_PASSWORD || 'daya-ventures-2026';

let userRows = '';
for (const u of USERS) {
  const salt = randomHex(16);
  const hash = await hashPassword(PASSWORD, salt);
  userRows += `INSERT INTO users (email, name, passwordHash, salt, role, notifPref, createdAt) VALUES ('${u.email}', '${q(u.name)}', '${hash}', '${salt}', 'member', '${u.notifPref}', datetime('now'));\n`;
}
d1("DELETE FROM candidate_tags; DELETE FROM tags; DELETE FROM application_stages; DELETE FROM applications; DELETE FROM candidates; DELETE FROM stages; DELETE FROM jobs; DELETE FROM sessions; DELETE FROM users WHERE email LIKE '%@daya.se';");
d1(userRows);
console.log('users created');

// ---- 2) boards ----
const boardsPath = process.argv[2] || 'boards-all.json';
const boards = JSON.parse(readFileSync(boardsPath, 'utf8'));
const jobDetails = JSON.parse(readFileSync('job_details.json', 'utf8'));

// candidates first (dedupe by email|name)
const candMap = new Map(); // key -> {firstName,lastName,email,linkedIn,createdAt}
for (const b of boards) {
  for (const a of b.applications) {
    const key = (a.email || '').trim().toLowerCase() || (`${a.firstName}|${a.lastName}`).trim().toLowerCase();
    if (!candMap.has(key)) {
      candMap.set(key, {
        firstName: a.firstName || '', lastName: a.lastName || '',
        email: a.email || '', linkedIn: a.linkedIn || null,
        createdAt: (a.createdAt || '').replace('$D', '') || dnow(),
      });
    }
  }
}
let candId = 0;
const candIdByKey = {};
const candBatch = makeBatcher(25);
for (const [key, c] of candMap) {
  candId++;
  candIdByKey[key] = candId;
  candBatch.add(`INSERT INTO candidates (id, firstName, lastName, email, linkedIn, createdAt) VALUES (${candId}, '${q(c.firstName)}', '${q(c.lastName)}', '${q(c.email)}', ${c.linkedIn ? `'${q(c.linkedIn)}'` : 'NULL'}, '${c.createdAt.replace('T', ' ').slice(0, 19)}');`);
}
candBatch.flush();
console.log('candidates created:', candId);

const jobBatch = makeBatcher(25);
const stageBatch = makeBatcher(25);
let jobId = 0, globalStageId = 0, globalAppId = 0;
const appBatch = makeBatcher(25);
for (const b of boards) {
  jobId++;
  const createdAt = (b.hCreatedAt || dnow()).replace('T', ' ').slice(0, 19);
  jobBatch.add(`INSERT INTO jobs (id, title, status, jobType, createdAt) VALUES (${jobId}, '${q(b.title)}', '${b.status || 'draft'}', '${q(b.jobType || 'Other')}', '${createdAt}');`);
  const detail = jobDetails[b.slug];
  if (detail && !detail.error) {
    const publicTitle = detail.h2 || b.title;
    const desc = detail.jlDesc || '';
    // Standard fields captured on Hirefly's live form (they render as textareas
    // there) belong in the Application Form settings, not the custom questions.
    const STD_LABELS = { 'work experience': 'workExperience', 'education': 'education', 'phone': 'phone', 'personal website': 'personalWebsite' };
    const formFields = {
      firstName: { visible: true, required: true }, lastName: { visible: true, required: true },
      email: { visible: true, required: true }, linkedIn: { visible: true, required: true },
      phone: { visible: false, required: false }, personalWebsite: { visible: false, required: false },
      education: { visible: false, required: false }, workExperience: { visible: false, required: false },
      fileUpload: { visible: false, required: false },
    };
    const qs = (detail.questions || []).filter((l) => {
      const k = STD_LABELS[String(l).trim().toLowerCase()];
      if (k) { formFields[k].visible = true; return false; }
      return true;
    });
    const questions = JSON.stringify(qs);
    const formConfig = JSON.stringify(formFields);
    const boardsJson = JSON.stringify({ monster: true, jooble: true, careerjet: true, indeed: true, linkedin: false, linkedinPostedAt: null });
    jobBatch.add(`UPDATE jobs SET publicTitle = '${q(publicTitle)}', descriptionHtml = '${q(desc)}', questions = '${q(questions)}', boards = '${q(boardsJson)}', formConfig = '${q(formConfig)}' WHERE id = ${jobId};`);
  }
  const sidMap = {};
  const sortedCols = [...b.columns].sort((a, b2) => a.order - b2.order);
  for (const c of sortedCols) {
    globalStageId++;
    sidMap[c.id] = globalStageId;
    stageBatch.add(`INSERT INTO stages (id, jobId, title, variant, sort) VALUES (${globalStageId}, ${jobId}, '${q(c.title)}', '${c.variant}', ${c.order});`);
  }
  // Parents must exist before any application batch referencing them flushes.
  jobBatch.flush();
  stageBatch.flush();
  const byStage = {};
  for (const a of b.applications) (byStage[a.applicationStageId] ||= []).push(a);
  for (const [oldSid, apps] of Object.entries(byStage)) {
    let sort = 0;
    for (const a of apps) {
      globalAppId++;
      const key = (a.email || '').trim().toLowerCase() || (`${a.firstName}|${a.lastName}`).trim().toLowerCase();
      const created = (a.createdAt || '').replace('$D', '').replace('T', ' ').slice(0, 19) || dnow();
      appBatch.add(`INSERT INTO applications (id, jobId, stageId, candidateId, sort, firstName, lastName, email, linkedIn, originType, isFavorite, interviewSuggested, createdAt)
VALUES (${globalAppId}, ${jobId}, ${sidMap[oldSid]}, ${candIdByKey[key] || 'NULL'}, ${sort}, '${q(a.firstName)}', '${q(a.lastName)}', '${q(a.email)}', ${a.linkedIn ? `'${q(a.linkedIn)}'` : 'NULL'}, '${a.originType || 'applied'}', ${a.isFavorite ? 1 : 0}, ${a.interviewSuggested ? 1 : 0}, '${created}');`);
      sort++;
    }
  }
  appBatch.flush();
  console.log(`job ${jobId}: ${b.title.slice(0, 44)} [${b.status}/${b.jobType}] — ${sortedCols.length} stages, ${b.applications.length} cards`);
}

// ---- 3) tags + assignments ----
let tagRows = '';
const TAGLIST = [
  'malin finds interesting',
  'interesting but not for this startup',
  'interesting for pathem',
  'interesting for neblina',
  'not it',
  'interesting in another role',
];
let tagId = 0;
const tagIdByTitle = {};
for (const t of TAGLIST) {
  tagId++;
  tagIdByTitle[t] = tagId;
  tagRows += `INSERT INTO tags (id, title, createdAt) VALUES (${tagId}, '${q(t)}', datetime('now'));\n`;
}
d1(tagRows);

// assignments captured from Hirefly (tag title -> candidate emails)
let assignRows = '';
let assigned = 0;
try {
  const assign = JSON.parse(readFileSync('tag_assignments.json', 'utf8'));
  for (const [, info] of Object.entries(assign)) {
    const tag = tagIdByTitle[info.title];
    if (!tag) continue;
    for (const row of info.rows) {
      const email = (row[1] || '').trim().toLowerCase();
      if (!email) continue;
      if (candIdByKey[email]) { assignRows += `INSERT OR IGNORE INTO candidate_tags (candidateId, tagId) VALUES (${candIdByKey[email]}, ${tag});\n`; assigned++; }
    }
  }
  d1(assignRows);
} catch (e) { console.log('tag assignments skipped:', e.message); }
console.log('tags:', tagId, '| assignments:', assigned);

// ---- 4) careers page config ----
try {
  const careersConfig = JSON.parse(readFileSync('careers_config.json', 'utf8'));
  d1(`INSERT INTO careers_page (id, config, updatedAt) VALUES (1, '${q(JSON.stringify(careersConfig))}', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET config = excluded.config, updatedAt = excluded.updatedAt;`);
  console.log('careers page config seeded:', careersConfig.sections.length, 'sections');
} catch (e) { console.log('careers config skipped:', e.message); }

console.log('\nDEMO LOGINS (same password for all):');
for (const u of USERS) console.log(`  ${u.email} / ${PASSWORD}`);
