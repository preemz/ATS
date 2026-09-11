// Daya Pipeline — standalone kanban ATS (Hirefly-style) for Daya Ventures.
import { makeDal, randomHex, hashPassword, hexEquals, parseCookies, esc, safeJson } from './db.js';
import * as views from './views.js';
import * as careers from './careers.js';
import { EDITOR_JS } from './careers-editor-client.js';
import { DAYA_LOGO_B64 } from './logo.js';

const SESSION_COOKIE = 'dp_session';
const CSRF_COOKIE = 'dp_csrf';

// ---------- helpers ----------

function ensureCsrf(ctx) {
  const existing = parseCookies(ctx.request)[CSRF_COOKIE];
  if (existing && /^[a-f0-9]{64}$/.test(existing)) { ctx.csrfToken = existing; return; }
  ctx.csrfToken = randomHex(32);
  ctx.csrfSetCookie = `${CSRF_COOKIE}=${ctx.csrfToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;
}

async function readForm(ctx) {
  const fd = await ctx.request.formData();
  const fields = {};
  for (const [name, value] of fd.entries()) {
    if (typeof value === 'string') fields[name] = value;
    else if (value && typeof value.name === 'string') fields[name] = value.name;  // file upload: keep the name (demo stores names only)
  }
  const expected = parseCookies(ctx.request)[CSRF_COOKIE] || '';
  if (!expected || !hexEquals(expected, String(fields._csrf || ''))) {
    throw new CsrfError('CSRF token missing or invalid');
  }
  return fields;
}

class CsrfError extends Error {}

function html(ctx, body, status = 200) {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  const token = ctx.csrfToken;
  const stamped = token
    ? String(body).replace(/<form\b[^>]*\bmethod=["']?post["']?[^>]*>/gi,
        (tag) => `${tag}<input type="hidden" name="_csrf" value="${token}">`)
    : body;
  for (const c of [ctx.csrfSetCookie].filter(Boolean)) headers.append('Set-Cookie', c);
  return new Response(stamped, { status, headers });
}

function json(data, status = 200) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(ctx, location, setCookie) {
  const headers = new Headers({ Location: location });
  for (const c of [setCookie, ctx.csrfSetCookie].filter(Boolean)) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

async function currentUser(ctx) {
  const token = parseCookies(ctx.request)[SESSION_COOKIE];
  if (!token) return null;
  const session = await ctx.dal.findSession(token);
  if (!session) return null;
  return ctx.dal.findUserById(session.userId);
}

function requireUser(ctx) {
  if (!ctx.user) return redirect(ctx, '/login');
  return null;
}

async function jobsNav(ctx) {
  return ctx.dal.listJobsWithCounts();
}

// ---------- job settings (General / Notifications / Job Boards / Application Form) ----------

const BOARD_KEYS = ['monster', 'jooble', 'careerjet', 'indeed', 'linkedin'];
const DEFAULT_BOARDS = { monster: true, jooble: true, careerjet: true, indeed: true, linkedin: false, linkedinPostedAt: null };
const FORM_FIELD_KEYS = ['firstName', 'lastName', 'email', 'linkedIn', 'phone', 'personalWebsite', 'education', 'workExperience', 'fileUpload'];
const DEFAULT_FIELD_RULES = {
  firstName: { visible: true, required: true },
  lastName: { visible: true, required: true },
  email: { visible: true, required: true },
  linkedIn: { visible: true, required: true },
  phone: { visible: false, required: false },
  personalWebsite: { visible: false, required: false },
  education: { visible: false, required: false },
  workExperience: { visible: false, required: false },
  fileUpload: { visible: false, required: false },
};

function parseBoards(job) {
  const saved = job && job.boards ? safeJson(job.boards, {}) : {};
  return { ...DEFAULT_BOARDS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

function parseFormConfig(job) {
  const saved = job && job.formConfig ? safeJson(job.formConfig, null) : null;
  const out = {};
  for (const k of FORM_FIELD_KEYS) {
    const d = DEFAULT_FIELD_RULES[k];
    const s = saved && saved[k] && typeof saved[k] === 'object' ? saved[k] : {};
    out[k] = {
      visible: typeof s.visible === 'boolean' ? s.visible : d.visible,
      required: typeof s.required === 'boolean' ? s.required : d.required,
    };
  }
  return out;
}

// LinkedIn posting simulation: toggling on for an ACTIVE job records the posting
// (timestamp + log). Real posting needs LinkedIn's partner Jobs API; the local
// flow here is complete and only that API call would change.
async function linkedinSet(ctx, job, on) {
  const b = parseBoards(job);
  const wasPosted = !!b.linkedinPostedAt;
  b.linkedin = !!on;
  if (on && job.status === 'active' && !b.linkedinPostedAt) b.linkedinPostedAt = new Date().toISOString();
  if (!on) b.linkedinPostedAt = null;
  await ctx.dal.updateJob(job.id, { boards: JSON.stringify(b) });
  if (on && !wasPosted && b.linkedinPostedAt) {
    await ctx.dal.insertOutbox({
      recipient: 'Daya Ventures LinkedIn page',
      subject: `[LinkedIn] Job published: ${job.title}`,
      body: `The job posting "${job.title}" was published to the Daya Ventures LinkedIn page (https://www.linkedin.com/company/daya-ventures-femtech/).`,
      note: 'Demo mode — LinkedIn post simulated, not sent to LinkedIn',
    });
  } else if (!on && wasPosted) {
    await ctx.dal.insertOutbox({
      recipient: 'Daya Ventures LinkedIn page',
      subject: `[LinkedIn] Job posting removed: ${job.title}`,
      body: `The LinkedIn posting for "${job.title}" was removed.`,
      note: 'Demo mode — LinkedIn post simulated, not sent to LinkedIn',
    });
  }
  return b;
}

const DEFAULT_STAGES = [
  { title: 'Applied', variant: 'application' },
  { title: 'Screening', variant: 'default' },
  { title: 'Interview', variant: 'default' },
  { title: 'Assessment', variant: 'default' },
  { title: 'Offer', variant: 'default' },
  { title: 'Rejected', variant: 'rejection' },
];

// ---------- routes ----------

