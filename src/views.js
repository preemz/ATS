// Daya Pipeline views — Hirefly-style design, zero dependencies.
import { esc, safeJson } from './db.js';

const CSS = `
:root {
  --bg: #f6f7f9; --card: #ffffff; --ink: #1f2430; --muted: #6b7280;
  --line: #e5e7eb; --brand: #6d28d9; --brand-soft: #f3eefe;
  --danger: #c23434; --ok: #1e7a44; --ok-bg: #e8f7ee;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg); color: var(--ink); font-size: 14.5px; }
a { color: inherit; text-decoration: none; }
.app { display: flex; min-height: 100vh; }
/* ---- sidebar ---- */
.sidebar { width: 250px; flex-shrink: 0; background: var(--card); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.side-org { font-weight: 700; font-size: 16px; padding: 18px 20px 4px; }
.side-plan { color: var(--muted); font-size: 12px; padding: 0 20px 14px; border-bottom: 1px solid var(--line); }
.side-sec { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
  padding: 16px 20px 6px; }
.side-link { display: flex; align-items: center; gap: 8px; padding: 7px 20px; font-size: 13.5px;
  color: #374151; cursor: pointer; }
.side-job { display: block; padding: 7px 20px 7px 28px; font-size: 13px; color: #374151; }
.side-job.active { color: var(--brand); font-weight: 600; background: var(--brand-soft);
  border-left: 3px solid var(--brand); padding-left: 25px; }
.side-job .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); margin-right: 7px; }
.side-job .dot-draft { background: #d97706; }
.side-user { margin-top: auto; border-top: 1px solid var(--line); padding: 12px 20px;
  display: flex; align-items: center; gap: 10px; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: #e8eaf0; color: #4b5563;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex: 0 0 32px; }
.side-user .nm { font-size: 13px; font-weight: 600; }
.side-user .em { font-size: 11.5px; color: var(--muted); }
/* ---- main ---- */
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 20px 28px 10px; flex-wrap: wrap; }
.topbar h1 { margin: 0; font-size: 22px; font-weight: 700; }
.crumbs { color: var(--muted); font-size: 12.5px; margin-bottom: 4px; }
.crumbs a:hover { color: var(--brand); }
.badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 3px 10px;
  font-size: 12px; font-weight: 600; }
.badge-active { background: var(--ok-bg); color: var(--ok); }
.badge-draft { background: #fef3e2; color: #b45309; }
.btn { display: inline-flex; align-items: center; gap: 6px; background: var(--card); color: var(--ink);
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; font-size: 13.5px;
  font-weight: 500; cursor: pointer; }
.btn:hover { background: #f3f4f6; }
.btn-primary { background: var(--ink); color: #fff; border-color: var(--ink); }
.btn-primary:hover { background: #374151; }
.btn-danger { color: var(--danger); }
.btn-sm { padding: 5px 10px; font-size: 12.5px; }
/* ---- board ---- */
.board-wrap { flex: 1; overflow-x: auto; padding: 10px 28px 28px; }
.board { display: flex; gap: 14px; align-items: flex-start; min-height: 60vh; }
.col { width: 300px; flex: 0 0 300px; background: #f2f3f7; border: 1px solid var(--line);
  border-radius: 12px; display: flex; flex-direction: column; }
.col.dragging { opacity: .5; box-shadow: 0 0 0 2px var(--brand); }
.col-head { display: flex; align-items: flex-start; justify-content: space-between;
  padding: 12px 12px 8px; gap: 6px; }
.col-title { font-weight: 600; font-size: 14.5px; line-height: 1.3; margin: 2px 0 0;
  word-break: break-word; }
.grip { color: #9ca3af; cursor: grab; padding: 2px; flex: 0 0 auto; }
.grip:active { cursor: grabbing; }
.col-count { color: var(--muted); font-size: 11.5px; font-weight: 500; padding: 0 12px 6px 14px; }
.col-cards { padding: 4px 8px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
.card2 { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,.04); cursor: grab; }
.card2.dragging { opacity: .5; }
.card-row { display: flex; align-items: center; gap: 10px; }
.card-av { width: 38px; height: 38px; border-radius: 50%; background: #e8eaf0; color: #4b5563;
  display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex: 0 0 38px; }
.card-name { font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.card-date { color: var(--muted); font-size: 11.5px; margin-top: 2px; }
.card-menu { margin-left: auto; border: 0; background: transparent; cursor: pointer; color: #9ca3af;
  padding: 4px; border-radius: 6px; font-size: 15px; line-height: 1; }
.card-menu:hover { background: #f3f4f6; color: var(--ink); }
.star { color: #d97706; }
.sugg { color: var(--ok); }
.col-add { width: 300px; flex: 0 0 300px; }
.col-add-btn { width: 100%; text-align: left; background: transparent; border: 1.5px dashed #cbd2dc;
  color: var(--muted); border-radius: 12px; padding: 14px; font-size: 13.5px; cursor: pointer; }
.col-add-btn:hover { background: #eef0f5; }
/* ---- dialogs ---- */
.dlg-back { position: fixed; inset: 0; background: rgba(15,17,25,.45); display: flex;
  align-items: center; justify-content: center; z-index: 60; padding: 20px; }
.dlg { background: var(--card); border-radius: 14px; padding: 22px; width: 100%; max-width: 480px;
  box-shadow: 0 20px 50px rgba(0,0,0,.25); max-height: 90vh; overflow-y: auto; }
.dlg.wide { max-width: 640px; }
.dlg h2 { margin: 0 0 4px; font-size: 17px; }
.dlg .sub { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
.dlg label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 5px; }
.dlg input[type=text], .dlg input[type=email], .dlg input[type=url], .dlg select, .dlg textarea {
  width: 100%; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px;
  font-size: 14px; font-family: inherit; background: #fff; color: var(--ink); }
.dlg textarea { min-height: 120px; line-height: 1.5; }
.dlg .foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.err { background: #fdeaea; color: #a52a2a; border-radius: 8px; padding: 9px 12px; font-size: 13px; margin-top: 12px; }
.menu2 { position: absolute; background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.14); padding: 5px; min-width: 180px; z-index: 70; }
.menu2 button { display: block; width: 100%; text-align: left; background: transparent; border: 0;
  padding: 8px 10px; border-radius: 6px; font-size: 13.5px; cursor: pointer; }
.menu2 button:hover { background: #f3f4f6; }
.menu2 .danger { color: var(--danger); }
.menu2 .sep { height: 1px; background: var(--line); margin: 4px 2px; }
/* ---- job settings modal (Hirefly "Job settings" clone) ---- */
.jsm-overlay { position: fixed; inset: 0; background: rgba(15,15,20,.45); z-index: 90; display: flex; align-items: center; justify-content: center; padding: 24px; }
.jsm { width: 855px; max-width: 96vw; height: 633px; max-height: 92vh; background: #fff; border-radius: 8px; padding: 24px;
  display: flex; gap: 8px; position: relative; box-shadow: 0 24px 70px rgba(0,0,0,.28); overflow: hidden; }
.jsm-x { position: absolute; top: 14px; right: 14px; width: 30px; height: 30px; border: 0; background: transparent; border-radius: 8px;
  color: #6b7280; font-size: 16px; cursor: pointer; }
.jsm-x:hover { background: #f1f1f4; color: #111; }
.jsm-nav { width: 196px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }
.jsm-tab { display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 12px; border: 0; background: transparent;
  border-radius: 8px; font-size: 14px; font-weight: 500; color: #1a1a1a; cursor: pointer; text-align: left; width: 100%; }
.jsm-tab:hover { background: #f7f7f9; }
.jsm-tab.active { background: #f1f1f4; font-weight: 600; }
.jsm-tab svg { flex-shrink: 0; opacity: .8; }
.jsm-body { flex: 1; min-width: 0; padding: 2px 8px 0 26px; overflow-y: auto; }
.jsm-body h2 { margin: 0 0 4px; font-size: 25px; font-weight: 700; letter-spacing: -.01em; }
.jsm-body .sub { color: #6b7280; font-size: 14px; margin: 0 0 26px; }
.jsm-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
.jsm-row .lbl { font-size: 14px; font-weight: 500; line-height: 1.25; }
.jsm-row .desc { color: #9ca3af; font-size: 13.5px; display: block; margin-top: 3px; }
.jsm-row.disabled .lbl, .jsm-row.disabled .desc { opacity: .45; }
.switch { position: relative; width: 44px; height: 24px; border-radius: 999px; border: 2px solid transparent; background: #d7d7db;
  cursor: pointer; flex-shrink: 0; transition: background .15s; padding: 0; }
.switch .knob { display: block; width: 20px; height: 20px; border-radius: 999px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25);
  transform: translateX(0); transition: transform .15s; }
.switch[aria-checked="true"] { background: #171717; }
.switch[aria-checked="true"] .knob { transform: translateX(20px); }
.switch:disabled { opacity: .5; cursor: not-allowed; }
.jsm-li { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #0a66c2; background: #e8f1fb; border-radius: 8px;
  padding: 8px 12px; margin: -6px 0 18px; justify-content: space-between; }
.jsm-li a { color: #0a66c2; font-weight: 600; }
.jsm-ffld { margin-bottom: 14px; }
.jsm-ffld label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 5px; color: #374151; }
.jsm-ffld input[type=text], .jsm-ffld input[type=url], .jsm-ffld input[type=email], .jsm-ffld select, .jsm-ffld textarea {
  width: 100%; border: 1px solid #d9dae0; border-radius: 8px; padding: 9px 11px; font-size: 14px; font-family: inherit; background: #fff; }
.jsm-ffld textarea { min-height: 74px; resize: vertical; }
.jsm-radios { display: flex; gap: 6px; flex-wrap: wrap; }
.jsm-radio { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #d9dae0; border-radius: 999px;
  padding: 6px 12px; font-size: 13px; cursor: pointer; background: #fff; }
.jsm-radio input { accent-color: #171717; margin: 0; }
.jsm-radio.on { border-color: #171717; background: #f4f4f6; font-weight: 500; }
.jsm-note { font-size: 12.5px; color: #9ca3af; margin-top: 4px; }
.jsm-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; padding-bottom: 4px; }
.jsm-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.jsm-table th { text-align: left; font-weight: 600; font-size: 13px; color: #6b7280; padding: 8px 10px; border-bottom: 1px solid #e9e9ed; }
.jsm-table th.c { text-align: center; width: 84px; }
.jsm-table td { padding: 9px 10px; border-bottom: 1px solid #f1f1f4; }
.jsm-table td.c { text-align: center; }
.jsm-table input[type=checkbox] { width: 16px; height: 16px; accent-color: #171717; cursor: pointer; }
.jsm-table input[type=checkbox]:disabled { cursor: not-allowed; opacity: .4; }
.jsm-user { display: flex; align-items: center; gap: 10px; }
.jsm-ava { width: 34px; height: 34px; border-radius: 999px; background: #eceef2; color: #4b5563; font-size: 12px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.jsm-user .nm { font-weight: 500; line-height: 1.2; }
.jsm-user .em { color: #6b7280; font-size: 12.5px; }
.jsm-nrow { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 10px 4px; border-bottom: 1px solid #f1f1f4; }
.jsm-select { border: 1px solid #d9dae0; border-radius: 8px; padding: 7px 10px; font-size: 13.5px; background: #fff; font-family: inherit; }
.toast { position: fixed; right: 22px; bottom: 22px; background: #17181c; color: #fff; border-radius: 10px; padding: 11px 16px;
  font-size: 13.5px; box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s;
  z-index: 120; pointer-events: none; display: flex; align-items: center; gap: 8px; }
.toast.show { opacity: 1; transform: translateY(0); }
.toast .tk { width: 18px; height: 18px; border-radius: 999px; background: #22c55e; color: #fff; display: inline-flex; align-items: center;
  justify-content: center; font-size: 11px; flex-shrink: 0; }
.flash { background: var(--ok-bg); color: var(--ok); border-radius: 8px; padding: 11px 15px;
  margin: 0 28px 8px; font-size: 13.5px; }
.flash-err { background: #fdeaea; color: #a52a2a; }
/* auth + simple pages */
.narrow { max-width: 960px; margin: 0 auto; padding: 28px; width: 100%; }
.login-box { max-width: 380px; margin: 8vh auto; background: var(--card); border: 1px solid var(--line);
  border-radius: 14px; padding: 30px; }
.login-box h1 { font-size: 20px; margin: 0 0 4px; }
.login-box label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 5px; }
.login-box input { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px;
  font-size: 14px; font-family: inherit; }
.login-box .btn { width: 100%; justify-content: center; margin-top: 18px; background: var(--ink);
  color: #fff; border: 0; }
table.plain { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line);
  border-radius: 10px; overflow: hidden; font-size: 13.5px; }
table.plain th, table.plain td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-size: 12px; }
.jobgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.jobcard { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
.jobcard h3 { margin: 0 0 4px; font-size: 15px; }
.jobcard:hover { border-color: var(--brand); }
.jobcard .meta { color: var(--muted); font-size: 12.5px; }
.stat-row { display: flex; gap: 12px; flex-wrap: wrap; margin: 14px 0 22px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 13px 18px; min-width: 120px; }
.stat .n { font-size: 22px; font-weight: 700; }
.stat .l { font-size: 12px; color: var(--muted); }
.hint { color: var(--muted); font-size: 12.5px; }
.howto { background: var(--brand-soft); border: 1px solid #ddd0f7; border-radius: 12px;
  padding: 16px 20px; margin-bottom: 18px; font-size: 13.5px; line-height: 1.6; }
/* list pages (candidates / jobs) */
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 28px 6px; flex-wrap: wrap; }
.page-head h1 { font-size: 22px; margin: 0; }
.page-tools { display: flex; align-items: center; gap: 10px; padding: 8px 28px 12px; }
.filter-chip { display: inline-flex; align-items: center; gap: 8px; border: 1.5px dashed #cbd2dc; border-radius: 8px; padding: 7px 14px; cursor: pointer; font-size: 13.5px; color: var(--ink); background: transparent; }
.filter-chip:hover { background: #eef0f5; }
.filter-chip.has-active { border-style: solid; border-color: var(--brand); color: var(--brand); }
table.grid { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; font-size: 13.5px; }
table.grid th, table.grid td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); }
table.grid thead th { color: var(--muted); font-size: 12px; font-weight: 600; background: #fafbfc; white-space: nowrap; }
table.grid tbody tr:hover { background: #fafbfd; }
table.grid tbody tr:last-child td { border-bottom: 0; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--ink); }
.sortmark { font-size: 10px; margin-left: 3px; }
.row-menu { border: 0; background: transparent; cursor: pointer; color: #9ca3af; padding: 5px; border-radius: 6px; font-size: 15px; line-height: 1; }
.row-menu:hover { background: #f3f4f6; color: var(--ink); }
.pager { display: flex; align-items: center; gap: 6px; padding: 14px 0 4px; }
.pager button, .pager a { border: 1px solid var(--line); background: var(--card); border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; color: var(--ink); }
.pager a:hover { background: #f3f4f6; }
.pager .cur { background: var(--ink); color: #fff; border-color: var(--ink); font-weight: 600; }
.pager .disabled { opacity: .45; pointer-events: none; }
.taglist { max-height: 260px; overflow-y: auto; margin-top: 8px; }
.tagrow { display: flex; align-items: center; gap: 9px; padding: 8px 9px; border-radius: 7px; cursor: pointer; font-size: 13.5px; }
.tagrow:hover { background: #f3f4f6; }
.tagrow input[type=checkbox] { width: auto; margin: 0; }
.badge-closed { background: #f1f2f5; color: #5b6472; }
.empty-note { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 22px; color: var(--muted); }
`;

function initials(first, last) {
  return ((first || '?')[0] + (last ? last[0] : '')).toUpperCase();
}

function avatarHtml(a) {
  return `<span class="avatar">${esc(initials(a.firstName, a.lastName))}</span>`;
}

function flashHtml(query) {
  const ok = query.get('ok'), err = query.get('err');
  if (ok) return `<div class="flash">${esc(ok)}</div>`;
  if (err) return `<div class="flash flash-err">${esc(err)}</div>`;
  return '';
}

function sidebar(user, jobs, activeJobId, activeNav) {
  const dot = (st) => st === 'active' ? 'var(--ok)' : st === 'closed' ? '#9ca3af' : '#d97706';
  const nav = (href, label) => `<a class="side-job ${activeNav === href ? 'active' : ''}" href="${href}">${label}</a>`;
  return `<aside class="sidebar">
    <div class="side-org">Daya Ventures</div>
    <div class="side-plan">Pipeline · ${user.name.split(' ')[0]}</div>
    <div class="side-sec side-sec" style="padding:14px 20px 6px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em">Jobs</div>
    ${jobs.map((j) => `<a class="side-job ${j.id === activeJobId ? 'active' : ''}" href="/jobs/${j.id}">
      <span class="dot" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot(j.status)};margin-right:7px"></span>${esc(j.title)}</a>`).join('')}
    <div style="padding:14px 20px 6px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em">Workspace</div>
    ${nav('/overview', 'Overview')}
    ${nav('/candidates', 'Candidates')}
    ${nav('/jobs', 'Jobs')}
    ${nav('/careers', 'Careers page')}
    ${nav('/emails', 'Email log')}
    ${nav('/help', 'How to use')}
    <div class="side-user">
      ${avatarHtml({ firstName: user.name.split(' ')[0], lastName: user.name.split(' ').slice(1).join(' ') })}
      <div><div class="nm">${esc(user.name)}</div><div class="em">${esc(user.email)}</div></div>
    </div>
    <form method="post" action="/logout" style="padding:0 20px 16px"><button class="btn btn-sm" type="submit">Log out</button></form>
  </aside>`;
}

function shell({ user, jobs, activeJobId, activeNav, title, query = new URLSearchParams(), body, wide }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Daya Pipeline</title>
<style>${CSS}</style></head><body>
<div class="app">
${sidebar(user, jobs, activeJobId, activeNav)}
<main class="main">
  ${flashHtml(query)}
  ${body}
<script src="/client.js"></script>
</div>
</div></body></html>`;
}