const routes = {
  'GET /login': async (ctx) => html(ctx, views.loginPage({})),

  'POST /login': async (ctx) => {
    const f = await readForm(ctx);
    const user = await ctx.dal.findUserByEmail(String(f.email || '').trim());
    if (user) {
      const hash = await hashPassword(String(f.password || ''), user.salt);
      if (hexEquals(hash, user.passwordHash)) {
        const token = randomHex(24);
        await ctx.dal.createSession(token, user.id);
        return redirect(ctx, '/overview', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
      }
    }
    return html(ctx, views.loginPage({ error: 'Wrong email or password.', email: f.email }), 401);
  },

  'POST /logout': async (ctx) => {
    const token = parseCookies(ctx.request)[SESSION_COOKIE];
    if (token) await ctx.dal.deleteSession(token);
    return redirect(ctx, '/login', `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  },

  'GET /': async (ctx) => redirect(ctx, '/overview'),

  'GET /overview': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const jobs = await jobsNav(ctx);
    return html(ctx, views.overviewPage({ user: ctx.user, jobs, jobsNav: jobs, query: ctx.query }));
  },

  'GET /jobs/:id': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const job = await ctx.dal.findJob(Number(ctx.params.id));
    if (!job) return html(ctx, notFound(), 404);
    const [stages, apps, nav] = await Promise.all([
      ctx.dal.listStagesByJob(job.id),
      ctx.dal.listApplicationsByJob(job.id),
      jobsNav(ctx),
    ]);
    return html(ctx, views.kanbanPage({ user: ctx.user, jobs: nav, job, stages, apps, query: ctx.query }));
  },

  'GET /emails': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const [rows, nav] = await Promise.all([ctx.dal.listOutbox(200), jobsNav(ctx)]);
    return html(ctx, views.emailsPage({ user: ctx.user, rows, jobsNav: nav, query: ctx.query }));
  },

  // ---- Jobs list page ----
  'GET /jobs': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const all = await ctx.dal.listJobsWithCounts();
    const PAGE = 25;
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const pageCount = Math.max(1, Math.ceil(all.length / PAGE));
    const rows = all.slice((page - 1) * PAGE, page * PAGE);
    return html(ctx, views.jobsListPage({ user: ctx.user, jobsNav: all, rows, page, pageCount, query: ctx.query }));
  },

  // ---- Candidates list page ----
  'GET /candidates': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const nav = await jobsNav(ctx);
    const tags = await ctx.dal.listTags();
    const tagIds = String(ctx.query.get('tags') || '').split(',').map((s) => Number(s.trim())).filter(Boolean);
    const sort = ctx.query.get('sort') === 'name' ? 'name' : 'applied';
    const dir = ctx.query.get('dir') === 'asc' ? 'asc' : 'desc';
    const PAGE = 50;
    const page = Math.max(1, Number(ctx.query.get('page')) || 1);
    const [rows, total] = await Promise.all([
      ctx.dal.listCandidateRows({ offset: (page - 1) * PAGE, limit: PAGE, tagIds, sort, dir }),
      ctx.dal.countCandidateRows({ tagIds }),
    ]);
    const tagLinks = await ctx.dal.listTagsForCandidates([...new Set(rows.map((r) => r.candidateId))]);
    const tagsByCandidate = {};
    for (const tl of tagLinks) (tagsByCandidate[tl.candidateId] ||= []).push(tl.tagId);
    const pageCount = Math.max(1, Math.ceil(total / PAGE));
    return html(ctx, views.candidatesPage({
      user: ctx.user, jobsNav: nav, rows, page, pageCount, total,
      tags, selectedTagIds: tagIds, sort, dir, query: ctx.query, tagsByCandidate,
    }));
  },

  'GET /help': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const nav = await jobsNav(ctx);
    return html(ctx, views.helpPage({ user: ctx.user, jobsNav: nav, query: ctx.query }));
  },

  // ---- Careers page feature (editor + public pages) ----

  'GET /careers': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const [row, jobs] = await Promise.all([ctx.dal.getCareersPage(), ctx.dal.listActiveJobs()]);
    const config = row ? safeJson(row.config, null) : null;
    return html(ctx, careers.careersEditorPage({
      user: ctx.user,
      config: config || {
        backgroundColor: '#1f0021', textColor: '#fffdfe',
        sections: [
          { id: 's-hero', type: 'hero', data: { image: '', title: 'Daya Ventures', description: '', backgroundColor: '#1f0021', primaryTextColor: '#faf9f6', secondaryTextColor: '#faf9f6' } },
          { id: 's-positions', type: 'openPositions', data: { title: 'Open positions', description: '', backgroundColor: '#1f0021', textColor: '#fffdfe' } },
        ],
      },
      jobs,
    }));
  },

  'POST /api/careers/preview': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json().catch(() => ({}));
    const jobs = await ctx.dal.listActiveJobs();
    const doc = careers.renderCareersDoc(body, jobs, { preview: true });
    return new Response(doc, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },

  'POST /api/careers': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json().catch(() => ({}));
    const clean = careers.sanitizeConfig(body);
    await ctx.dal.saveCareersPage(JSON.stringify(clean));
    return json({ ok: true });
  },

  'GET /daya-ventures': async (ctx) => {
    const [row, jobs] = await Promise.all([ctx.dal.getCareersPage(), ctx.dal.listActiveJobs()]);
    const config = row ? safeJson(row.config, null) : null;
    const doc = careers.renderCareersDoc(config || {}, jobs);
    return html(ctx, doc);
  },

  'GET /daya-ventures/:id': async (ctx) => {
    const m = String(ctx.params.id || '').match(/^(\d+)/);
    const job = m ? await ctx.dal.findJob(Number(m[1])) : null;
    if (!job) return html(ctx, notFound(), 404);
    const row = await ctx.dal.getCareersPage();
    const config = row ? safeJson(row.config, null) : null;
    const questions = safeJson(job.questions, []);
    return html(ctx, careers.publicJobPage({
      config: config || {},
      job: { ...job, questions },
      formConfig: parseFormConfig(job),
      applied: ctx.query.get('applied') === '1',
      error: ctx.query.get('error') ? String(ctx.query.get('error')).slice(0, 200) : null,
    }));
  },

  'POST /daya-ventures/:id/apply': async (ctx) => {
    const m = String(ctx.params.id || '').match(/^(\d+)/);
    const job = m ? await ctx.dal.findJob(Number(m[1])) : null;
    if (!job) return html(ctx, notFound(), 404);
    const row = await ctx.dal.getCareersPage();
    const config = row ? safeJson(row.config, null) : null;
    const questions = safeJson(job.questions, []);
    let fields;
    try { fields = await readForm(ctx); }
    catch (e) { return redirect(ctx, `/daya-ventures/${job.id}?error=Session%20expired%20%E2%80%94%20please%20try%20again`); }
    const s = (k, n = 200) => String(fields[k] || '').trim().slice(0, n);
    const firstName = s('firstName', 100), lastName = s('lastName', 100);
    const email = s('email', 200), linkedIn = s('linkedIn', 300);
    const phone = s('phone', 100), personalWebsite = s('personalWebsite', 300);
    const education = s('education', 4000), workExperience = s('workExperience', 4000);
    const fileName = s('file', 300);
    const answers = questions.map((q, i) => s(`question${i + 1}`, 4000));
    const fc = parseFormConfig(job);
    const need = (k) => fc[k] && fc[k].visible && fc[k].required;
    let error = null;
    if (need('firstName') && !firstName) error = 'Please fill in your first name.';
    else if (need('lastName') && !lastName) error = 'Please fill in your last name.';
    else if (email && fc.email.visible && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) error = 'Please enter a valid email address.';
    else if (need('email') && !email) error = 'Please fill in your email.';
    else if (need('linkedIn') && !linkedIn) error = 'Please fill in your LinkedIn URL.';
    else if (need('phone') && !phone) error = 'Please fill in your phone number.';
    else if (need('personalWebsite') && !personalWebsite) error = 'Please fill in your personal website.';
    else if (need('education') && !education) error = 'Please fill in your education.';
    else if (need('workExperience') && !workExperience) error = 'Please fill in your work experience.';
    else if (need('fileUpload') && !fileName) error = 'Please attach a file.';
    else if (answers.some((a, i) => !a && (questions[i] && questions[i].required !== false))) error = 'Please answer all questions.';
    if (error) {
      return html(ctx, careers.publicJobPage({
        config: config || {}, job: { ...job, questions }, formConfig: fc, applied: false, error,
        values: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v).slice(0, 4000)])),
      }), 400);
    }
    // Link to an existing candidate (by email) or create one; then create the application.
    let candidate = await ctx.dal.findCandidateByEmail(email);
    if (!candidate) {
      const res = await ctx.dal.insertCandidate({ firstName, lastName, email, linkedIn: linkedIn || null });
      const newId = res && res.meta ? res.meta.last_row_id : null;
      candidate = newId ? { id: newId } : await ctx.dal.findCandidateByEmail(email);
    }
    const stages = await ctx.dal.listStagesByJob(job.id);
    const entry = stages.find((st) => st.variant === 'application') || stages[0];
    if (!entry) return redirect(ctx, `/daya-ventures/${job.id}?error=This%20job%20is%20not%20accepting%20applications`);
    const allApps = await ctx.dal.listApplicationsByJob(job.id);
    const maxSort = allApps.filter((a) => a.stageId === entry.id).reduce((max, a) => Math.max(max, a.sort || 0), -1);
    await ctx.dal.insertApplication({
      jobId: job.id, stageId: entry.id, candidateId: candidate ? candidate.id : null, sort: maxSort + 1,
      firstName, lastName, email, linkedIn: linkedIn || null,
      phone: phone || null, personalWebsite: personalWebsite || null,
      education: education || null, workExperience: workExperience || null,
      files: fileName ? JSON.stringify([fileName]) : null,
      originType: 'applied',
    });
    return redirect(ctx, `/daya-ventures/${job.id}?applied=1`);
  },

  'GET /careers-editor.js': async (ctx) => {
    return new Response(EDITOR_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } });
  },

  'GET /assets/daya-logo.png': async (ctx) => {
    const bytes = Uint8Array.from(atob(DAYA_LOGO_B64), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
  },

  // ---- board mutations (fetch POSTs, JSON) ----

  // Persist card drag: {applicationId, stageId, sort} — sort = final index within target column.
  'POST /api/move-card': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const appId = Number(body.applicationId), stageId = Number(body.stageId), sort = Number(body.sort) || 0;
    const app = await ctx.dal.findApplication(appId);
    const stage = (await ctx.dal.listStagesByJob(app.jobId)).find((s) => s.id === stageId);
    if (!app || !stage) return json({ ok: false, error: 'not found' }, 404);
    await ctx.dal.updateApplication(appId, { stageId, sort });
    if (app.stageId !== stageId) await ctx.dal.insertStageHistory(appId, stageId, sort);
    return json({ ok: true });
  },

  // Persist column reorder: {stages:[{id,sort},...]}
  'POST /api/reorder-stages': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const stages = Array.isArray(body.stages) ? body.stages : [];
    for (const s of stages) {
      await ctx.dal.updateStage(Number(s.id), { sort: Number(s.sort) || 0 });
    }
    return json({ ok: true });
  },

  'POST /api/stages': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const jobId = Number(body.jobId);
    const existing = await ctx.dal.listStagesByJob(jobId);
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) return json({ ok: false, error: 'Title required' }, 400);
    const maxSort = existing.reduce((m, s) => Math.max(m, s.sort), -1);
    await ctx.dal.insertStage({ jobId, title, variant: 'default', sort: maxSort + 1 });
    return json({ ok: true });
  },

  'POST /api/stages/:id/rename': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) return json({ ok: false, error: 'Title required' }, 400);
    await ctx.dal.updateStage(Number(ctx.params.id), { title });
    return json({ ok: true });
  },

  'POST /api/stages/:id/delete': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const id = Number(ctx.params.id);
    const body = await ctx.request.json().catch(() => ({}));
    // Find the stage across all jobs (stages are unique per job; cheap lookup).
    const jobs = await ctx.dal.listJobs();
    let stage = null;
    for (const j of jobs) {
      const ss = await ctx.dal.listStagesByJob(j.id);
      const hit = ss.find((s) => s.id === id);
      if (hit) { stage = hit; break; }
    }
    if (!stage) return json({ ok: false, error: 'not found' }, 404);
    if (stage.variant !== 'default') return json({ ok: false, error: 'This column is structural and cannot be deleted.' }, 400);
    const siblings = (await ctx.dal.listStagesByJob(stage.jobId)).filter((s) => s.id !== id);
    const moveTo = Number(body.moveToStageId) || (siblings[0] && siblings[0].id);
    if (!moveTo) return json({ ok: false, error: 'No other column to move cards to.' }, 400);
    const apps = await ctx.dal.listApplicationsByJob(stage.jobId);
    let i = 0;
    for (const a of apps) {
      if (a.stageId === id) { await ctx.dal.updateApplication(a.id, { stageId: moveTo, sort: 1000 + i }); i++; }
    }
    await ctx.dal.deleteStage(id);
    return json({ ok: true });
  },

  'POST /api/applications/:id/favorite': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const app = await ctx.dal.findApplication(Number(ctx.params.id));
    if (!app) return json({ ok: false }, 404);
    await ctx.dal.updateApplication(app.id, { isFavorite: app.isFavorite ? 0 : 1 });
    return json({ ok: true, isFavorite: app.isFavorite ? 0 : 1 });
  },

  'POST /api/applications/:id/reject': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const app = await ctx.dal.findApplication(Number(ctx.params.id));
    if (!app) return json({ ok: false }, 404);
    const stages = await ctx.dal.listStagesByJob(app.jobId);
    const rej = stages.find((s) => s.variant === 'rejection');
    if (!rej) return json({ ok: false, error: 'No Rejected column on this board' }, 400);
    await ctx.dal.updateApplication(app.id, { stageId: rej.id, sort: 0 });
    await ctx.dal.insertStageHistory(app.id, rej.id, 0);
    return json({ ok: true });
  },

  'POST /api/applications/:id/suggest-interview': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const app = await ctx.dal.findApplication(Number(ctx.params.id));
    if (!app) return json({ ok: false }, 404);
    const subject = String(body.subject || 'Interview invitation').slice(0, 200);
    const msg = String(body.body || '').slice(0, 8000);
    if (!msg.trim()) return json({ ok: false, error: 'Message required' }, 400);
    await ctx.dal.insertOutbox({ recipient: app.email, subject, body: msg, delivered: 0 });
    await ctx.dal.updateApplication(app.id, { interviewSuggested: 1 });
    return json({ ok: true });
  },

  'POST /api/applications/:id/move': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const app = await ctx.dal.findApplication(Number(ctx.params.id));
    if (!app) return json({ ok: false }, 404);
    const newJobId = Number(body.newJobId);
    const newStageId = Number(body.newStageId);
    const duplicate = !!body.shouldSaveDuplicate;
    const targetJob = await ctx.dal.findJob(newJobId);
    if (!targetJob) return json({ ok: false, error: 'Job not found' }, 404);
    const targetStages = await ctx.dal.listStagesByJob(newJobId);
    const stage = targetStages.find((s) => s.id === newStageId) || targetStages[0];
    if (!stage) return json({ ok: false, error: 'Target job has no columns' }, 400);
    if (duplicate) {
      await ctx.dal.insertApplication({ ...app, id: undefined, jobId: newJobId, stageId: stage.id, sort: 0 });
    } else {
      await ctx.dal.updateApplication(app.id, { jobId: newJobId, stageId: stage.id, sort: 0 });
      await ctx.dal.insertStageHistory(app.id, stage.id, 0);
    }
    return json({ ok: true });
  },

  'GET /api/jobs/:id/stages': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const stages = await ctx.dal.listStagesByJob(Number(ctx.params.id));
    return json({ ok: true, stages });
  },

  'GET /api/jobs': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const jobs = await ctx.dal.listJobs();
    return json({ ok: true, jobs: jobs.filter((j) => j.status === 'active') });
  },

  'POST /api/applications': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const jobId = Number(body.jobId);
    const stages = await ctx.dal.listStagesByJob(jobId);
    const entry = stages.find((s) => s.variant === 'application') || stages[0];
    if (!entry) return json({ ok: false, error: 'Job has no columns' }, 400);
    const firstName = String(body.firstName || '').trim().slice(0, 100);
    const lastName = String(body.lastName || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().slice(0, 200);
    // Append at the bottom of the entry column (same as Hirefly).
    const apps = await ctx.dal.listApplicationsByJob(jobId);
    const maxSort = apps.filter((a) => a.stageId === entry.id).reduce((m, a) => Math.max(m, a.sort || 0), -1);
    // Link to an existing candidate (by email) or create one.
    let candidate = email ? await ctx.dal.findCandidateByEmail(email) : null;
    if (!candidate) {
      const res = await ctx.dal.insertCandidate({ firstName, lastName, email, linkedIn: String(body.linkedIn || '').trim().slice(0, 300) || null });
      const newId = res && res.meta ? res.meta.last_row_id : null;
      candidate = newId ? { id: newId } : (email ? await ctx.dal.findCandidateByEmail(email) : null);
    }
    await ctx.dal.insertApplication({
      jobId, stageId: entry.id, sort: maxSort + 1, candidateId: candidate ? candidate.id : null,
      firstName, lastName, email,
      linkedIn: String(body.linkedIn || '').trim().slice(0, 300) || null,
      originType: 'sourced',
    });
    return json({ ok: true });
  },

  // ---- jobs ----
  'POST /api/jobs': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) return json({ ok: false, error: 'Job title is required' }, 400);
    const jobType = ['Full-Time', 'Part-Time', 'Hourly', 'Internship', 'Other'].includes(body.jobType) ? body.jobType : 'Other';
    const status = ['active', 'draft'].includes(body.status) ? body.status : 'draft';
    await ctx.dal.insertJob({ title, status, jobType, location: String(body.location || '').trim().slice(0, 200) || null });
    const job = (await ctx.dal.listJobsWithCounts()).find((j) => j.title === title && !j.nApps && j.jobType === jobType) ||
      (await ctx.dal.listJobsWithCounts()).slice(-1)[0];
    // Default stage template (same as Hirefly): Applied → Screening → Interview → Assessment → Offer → Rejected
    const TEMPLATE = [
      ['Applied', 'application'], ['Screening', 'default'], ['Interview', 'default'],
      ['Assessment', 'default'], ['Offer', 'default'], ['Rejected', 'rejection'],
    ];
    let i = 0;
    for (const [t, v] of TEMPLATE) { await ctx.dal.insertStage({ jobId: job.id, title: t, variant: v, sort: i }); i++; }
    return json({ ok: true, jobId: job.id });
  },

  'POST /api/jobs/:id/edit': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const id = Number(ctx.params.id);
    const job = await ctx.dal.findJob(id);
    if (!job) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const fields = {};
    if (typeof body.title === 'string' && body.title.trim()) fields.title = body.title.trim().slice(0, 200);
    if (['Full-Time', 'Part-Time', 'Hourly', 'Internship', 'Other'].includes(body.jobType)) fields.jobType = body.jobType;
    if (['active', 'draft', 'closed'].includes(body.status)) fields.status = body.status;
    if (typeof body.location === 'string') fields.location = body.location.trim().slice(0, 200) || null;
    await ctx.dal.updateJob(id, fields);
    return json({ ok: true });
  },

  'POST /api/jobs/:id/status': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const id = Number(ctx.params.id);
    const job = await ctx.dal.findJob(id);
    if (!job) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const status = ['active', 'draft', 'closed'].includes(body.status) ? body.status : null;
    if (!status) return json({ ok: false, error: 'invalid status' }, 400);
    await ctx.dal.updateJob(id, { status });
    // LinkedIn auto-publish: going live with the LinkedIn toggle on posts the job;
    // unpublish/close removes the posting.
    const job2 = await ctx.dal.findJob(id);
    const b = parseBoards(job2);
    if (b.linkedin) {
      if (status === 'active' && !b.linkedinPostedAt) await linkedinSet(ctx, job2, true);
      else if (status !== 'active' && b.linkedinPostedAt) {
        b.linkedinPostedAt = null;
        await ctx.dal.updateJob(id, { boards: JSON.stringify(b) });
        await ctx.dal.insertOutbox({
          recipient: 'Daya Ventures LinkedIn page',
          subject: `[LinkedIn] Job posting removed: ${job2.title}`,
          body: `The LinkedIn posting for "${job2.title}" was removed (job ${status}).`,
          note: 'Demo mode — LinkedIn post simulated, not sent to LinkedIn',
        });
      }
    }
    return json({ ok: true, status });
  },

  // ---- job settings (modal: General / Notifications / Job Boards / Application Form) ----

  'GET /api/jobs/:id/settings': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const job = await ctx.dal.findJob(Number(ctx.params.id));
    if (!job) return json({ ok: false, error: 'not found' }, 404);
    const users = await ctx.dal.listUsers();
    return json({
      ok: true,
      job: { id: job.id, title: job.title, status: job.status, jobType: job.jobType, salary: job.salary || '', subtitle: job.subtitle || '', state: job.state || '', city: job.city || '', location: job.location || '' },
      boards: parseBoards(job),
      formConfig: parseFormConfig(job),
      users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, notifPref: u.notifPref || 'off' })),
    });
  },

  'POST /api/jobs/:id/settings': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const id = Number(ctx.params.id);
    const job = await ctx.dal.findJob(id);
    if (!job) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const fields = {};
    if (typeof body.title === 'string' && body.title.trim()) fields.title = body.title.trim().slice(0, 200);
    if (['Full-Time', 'Part-Time', 'Hourly', 'Internship', 'Other'].includes(body.jobType)) fields.jobType = body.jobType;
    if (typeof body.salary === 'string') fields.salary = body.salary.trim().slice(0, 120) || null;
    if (typeof body.subtitle === 'string') fields.subtitle = body.subtitle.trim().slice(0, 300) || null;
    if (typeof body.state === 'string') fields.state = body.state.trim().slice(0, 120) || null;
    if (typeof body.city === 'string') fields.city = body.city.trim().slice(0, 120) || null;
    if (typeof body.location === 'string') fields.location = body.location.trim().slice(0, 200) || null;
    if (!fields.title) delete fields.title;
    await ctx.dal.updateJob(id, fields);
    return json({ ok: true });
  },

  'POST /api/jobs/:id/boards': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const job = await ctx.dal.findJob(Number(ctx.params.id));
    if (!job) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const key = String(body.key || '');
    if (!BOARD_KEYS.includes(key)) return json({ ok: false, error: 'unknown board' }, 400);
    const value = !!body.value;
    if (key === 'linkedin') {
      const b = await linkedinSet(ctx, job, value);
      return json({ ok: true, boards: b, posted: !!b.linkedinPostedAt });
    }
    const b = parseBoards(job);
    b[key] = value;
    await ctx.dal.updateJob(job.id, { boards: JSON.stringify(b) });
    return json({ ok: true, boards: b, posted: !!b.linkedinPostedAt });
  },

  'POST /api/jobs/:id/form-config': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const job = await ctx.dal.findJob(Number(ctx.params.id));
    if (!job) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const incoming = body && body.fields && typeof body.fields === 'object' ? body.fields : {};
    const out = {};
    for (const k of FORM_FIELD_KEYS) {
      const s = incoming[k] && typeof incoming[k] === 'object' ? incoming[k] : {};
      const visible = !!s.visible;
      out[k] = { visible, required: visible ? !!s.required : false };
    }
    await ctx.dal.updateJob(job.id, { formConfig: JSON.stringify(out) });
    return json({ ok: true, formConfig: out });
  },

  'POST /api/users/:id/notif-pref': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const user = await ctx.dal.findUserById(Number(ctx.params.id));
    if (!user) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const pref = ['off', 'daily'].includes(body.pref) ? body.pref : null;
    if (!pref) return json({ ok: false, error: 'invalid preference' }, 400);
    await ctx.dal.updateUser(user.id, { notifPref: pref });
    return json({ ok: true, pref });
  },

  // ---- tags ----
  'GET /api/tags': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    return json({ ok: true, tags: await ctx.dal.listTags() });
  },

  'POST /api/tags': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const body = await ctx.request.json();
    const title = String(body.title || '').trim().slice(0, 120);
    if (!title) return json({ ok: false, error: 'Tag name required' }, 400);
    await ctx.dal.insertTag(title);
    return json({ ok: true, tags: await ctx.dal.listTags() });
  },

  'POST /api/candidates/:id/tags': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const candidateId = Number(ctx.params.id);
    const candidate = await ctx.dal.findCandidate(candidateId);
    if (!candidate) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    if (body.createTitle) {
      await ctx.dal.insertTag(String(body.createTitle));
      const t = (await ctx.dal.listTags()).find((x) => x.title === String(body.createTitle).trim());
      if (t) await ctx.dal.setCandidateTag(candidateId, t.id, true);
      return json({ ok: true, tags: await ctx.dal.listTags() });
    }
    const tagId = Number(body.tagId);
    if (!tagId) return json({ ok: false, error: 'tagId required' }, 400);
    await ctx.dal.setCandidateTag(candidateId, tagId, !!body.isAdd);
    return json({ ok: true });
  },

  'POST /api/candidates/:id/edit': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const candidateId = Number(ctx.params.id);
    const candidate = await ctx.dal.findCandidate(candidateId);
    if (!candidate) return json({ ok: false, error: 'not found' }, 404);
    const body = await ctx.request.json();
    const firstName = String(body.firstName || '').trim().slice(0, 100);
    const lastName = String(body.lastName || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().slice(0, 200);
    if (!firstName || !lastName || !email) return json({ ok: false, error: 'First name, last name and email are required' }, 400);
    await ctx.dal.updateCandidate(candidateId, { firstName, lastName, email });
    // Keep the denormalised copies on applications in sync (boards show these).
    const all = await ctx.dal.listApplicationRowsForCandidates();
    for (const r of all) {
      if (r.candidateId === candidateId) await ctx.dal.updateApplication(r.appId, { firstName, lastName, email });
    }
    return json({ ok: true });
  },

  'POST /api/candidates/:id/remove': async (ctx) => {
    const guard = requireUser(ctx); if (guard) return guard;
    const candidateId = Number(ctx.params.id);
    const candidate = await ctx.dal.findCandidate(candidateId);
    if (!candidate) return json({ ok: false, error: 'not found' }, 404);
    const all = await ctx.dal.listApplicationRowsForCandidates();
    for (const r of all) {
      if (r.candidateId === candidateId) {
        await ctx.dal.deleteStageHistoryForApplication(r.appId);
        await ctx.dal.deleteApplication(r.appId);
      }
    }
    await ctx.dal.deleteCandidateTagRows(candidateId);
    await ctx.dal.deleteCandidate(candidateId);
    return json({ ok: true });
  },
};

function notFound() {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px"><h1>Not found</h1><p><a href="/overview">Back to overview</a></p></body></html>`;
}

// ---------- client JS (drag & drop + dialogs + menus) ----------

const CLIENT_JS = `
(function(){
  var board = document.getElementById('board');
  var jobId = board ? Number(board.dataset.job) : 0;
  var dlgRoot = document.getElementById('dlg-root');
  var dragEl = null, dragType = null, hoverCol = null;

  function api(path, data){
    return fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data||{})})
      .then(function(r){ return r.json(); })
      .then(function(res){ if(!res.ok) throw new Error(res.error||'Failed'); return res; })
      .catch(function(e){ alert(e.message||'Something went wrong'); location.reload(); throw e; });
  }

  // ---------- card drag ----------
  document.querySelectorAll('.card2[draggable]').forEach(function(card){
    card.addEventListener('dragstart', function(e){
      dragEl = card; dragType = 'card';
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', card.dataset.app); } catch(_){}
    });
    card.addEventListener('dragend', function(){
      card.classList.remove('dragging');
      document.querySelectorAll('.col').forEach(function(c){ c.style.boxShadow=''; });
      dragEl = null;
    });
  });

  document.querySelectorAll('.col').forEach(function(col){
    var dropZone = col.querySelector('.col-cards');
    col.addEventListener('dragover', function(e){
      if (!dragEl) return;
      e.preventDefault();
      col.style.boxShadow = '0 0 0 2px var(--brand)';
    });
    col.addEventListener('dragleave', function(){ col.style.boxShadow=''; });
    col.addEventListener('drop', function(e){
      if (!dragEl || dragType !== 'card') return;
      e.preventDefault();
      col.style.boxShadow='';
      var stageId = Number(col.dataset.stage);
      var target = col.querySelector('.col-cards');
      // insert at position based on mouse Y among existing cards
      var cards = Array.prototype.slice.call(target.querySelectorAll('.card2[draggable]'));
      var after = null;
      for (var i=0;i<cards.length;i++){
        if (cards[i] === dragEl) continue;
        var r = cards[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height/2){ after = cards[i]; break; }
      }
      if (after) target.insertBefore(dragEl, after); else target.appendChild(dragEl);
      var sort = Array.prototype.indexOf.call(target.querySelectorAll('.card2[draggable]'), dragEl);
      api('/api/move-card', {applicationId: Number(dragEl.dataset.app), stageId: stageId, sort: sort});
      updateCounts();
    });
  });

  // ---------- column drag ----------
  document.querySelectorAll('.grip[data-grip]').forEach(function(grip){
    grip.addEventListener('dragstart', function(e){
      var col = grip.closest('.col');
      dragEl = col; dragType = 'col';
      col.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'col:'+col.dataset.stage); } catch(_){}
    });
    grip.addEventListener('dragend', function(){
      if (dragType==='col' && dragEl) dragEl.classList.remove('dragging');
      dragEl = null; dragType = null;
    });
  });
  board && board.addEventListener('dragover', function(e){
    if (dragType !== 'col' || !dragEl) return;
    e.preventDefault();
    var cols = Array.prototype.slice.call(board.querySelectorAll('.col'));
    var after = null;
    for (var i=0;i<cols.length;i++){
      if (cols[i]===dragEl) continue;
      var r = cols[i].getBoundingClientRect();
      if (e.clientX < r.left + r.width/2){ after = cols[i]; break; }
    }
    if (after) board.insertBefore(dragEl, after); else board.insertBefore(dragEl, board.querySelector('.col-add'));
  });
  board && board.addEventListener('drop', function(e){
    if (dragType !== 'col' || !dragEl) return;
    e.preventDefault();
    var cols = Array.prototype.slice.call(board.querySelectorAll('.col'));
    var stages = cols.map(function(c,i){ return {id: Number(c.dataset.stage), sort: i}; });
    api('/api/reorder-stages', {stages: stages});
  });

  function updateCounts(){
    document.querySelectorAll('.col').forEach(function(col){
      var n = col.querySelectorAll('.col-cards .card2[draggable]').length;
      var el = col.querySelector('.col-count');
      if (el) el.textContent = n;
    });
  }

  // ---------- menus ----------
  function closeMenus(){ document.querySelectorAll('.menu2').forEach(function(m){ m.remove(); }); }
  document.addEventListener('click', function(e){
    if (!e.target.closest('.menu2')) closeMenus();
  });

  function openMenu(anchor, items){
    closeMenus();
    var m = document.createElement('div');
    m.className = 'menu2';
    items.forEach(function(it, idx){
      if (it === '-') { var s=document.createElement('div'); s.className='sep'; m.appendChild(s); return; }
      var b = document.createElement('button');
      b.textContent = it.label;
      if (it.danger) b.className = 'danger';
      b.addEventListener('click', function(ev){ ev.stopPropagation(); closeMenus(); it.fn(); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 4 + window.scrollY, window.innerHeight - 10 - m.offsetHeight + window.scrollY) + 'px';
    m.style.left = Math.max(8, r.right - m.offsetWidth + window.scrollX) + 'px';
  }

  document.addEventListener('click', function(e){
    var appBtn = e.target.closest('[data-appmenu]');
    if (appBtn){
      e.stopPropagation();
      var card = appBtn.closest('.card2');
      var appId = Number(card.dataset.app);
      openMenu(appBtn, [
        {label:'Move', fn:function(){ openMoveDialog(appId); }},
        {label:'Suggest interview', fn:function(){ openInterviewDialog(appId); }},
        {label:'⭐ Toggle favourite', fn:function(){
          api('/api/applications/'+appId+'/favorite').then(function(res){
            var s = card.querySelector('.card-name .star, .card-name span[title="Favourite"]');
            if (res.isFavorite){
              if (!s){ var st=document.createElement('span'); st.title='Favourite'; st.style.color='#d97706'; st.textContent='★'; card.querySelector('.card-name').appendChild(st); }
            } else if (s){ s.remove(); }
          });
        }},
        '-',
        {label:'Reject', danger:true, fn:function(){
          api('/api/applications/'+appId+'/reject').then(function(){ location.reload(); });
        }}
      ]);
      return;
    }
    var colBtn = e.target.closest('[data-colmenu]');
    if (colBtn){
      e.stopPropagation();
      var col = colBtn.closest('.col');
      var stageId = Number(col.dataset.stage);
      var variant = col.dataset.variant;
      var title = col.querySelector('.col-title').textContent;
      var items = [{label:'Edit', fn:function(){ openEditColumnDialog(stageId, title); }}];
      if (variant === 'default'){
        items.push('-');
        items.push({label:'Delete', danger:true, fn:function(){ openDeleteColumnDialog(stageId, title); }});
      }
      openMenu(colBtn, items);
    }
  });

  // ---------- dialogs ----------
  function closeDlg(){ dlgRoot.innerHTML=''; }
  function dialog(titleText, subText, innerHtml, footHtml, wide){
    dlgRoot.innerHTML = '<div class="dlg-back"><div class="dlg'+(wide?' wide':'')+'">'
      + '<h2>'+titleText+'</h2><p class="sub">'+(subText||'')+'</p>'
      + innerHtml
      + '<div class="foot">'+footHtml+'</div></div></div>';
    dlgRoot.querySelector('.dlg-back').addEventListener('click', function(e){ if (e.target===this) closeDlg(); });
    return dlgRoot;
  }

  // Add Column / Edit Column
  function openAddColumnDialog(){
    dialog('Add New Column', 'Create a new column for your kanban board.',
      '<label>Column name</label><input type="text" id="colname" placeholder="Column name">',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-save">Add Column</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-save').onclick = function(){
      var t = dlgRoot.querySelector('#colname').value.trim();
      if (!t) return;
      api('/api/stages', {jobId: jobId, title: t}).then(function(){ location.reload(); });
    };
    dlgRoot.querySelector('#colname').focus();
  }
  function openEditColumnDialog(stageId, current){
    dialog('Edit Column', 'Change the name of this column.',
      '<label>Column name</label><input type="text" id="colname" value="'+escAttr(current)+'">',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-save">Save Changes</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-save').onclick = function(){
      var t = dlgRoot.querySelector('#colname').value.trim();
      if (!t) return;
      api('/api/stages/'+stageId+'/rename', {title: t}).then(function(){ location.reload(); });
    };
    var inp = dlgRoot.querySelector('#colname'); inp.focus(); inp.select();
  }
  function openDeleteColumnDialog(stageId, current){
    var others = Array.prototype.slice.call(document.querySelectorAll('.col'))
      .filter(function(c){ return Number(c.dataset.stage)!==stageId; })
      .map(function(c){ return Number(c.dataset.stage); });
    var opts = '';
    document.querySelectorAll('.col').forEach(function(c){
      if (Number(c.dataset.stage)!==stageId)
        opts += '<option value="'+c.dataset.stage+'">'+escHtml(c.querySelector('.col-title').textContent)+'</option>';
    });
    var inner = '<label>This column contains applications. Where would you like to move them?</label>'
      + '<select id="moveto">'+opts+'</select>';
    dialog('Delete Column', 'Are you sure you want to delete the "'+escHtml(current)+'" column? This action cannot be undone.',
      inner, '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-del" style="color:var(--danger)">Delete</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-del').onclick = function(){
      api('/api/stages/'+stageId+'/delete', {moveToStageId: Number(dlgRoot.querySelector('#moveto').value)})
        .then(function(){ location.reload(); });
    };
  }

  // Add candidate
  function openAddCandidateDialog(){
    dialog('Add Candidate', 'The candidate is added to the first column (Applied).',
      '<div style="display:flex;gap:10px"><div style="flex:1"><label>First name</label><input type="text" id="c-first"></div>'
      +'<div style="flex:1"><label>Last name</label><input type="text" id="c-last"></div></div>'
      +'<label>Email</label><input type="email" id="c-email">'
      +'<label>LinkedIn (optional)</label><input type="url" id="c-li" placeholder="https://linkedin.com/in/…">',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-save">Add Candidate</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-save').onclick = function(){
      api('/api/applications', {
        jobId: jobId,
        firstName: dlgRoot.querySelector('#c-first').value,
        lastName: dlgRoot.querySelector('#c-last').value,
        email: dlgRoot.querySelector('#c-email').value,
        linkedIn: dlgRoot.querySelector('#c-li').value
      }).then(function(){ location.reload(); });
    };
  }

  // Move applicant
  function openMoveDialog(appId){
    fetch('/api/jobs').then(function(r){return r.json();}).then(function(res){
      var jobs = (res.jobs||[]).filter(function(j){ return j.id !== jobId; });
      if (!jobs.length){ dialog('Move applicant', 'There are no other active jobs to move this applicant to.', '', '<button class="btn" id="dlg-cancel">Close</button>'); dlgRoot.querySelector('#dlg-cancel').onclick=closeDlg; return; }
      var opts = jobs.map(function(j){ return '<option value="'+j.id+'">'+escHtml(j.title)+'</option>'; }).join('');
      dialog('Move applicant', 'Choose a destination job and hiring stage.',
        '<label>Job</label><select id="mv-job">'+opts+'</select>'
        +'<label>Hiring stage</label><select id="mv-stage"><option>Loading…</option></select>'
        +'<div style="display:flex;gap:8px;align-items:center;margin-top:14px"><input type="checkbox" id="mv-dup" style="width:auto">'
        +'<label for="mv-dup" style="margin:0;font-weight:500">Save as duplicate (keep on this board too)</label></div>',
        '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-go">Move</button>');
      dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
      function loadStages(){
        var jid = Number(dlgRoot.querySelector('#mv-job').value);
        fetch('/api/jobs/'+jid+'/stages').then(function(r){return r.json();}).then(function(rs){
          var sopts = (rs.stages||[]).map(function(s){ return '<option value="'+s.id+'">'+escHtml(s.title)+'</option>'; }).join('');
          dlgRoot.querySelector('#mv-stage').innerHTML = sopts;
        });
      }
      dlgRoot.querySelector('#mv-job').addEventListener('change', loadStages);
      loadStages();
      dlgRoot.querySelector('#dlg-go').onclick = function(){
        api('/api/applications/'+appId+'/move', {
          newJobId: Number(dlgRoot.querySelector('#mv-job').value),
          newStageId: Number(dlgRoot.querySelector('#mv-stage').value),
          shouldSaveDuplicate: dlgRoot.querySelector('#mv-dup').checked
        }).then(function(){ location.reload(); });
      };
    });
  }

  // Suggest interview
  function openInterviewDialog(appId){
    var name = '';
    var card = document.querySelector('.card2[data-app="'+appId+'"]');
    if (card) name = card.querySelector('.card-name').textContent.trim();
    dialog('Suggest Interview', 'Send an interview scheduling suggestion to the candidate. You can edit the email before sending.',
      '<label>Subject</label><input type="text" id="iv-subject" value="Interview invitation — Daya Ventures">'
      +'<label>Message</label><textarea id="iv-body">Hi '+escHtml(name.split(' ')[0]||'there')+','

      +'\\n\\nThank you for your application — we were impressed by your profile and would like to invite you to a first interview.\\n\\nCould you share a few time slots that work for you over the next week? We suggest a 45-minute video call.\\n\\nLooking forward to speaking with you.\\n\\nBest regards,\\nDaya Ventures</textarea>',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-send">Send Email</button>', true);
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-send').onclick = function(){
      api('/api/applications/'+appId+'/suggest-interview', {
        subject: dlgRoot.querySelector('#iv-subject').value,
        body: dlgRoot.querySelector('#iv-body').value
      }).then(function(){ alert('Interview suggestion recorded in the Email log.'); location.reload(); });
    };
  }

  function escHtml(s){ var d=document.createElement('div'); d.textContent=s==null?'':String(s); return d.innerHTML; }
  function escAttr(s){ return escHtml(s).replace(/"/g,'&quot;'); }

  document.addEventListener('click', function(e){
    var t = e.target.closest('[data-opendialog]');
    if (!t) return;
    var which = t.dataset.opendialog;
    if (which==='add-column') openAddColumnDialog();
    if (which==='add-candidate') openAddCandidateDialog();
    if (which==='add-job') openJobDialog(null);
  });

  // ===================== Jobs page =====================
  var JOB_TYPES = ['Full-Time','Part-Time','Hourly','Internship','Other'];

  function openJobDialog(row){
    var isEdit = !!row;
    var title = isEdit ? row.dataset.title : '';
    var status = isEdit ? row.dataset.status : 'active';
    var jtype = isEdit ? row.dataset.jtype : 'Other';
    var loc = isEdit ? (row.dataset.location || '') : '';
    var typeOpts = JOB_TYPES.map(function(t){ return '<option'+(t===jtype?' selected':'')+'>'+t+'</option>'; }).join('');
    var statusOpts = ['active','draft','closed'].map(function(s){ return '<option value="'+s+'"'+(s===status?' selected':'')+'>'+(s==='active'?'Active':s==='draft'?'Draft':'Closed')+'</option>'; }).join('');
    dialog(isEdit ? 'Edit job' : 'Create job', isEdit ? 'Update the job post details.' : 'Create a new job and its board. The board starts with Applied → Screening → Interview → Assessment → Offer → Rejected.',
      '<label>Job title</label><input type="text" id="j-title" value="'+escAttr(title)+'">'
      +'<label>Job type</label><select id="j-type">'+typeOpts+'</select>'
      +'<label>Status</label><select id="j-status">'+statusOpts+'</select>'
      +'<label>Location (optional)</label><input type="text" id="j-loc" value="'+escAttr(loc)+'" placeholder="e.g. Stockholm · Hybrid">',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-save">'+(isEdit?'Save':'Add job')+'</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-save').onclick = function(){
      var payload = {
        title: dlgRoot.querySelector('#j-title').value.trim(),
        jobType: dlgRoot.querySelector('#j-type').value,
        status: dlgRoot.querySelector('#j-status').value,
        location: dlgRoot.querySelector('#j-loc').value
      };
      if (!payload.title){ alert('Job title is required'); return; }
      var path = isEdit ? '/api/jobs/'+row.dataset.jobrow+'/edit' : '/api/jobs';
      api(path, payload).then(function(res){
        if (!isEdit && res.jobId){ location.href = '/jobs/'+res.jobId; }
        else location.reload();
      });
    };
    dlgRoot.querySelector('#j-title').focus();
  }

  document.addEventListener('click', function(e){
    var btn = e.target.closest('[data-jobmenu]');
    if (!btn) return;
    e.stopPropagation();
    var id = btn.dataset.jobmenu;
    var row = btn.closest('tr');
    var st = row.dataset.status;
    var items = [
      {label:'Open board', fn:function(){ location.href = '/jobs/'+id; }},
      {label: st === 'draft' ? 'Create job post' : 'Edit job post', fn:function(){ openJobDialog(row); }},
      '-',
      {label:'Close job', fn:function(){ api('/api/jobs/'+id+'/status', {status:'closed'}).then(function(){ location.reload(); }); }},
      st === 'active'
        ? {label:'Unpublish job', fn:function(){ api('/api/jobs/'+id+'/status', {status:'draft'}).then(function(){ location.reload(); }); }}
        : {label:'Publish job', fn:function(){ api('/api/jobs/'+id+'/status', {status:'active'}).then(function(){ location.reload(); }); }}
    ];
    openMenu(btn, items);
  });

  // ===================== Candidates page =====================
  function candQ(){
    var q = new URLSearchParams(location.search);
    var tags = (window.__selTags||[]).join(',');
    if (tags) q.set('tags', tags); else q.delete('tags');
    if (window.__sort) q.set('sort', window.__sort);
    if (window.__dir) q.set('dir', window.__dir);
    q.delete('page');
    return q;
  }
  function applyTagFilter(tagIds){
    var q = new URLSearchParams(location.search);
    if (tagIds.length) q.set('tags', tagIds.join(',')); else q.delete('tags');
    q.delete('page');
    location.href = '/candidates' + (q.toString() ? '?'+q.toString() : '');
  }

  // Sortable headers
  Array.prototype.forEach.call(document.querySelectorAll('th.sortable'), function(th){
    th.addEventListener('click', function(){
      var col = th.dataset.sort;
      var q = new URLSearchParams(location.search);
      var curSort = q.get('sort') || 'applied', curDir = q.get('dir') || 'desc';
      var dir = (curSort === col && curDir === 'desc') ? 'asc' : 'desc';
      q.set('sort', col); q.set('dir', dir); q.delete('page');
      location.href = '/candidates?' + q.toString();
    });
  });

  // Filter popover
  var filterChip = document.getElementById('filter-chip');
  if (filterChip){
    var pop = null;
    function renderPop(){
      var sel = window.__selTags || [];
      var html = '<div class="menu2" style="position:absolute;min-width:280px;padding:8px">'
        + '<div class="relative"><input type="text" id="tag-search" placeholder="Search or create" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13.5px"></div>'
        + '<div class="sep"></div>'
        + '<div class="taglist" id="taglist">'
        + (window.__tags||[]).map(function(t){
            var checked = sel.indexOf(t.id) >= 0;
            return '<div class="tagrow" data-tag="'+t.id+'"><input type="checkbox" '+(checked?'checked':'')+'><span>'+escHtml(t.title)+'</span></div>';
          }).join('')
        + '</div></div>';
      var r = filterChip.getBoundingClientRect();
      var div = document.createElement('div');
      div.innerHTML = html;
      var node = div.firstChild;
      node.style.position = 'absolute';
      node.style.top = (r.bottom + 6 + window.scrollY) + 'px';
      node.style.left = (r.left + window.scrollX) + 'px';
      document.body.appendChild(node);
      pop = node;
      node.addEventListener('click', function(ev){ ev.stopPropagation(); });
      node.querySelectorAll('.tagrow').forEach(function(row){
        row.addEventListener('click', function(){
          var id = Number(row.dataset.tag);
          var sel2 = (window.__selTags||[]).slice();
          var i = sel2.indexOf(id);
          if (i >= 0) sel2.splice(i,1); else sel2.push(id);
          applyTagFilter(sel2);
        });
      });
      var input = node.querySelector('#tag-search');
      input.focus();
      input.addEventListener('keydown', function(ev){
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        var v = input.value.trim();
        if (!v) return;
        fetch('/api/tags', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({title: v})})
          .then(function(r){ return r.json(); })
          .then(function(res){
            if (!res.ok) throw new Error(res.error||'Failed');
            var t = (res.tags||[]).find(function(x){ return x.title === v; });
            if (t){ window.__tags = res.tags; applyTagFilter((window.__selTags||[]).concat([t.id])); }
          })
          .catch(function(err){ alert(err.message||'Failed to create tag'); });
      });
    }
    filterChip.addEventListener('click', function(e){
      e.stopPropagation();
      if (pop){ pop.remove(); pop = null; return; }
      renderPop();
    });
    document.addEventListener('click', function(){ if (pop){ pop.remove(); pop = null; } });
  }

  // Candidate row menu
  document.addEventListener('click', function(e){
    var btn = e.target.closest('[data-candmenu]');
    if (!btn) return;
    e.stopPropagation();
    var row = btn.closest('tr');
    var id = btn.dataset.candmenu;
    openMenu(btn, [
      {label:'Edit', fn:function(){ openEditCandidateDialog(row, id); }},
      {label:'Tags', fn:function(){ openTagsDialog(row, id); }},
      '-',
      {label:'Remove', danger:true, fn:function(){ openRemoveCandidateDialog(row, id); }}
    ]);
  });

  function openEditCandidateDialog(row, id){
    dialog('Edit Candidate', 'Update the candidate profile.',
      '<label>First name</label><input type="text" id="c-first" value="'+escAttr(row.dataset.first)+'">'
      +'<label>Last name</label><input type="text" id="c-last" value="'+escAttr(row.dataset.last)+'">'
      +'<label>Email</label><input type="email" id="c-email" value="'+escAttr(row.dataset.email)+'">',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-save">Save</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-save').onclick = function(){
      api('/api/candidates/'+id+'/edit', {
        firstName: dlgRoot.querySelector('#c-first').value,
        lastName: dlgRoot.querySelector('#c-last').value,
        email: dlgRoot.querySelector('#c-email').value
      }).then(function(){ location.reload(); });
    };
  }

  function openTagsDialog(row, id){
    var sel = (row.dataset.tags||'').split(',').filter(Boolean).map(Number);
    var html = '<div class="taglist">'
      + (window.__tags||[]).map(function(t){
          var checked = sel.indexOf(t.id) >= 0;
          return '<label class="tagrow"><input type="checkbox" data-tag="'+t.id+'" '+(checked?'checked':'')+'><span>'+escHtml(t.title)+'</span></label>';
        }).join('')
      + '</div>'
      + '<label style="margin-top:12px">Create a tag</label>'
      + '<input type="text" id="new-tag" placeholder="Type a name and press Enter">';
    dialog('Tags', 'Select the tags for this candidate.', html,
      '<button class="btn" id="dlg-cancel">Close</button>', true);
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelectorAll('.tagrow input[data-tag]').forEach(function(cb){
      cb.addEventListener('change', function(){
        api('/api/candidates/'+id+'/tags', {tagId: Number(cb.dataset.tag), isAdd: cb.checked});
      });
    });
    var nt = dlgRoot.querySelector('#new-tag');
    nt.addEventListener('keydown', function(ev){
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      var v = nt.value.trim();
      if (!v) return;
      api('/api/candidates/'+id+'/tags', {createTitle: v}).then(function(res){
        window.__tags = res.tags || window.__tags;
        // refresh checkboxes
        closeDlg(); openTagsDialog(row, id);
      });
    });
  }

  function openRemoveCandidateDialog(row, id){
    var name = (row.dataset.first + ' ' + row.dataset.last).trim();
    dialog('Remove Candidate', 'Are you sure you want to remove this candidate? This will also remove their applications from all boards.',
      '<p class="hint" style="margin:0"><strong>'+escHtml(name)+'</strong>'+(row.dataset.email?' · '+escHtml(row.dataset.email):'')+'</p>',
      '<button class="btn" id="dlg-cancel">Cancel</button><button class="btn btn-primary" id="dlg-del" style="color:#fff;background:var(--danger)">Remove Candidate</button>');
    dlgRoot.querySelector('#dlg-cancel').onclick = closeDlg;
    dlgRoot.querySelector('#dlg-del').onclick = function(){
      api('/api/candidates/'+id+'/remove', {}).then(function(){ location.reload(); });
    };
  }

  // ===================== Job options + Job settings modal =====================
  function toast(msg, ok){
    var el = document.getElementById('app-toast');
    if (!el){ el = document.createElement('div'); el.id = 'app-toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.innerHTML = '<span class="tk">' + (ok === false ? '!' : '&#10003;') + '</span><span>' + escHtml(msg) + '</span>';
    el.classList.add('show');
    clearTimeout(el.__t);
    el.__t = setTimeout(function(){ el.classList.remove('show'); }, 2400);
  }

  var JSM_ICONS = {
    gear: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    bell: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    share: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    form: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>',
  };
  var JSM_FIELDS = [
    ['firstName', 'First Name'], ['lastName', 'Last Name'], ['email', 'Email'], ['linkedIn', 'LinkedIn URL'],
    ['phone', 'Phone'], ['personalWebsite', 'Personal Website'], ['education', 'Education'],
    ['workExperience', 'Work Experience'], ['fileUpload', 'File Upload'],
  ];
  var JSM_BOARDS = [
    ['monster', 'Monster'], ['jooble', 'Jooble'], ['careerjet', 'Careerjet'], ['indeed', 'Indeed'], ['linkedin', 'LinkedIn'],
  ];
  var LI_PAGE = 'https://www.linkedin.com/company/daya-ventures-femtech/';
  var ORG_LOCATIONS = ['Headquartered in Göteborg. Built to scale globally.'];

  function fmtLiDate(iso){
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return m[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
  }

  var JSM = { data: null, tab: 'general', jobId: 0 };

  function closeJsm(){
    var o = document.getElementById('jsm-overlay');
    if (o) o.remove();
  }

  function openJobSettings(jobId){
    fetch('/api/jobs/' + jobId + '/settings').then(function(r){ return r.json(); }).then(function(res){
      if (!res || !res.ok || !res.job){ toast('Could not load job settings', false); return; }
      JSM.data = res;
      JSM.jobId = jobId;
      JSM.tab = 'general';
      renderJsm();
    }).catch(function(){ toast('Could not load job settings', false); });
  }

  function renderJsm(){
    closeJsm();
    var ov = document.createElement('div');
    ov.className = 'jsm-overlay';
    ov.id = 'jsm-overlay';
    ov.addEventListener('click', function(e){ if (e.target === ov) closeJsm(); });
    var tabs = [['general','General','gear'], ['notifications','Notifications','bell'], ['boards','Job Boards','share'], ['form','Application Form','form']]
      .map(function(t){
        return '<button class="jsm-tab" data-tab="' + t[0] + '">' + JSM_ICONS[t[2]] + '<span>' + t[1] + '</span></button>';
      }).join('');
    ov.innerHTML = '<div class="jsm"><button class="jsm-x" title="Close">&#10005;</button>'
      + '<div class="jsm-nav">' + tabs + '</div><div class="jsm-body" id="jsm-body"></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('.jsm-x').onclick = closeJsm;
    Array.prototype.forEach.call(ov.querySelectorAll('.jsm-tab'), function(b){
      b.onclick = function(){ JSM.tab = b.dataset.tab; renderJsmBody(); };
    });
    renderJsmBody();
  }

  function jsmSetActiveTab(){
    Array.prototype.forEach.call(document.querySelectorAll('.jsm-tab'), function(b){
      b.classList.toggle('active', b.dataset.tab === JSM.tab);
    });
  }

  function renderJsmBody(){
    var body = document.getElementById('jsm-body');
    if (!body) return;
    jsmSetActiveTab();
    if (JSM.tab === 'general') body.innerHTML = jsmGeneralHtml();
    else if (JSM.tab === 'notifications') body.innerHTML = jsmNotifHtml();
    else if (JSM.tab === 'boards') body.innerHTML = jsmBoardsHtml();
    else body.innerHTML = jsmFormHtml();
    jsmWire();
  }

  function jsmGeneralHtml(){
    var j = JSM.data.job;
    var types = ['Other','Full-Time','Part-Time','Hourly','Internship'];
    var radios = types.map(function(t){
      var on = (j.jobType || 'Other') === t;
      return '<label class="jsm-radio' + (on ? ' on' : '') + '"><input type="radio" name="jsm-type" value="' + t + '"' + (on ? ' checked' : '') + '>' + t + '</label>';
    }).join('');
    var locs = ORG_LOCATIONS.slice();
    if (j.location && locs.indexOf(j.location) < 0) locs.push(j.location);
    var locOpts = '<option value="">Select location</option>' + locs.map(function(l){
      return '<option value="' + escAttr(l) + '"' + (j.location === l ? ' selected' : '') + '>' + escHtml(l) + '</option>';
    }).join('');
    return '<h2>Job details</h2><p class="sub">Update the details of this job post.</p>'
      + '<div class="jsm-ffld"><label>Title</label><input type="text" id="jsm-title" value="' + escAttr(j.title) + '"></div>'
      + '<div class="jsm-ffld"><label>Type</label><div class="jsm-radios">' + radios + '</div></div>'
      + '<div class="jsm-ffld"><label>Salary</label><input type="text" id="jsm-salary" value="' + escAttr(j.salary) + '" placeholder="e.g. €70,000 — €90,000"></div>'
      + '<div class="jsm-ffld"><label>Location</label><select id="jsm-location">' + locOpts + '</select></div>'
      + '<div class="jsm-ffld"><label>Department</label><input type="text" disabled placeholder="No department"><div class="jsm-note">Please add departments first in the organization settings</div></div>'
      + '<div class="jsm-ffld"><label>Subtitle</label><input type="text" id="jsm-subtitle" value="' + escAttr(j.subtitle) + '"></div>'
      + '<div class="jsm-ffld"><label>State</label><input type="text" id="jsm-state" value="' + escAttr(j.state) + '"></div>'
      + '<div class="jsm-ffld"><label>City</label><input type="text" id="jsm-city" value="' + escAttr(j.city) + '"></div>'
      + '<div class="jsm-foot"><button class="btn" id="jsm-cancel">Cancel</button><button class="btn btn-primary" id="jsm-save">Save</button></div>';
  }

  function jsmNotifHtml(){
    var rows = (JSM.data.users || []).map(function(u){
      var parts = String(u.name || u.email || '?').split(' ').filter(function(w){ return w.length > 0; });
      var initials = (parts[0] ? parts[0].charAt(0) : '?').concat(parts[1] ? parts[1].charAt(0) : '').toUpperCase();
      var opts = [['off','Off'], ['daily','Daily summary']].map(function(o){
        return '<option value="' + o[0] + '"' + ((u.notifPref || 'off') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('');
      return '<div class="jsm-nrow"><div class="jsm-user"><span class="jsm-ava">' + escHtml(initials) + '</span>'
        + '<div><div class="nm">' + escHtml(u.name || '') + '</div><div class="em">' + escHtml(u.email || '') + '</div></div></div>'
        + '<select class="jsm-select" data-user="' + u.id + '">' + opts + '</select></div>';
    }).join('');
    return '<h2>Notification Settings</h2><p class="sub">Manage how admins receive notifications for new applications</p>'
      + '<div style="font-size:12.5px;font-weight:600;color:#6b7280;padding:4px 4px 8px;display:flex;justify-content:space-between"><span>Admin</span><span style="padding-right:14px">Notification Preference</span></div>'
      + rows;
  }

  function jsmBoardsHtml(){
    var b = JSM.data.boards || {};
    var st = JSM.data.job.status;
    function boardRow(key, label){
      var on = !!b[key];
      return '<div class="jsm-row"><div><span class="lbl">' + label + '</span>'
        + '<span class="desc">Automatically publish this job post to ' + label + '</span></div>'
        + '<button type="button" class="switch" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" data-board="' + key + '"><span class="knob"></span></button></div>';
    }
    var liNote = '';
    if (b.linkedin && b.linkedinPostedAt){
      liNote = '<div class="jsm-li"><span><b>Posted to LinkedIn</b> &middot; ' + escHtml(fmtLiDate(b.linkedinPostedAt)) + '</span>'
        + '<a href="' + LI_PAGE + '" target="_blank" rel="noopener">View on LinkedIn &#8599;</a></div>';
    } else if (b.linkedin && st !== 'active'){
      liNote = '<div class="jsm-note" style="margin:-6px 0 18px">Will be published when the job is active.</div>';
    }
    return '<h2>Job boards</h2><p class="sub">Choose what job boards you want this job to be posted to.</p>'
      + boardRow('monster', 'Monster') + boardRow('jooble', 'Jooble') + boardRow('careerjet', 'Careerjet')
      + boardRow('indeed', 'Indeed') + boardRow('linkedin', 'LinkedIn') + liNote;
  }

  function jsmFormHtml(){
    var fc = JSM.data.formConfig || {};
    var rows = JSM_FIELDS.map(function(kv){
      var k = kv[0], label = kv[1];
      var r = fc[k] || { visible: false, required: false };
      return '<tr><td>' + label + '</td>'
        + '<td class="c"><input type="checkbox" data-fc-visible="' + k + '"' + (r.visible ? ' checked' : '') + '></td>'
        + '<td class="c"><input type="checkbox" data-fc-required="' + k + '"' + (r.required ? ' checked' : '') + (r.visible ? '' : ' disabled') + '></td></tr>';
    }).join('');
    return '<h2>Edit Application Form</h2><p class="sub">Customize which fields are visible and required in your job application form.</p>'
      + '<table class="jsm-table"><thead><tr><th>Field</th><th class="c">Visible</th><th class="c">Required</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div class="jsm-foot"><button class="btn" id="jsm-cancel">Cancel</button><button class="btn btn-primary" id="jsm-save-form">Save</button></div>';
  }

  function updateLiChip(posted){
    var chip = document.getElementById('li-chip');
    if (chip) chip.style.display = posted ? '' : 'none';
  }

  function jsmWire(){
    var body = document.getElementById('jsm-body');
    if (!body) return;
    var cancel = body.querySelector('#jsm-cancel');
    if (cancel) cancel.onclick = closeJsm;

    var save = body.querySelector('#jsm-save');
    if (save) save.onclick = function(){
      var payload = {
        title: (body.querySelector('#jsm-title') || {}).value,
        salary: (body.querySelector('#jsm-salary') || {}).value,
        subtitle: (body.querySelector('#jsm-subtitle') || {}).value,
        state: (body.querySelector('#jsm-state') || {}).value,
        city: (body.querySelector('#jsm-city') || {}).value,
        location: (body.querySelector('#jsm-location') || {}).value || '',
      };
      var typeEl = body.querySelector('input[name=jsm-type]:checked');
      if (typeEl) payload.jobType = typeEl.value;
      if (!payload.title || !payload.title.trim()){ toast('Job title is required', false); return; }
      api('/api/jobs/' + JSM.jobId + '/settings', payload).then(function(res){
        if (res && res.ok){
          toast('Settings updated.');
          JSM.data.job.title = payload.title.trim();
          var h1 = document.querySelector('.topbar h1');
          if (h1) h1.textContent = payload.title.trim();
        } else toast('Could not save changes', false);
      });
    };

    Array.prototype.forEach.call(body.querySelectorAll('input[name=jsm-type]'), function(r){
      r.onchange = function(){
        Array.prototype.forEach.call(body.querySelectorAll('.jsm-radio'), function(l){ l.classList.toggle('on', l.querySelector('input').checked); });
      };
    });

    Array.prototype.forEach.call(body.querySelectorAll('.switch[data-board]'), function(sw){
      sw.onclick = function(){
        var key = sw.dataset.board;
        var next = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', next ? 'true' : 'false');
        api('/api/jobs/' + JSM.jobId + '/boards', { key: key, value: next }).then(function(res){
          if (res && res.ok){
            JSM.data.boards = res.boards;
            if (key === 'linkedin' && next && res.posted) toast('Job published to LinkedIn.');
            else toast('Settings updated.');
            updateLiChip(!!res.posted);
            renderJsmBody();
          } else {
            sw.setAttribute('aria-checked', next ? 'false' : 'true');
            toast('Could not update job boards', false);
          }
        });
      };
    });

    Array.prototype.forEach.call(body.querySelectorAll('.jsm-select[data-user]'), function(sel){
      sel.onchange = function(){
        api('/api/users/' + sel.dataset.user + '/notif-pref', { pref: sel.value }).then(function(res){
          if (res && res.ok){ toast('Settings updated.'); for (var i = 0; i < JSM.data.users.length; i++) if (JSM.data.users[i].id === Number(sel.dataset.user)) JSM.data.users[i].notifPref = sel.value; }
          else toast('Could not update preference', false);
        });
      };
    });

    Array.prototype.forEach.call(body.querySelectorAll('[data-fc-visible]'), function(cb){
      cb.onchange = function(){
        var reqCb = body.querySelector('[data-fc-required="' + cb.dataset.fcVisible + '"]');
        if (reqCb){ reqCb.disabled = !cb.checked; if (!cb.checked) reqCb.checked = false; }
      };
    });

    var saveForm = body.querySelector('#jsm-save-form');
    if (saveForm) saveForm.onclick = function(){
      var fields = {};
      JSM_FIELDS.forEach(function(kv){
        var k = kv[0];
        var visCb = body.querySelector('[data-fc-visible="' + k + '"]');
        var reqCb = body.querySelector('[data-fc-required="' + k + '"]');
        fields[k] = { visible: !!(visCb && visCb.checked), required: !!(reqCb && reqCb.checked) };
      });
      api('/api/jobs/' + JSM.jobId + '/form-config', { fields: fields }).then(function(res){
        if (res && res.ok){ JSM.data.formConfig = res.formConfig; toast('Settings updated.'); }
        else toast('Could not save changes', false);
      });
    };
  }

  var jobOptionsBtn = null;
  document.addEventListener('click', function(e){
    var btn = e.target.closest('[data-joboptions]');
    if (!btn) return;
    e.stopPropagation();
    var id = btn.dataset.joboptions;
    var st = btn.dataset.jobstatus || 'draft';
    var items = [
      {label:'Close job', fn:function(){ api('/api/jobs/' + id + '/status', {status:'closed'}).then(function(){ location.reload(); }); }},
      st === 'active'
        ? {label:'Unpublish job', fn:function(){ api('/api/jobs/' + id + '/status', {status:'draft'}).then(function(){ location.reload(); }); }}
        : {label:'Publish job', fn:function(){ api('/api/jobs/' + id + '/status', {status:'active'}).then(function(){ location.reload(); }); }},
      '-',
      {label:'Job settings', fn:function(){ openJobSettings(id); }},
    ];
    openMenu(btn, items);
  });
})();
`;

// ---------- fetch handler ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const dal = makeDal(env.DB);
    const ctx = {
      request, dal, env,
      params: {},
      query: url.searchParams,
      user: null, csrfToken: null, csrfSetCookie: null,
    };

    try {
      ensureCsrf(ctx);
      ctx.user = await currentUser(ctx);

      // route match: exact, then :param
      const method = request.method;
      const path = url.pathname;
      let match = routes[`${method} ${path}`];
      if (match) return await match(ctx);

      // param match (single :param segment)
      const segs = path.split('/').filter(Boolean);
      outer:
      for (const key of Object.keys(routes)) {
        const [m, ...psegs] = key.split(' ');
        if (m !== method) continue;
        const rsegs = psegs.join('/').split('/').filter(Boolean);
        if (rsegs.length !== segs.length) continue;
        const params = {};
        for (let i = 0; i < rsegs.length; i++) {
          if (rsegs[i].startsWith(':')) params[rsegs[i].slice(1)] = decodeURIComponent(segs[i]);
          else if (rsegs[i] !== segs[i]) continue outer;
        }
        ctx.params = params;
        return await routes[key](ctx);
      }

      if (path === '/client.js') {
        return new Response(CLIENT_JS, { headers: { 'Content-Type': 'application/javascript' } });
      }
      return html(ctx, notFound(), 404);
    } catch (e) {
      if (e instanceof CsrfError) return html(ctx, `<h1 style="font-family:sans-serif;padding:40px">Session expired — go back and try again.</h1>`, 403);
      console.log('[error]', path, e.message, e.stack && e.stack.split('\\n').slice(0, 4).join(' | '));
      return html(ctx, `<h1 style="font-family:sans-serif;padding:40px">Something went wrong.</h1>`, 500);
    }
  },
};