export function loginPage({ error, email }) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Log in · Daya Pipeline</title><style>${CSS}</style></head><body>
<div class="login-box">
  <div style="font-weight:700;font-size:17px;margin-bottom:2px">Daya <span style="color:var(--brand)">Pipeline</span></div>
  <p class="hint" style="margin:0 0 8px">Candidate pipeline for the Daya Ventures portfolio search.</p>
  ${error ? `<div class="err" style="background:#fdeaea;color:#a52a2a;border-radius:8px;padding:9px 12px;font-size:13px">${esc(error)}</div>` : ''}
  <form method="post" action="/login">
    <label>Email</label><input type="email" name="email" required value="${esc(email || '')}" autofocus>
    <label>Password</label><input type="password" name="password" required>
    <div style="margin-top:16px"><button class="btn btn-primary" type="submit">Log in</button></div>
  </form>
</div></body></html>`;
}

// These pages don't know the jobs list; the route handler passes it via `jobsNav`
// before rendering. Implemented as plain functions in index.js by composing shell().
export function overviewPage({ user, jobs, jobsNav, query }) {
  const totalApps = jobs.reduce((s, j) => s + (j.nApps || 0), 0);
  const body = `<div class="narrow">
    <h1 style="font-size:22px;margin:0 0 4px">Pipeline overview</h1>
    <p class="hint" style="margin:0 0 18px">All ${jobs.length} open searches · ${totalApps} candidates on the boards.</p>
    <div class="stat-row">
      <div class="stat"><div class="n">${jobs.length}</div><div class="l">Open searches</div></div>
      <div class="stat"><div class="n">${totalApps}</div><div class="l">Candidates</div></div>
    </div>
    <div class="jobgrid">
      ${jobs.map((j) => `<a class="jobcard card2" style="display:block" href="/jobs/${j.id}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <strong style="font-size:14px;line-height:1.35">${esc(j.title)}</strong>
          <span class="badge ${j.status === 'active' ? 'badge-active' : 'badge-draft'}">${esc(j.status)}</span>
        </div>
        <div class="meta" style="margin-top:8px">${j.nApps} candidate${j.nApps === 1 ? '' : 's'} · opened ${esc((j.createdAt || '').slice(0, 10))}</div>
      </a>`).join('')}
    </div></div>`;
  return shell({ user, jobs: jobsNav, activeJobId: null, activeNav: '/overview', title: 'Overview', query, body });
}

export function emailsPage({ user, rows, jobsNav, query }) {
  const body = `<div class="narrow">
    <h1 style="font-size:22px;margin:0 0 4px">Email log</h1>
    <p class="hint" style="margin:0 0 16px">Interview suggestions and rejection emails recorded by the board.
    Demo mode: messages are logged here instead of being sent.</p>
    ${rows.length ? `<table class="plain"><tr><th>When</th><th>To</th><th>Subject</th><th>First line</th></tr>
      ${rows.map((r) => `<tr><td>${esc((r.createdAt || '').slice(0, 16).replace('T', ' '))}</td>
        <td>${esc(r.recipient)}</td><td>${esc(r.subject)}</td>
        <td style="color:var(--muted)">${esc((r.body || '').slice(0, 80))}…</td></tr>`).join('')}
    </table>` : '<div class="card2" style="padding:20px">No emails yet.</div>'}
  </div>`;
  return shell({ user, jobs: jobsNav, activeJobId: null, activeNav: '/emails', title: 'Email log', query, body });
}

export function helpPage({ user, jobsNav, query }) {
  const body = `<div class="narrow">
    <h1 style="font-size:22px;margin:0 0 4px">How to use the pipeline board</h1>
    <div class="howto">
      <strong>1 · Open a job</strong> in the left sidebar — each search has its own kanban board.<br><br>
      <strong>2 · Drag candidates</strong> between columns (grab the card or its avatar) to move them through your process.
      Drag cards within a column to reorder your shortlist. Everything saves automatically.<br><br>
      <strong>3 · Drag columns</strong> by the ⋮⋮ handle to reorder the pipeline itself.<br><br>
      <strong>4 · Card menu (⋮)</strong> on each card:
      <em>Move</em> — copy or move the applicant to a different job's board;
      <em>Suggest interview</em> — send the candidate an interview-scheduling email (logged in Email log);
      <em>⭐ Favourite</em> — mark them;
      <em>Reject</em> — move them to the board's Rejected column.<br><br>
      <strong>5 · Column menu (⋮)</strong> in each column header:
      <em>Edit</em> renames; <em>Delete</em> removes a column (you choose where its cards go).
      The first column (Applied) and the Rejected column are structural — they can be renamed but not deleted.<br><br>
      <strong>6 · New applications</strong> always land in the first column automatically.
    </div>
  </div>`;
  return shell({ user, jobs: jobsNav, activeJobId: null, activeNav: '/help', title: 'How to use', query, body });
}

export function kanbanPage({ user, jobs, job, stages, apps, query }) {
  const byStage = {};
  for (const s of stages) byStage[s.id] = [];
  const orphans = [];
  for (const a of apps) (byStage[a.stageId] ? byStage[a.stageId] : orphans).push(a);
  const cols = stages.map((s) => `
    <div class="col" data-stage="${s.id}" data-variant="${esc(s.variant)}">
      <div class="col-head">
        <div style="display:flex;gap:6px;min-width:0">
          <span class="grip" title="Drag to reorder column" draggable="true" data-grip="${s.id}">⋮⋮</span>
          <div><div class="col-title">${esc(s.title)}</div></div>
        </div>
        <button class="card-menu" data-colmenu="${s.id}" title="Open menu" aria-label="Open menu">⋮</button>
      </div>
      <div class="col-count">${(byStage[s.id] || []).length}</div>
      <div class="col-cards" data-stage-drop="${s.id}">
        ${(byStage[s.id] || []).map((a) => `
        <div class="card2" draggable="true" data-app="${a.id}">
          <div class="card-row">
            ${avatarHtml(a)}
            <div style="min-width:0;flex:1">
              <div class="card-row" style="justify-content:space-between">
                <div style="min-width:0">
                  <div class="card-name card-name${''}">${esc(a.firstName)} ${esc(a.lastName)}
                    ${a.isFavorite ? '<span title="Favourite" style="color:#d97706">★</span>' : ''}
                    ${a.interviewSuggested ? '<span title="Interview suggested" style="color:var(--ok)">🗓</span>' : ''}
                  </div>
                  <div class="card-date">${a.originType === 'sourced' ? 'Sourced' : 'Applied'} ${(a.createdAt || '').slice(0, 10)}</div>
                </div>
                <button class="card-menu" data-appmenu="${a.id}" aria-label="Open menu">⋮</button>
              </div>
            </div>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('');
  const linkedinPosted = (() => {
    const b = safeJson(job.boards, {});
    return !!(b && b.linkedin && b.linkedinPostedAt);
  })();
  const body = `
    <div class="topbar">
      <div>
        <div class="crumbs"><a href="/overview">Overview</a> › Jobs</div>
        <h1 style="margin:0;font-size:22px;font-weight:700">${esc(job.title)}</h1>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
          <span class="badge ${job.status === 'active' ? 'badge-active' : 'badge-draft'}">${esc(job.status)}</span>
          <span class="badge" id="li-chip" style="background:#e8f1fb;color:#0a66c2;${linkedinPosted ? '' : 'display:none'}" title="Posted to LinkedIn">in&nbsp;Posted on LinkedIn</span>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" data-opendialog="add-candidate">＋ Add candidate</button>
        <button class="btn" data-joboptions="${job.id}" data-jobstatus="${esc(job.status)}">Job options ⋯</button>
      </div>
    </div>
    ${flashHtml(query)}
    <div class="board-wrap board-wrap" style="flex:1">
      <div class="board-wrap" style="overflow-x:auto;padding:10px 28px 28px">
        <div class="board" id="board" data-job="${job.id}">
          ${cols}
          <div class="col-add"><button class="col-add-btn" data-opendialog="add-column">＋ Add Column</button></div>
        </div>
      </div>
    </div>
    <div id="dlg-root"></div>`;
  const sh = shell({ user, jobs, activeJobId: job.id, title: job.title, query, body });
  return sh;
}

