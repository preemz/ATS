// Careers page feature: public page renderer, editor, and public job detail page.
// Mirrors Hirefly's careers-page system: a config (global colors + ordered
// sections) rendered to a dark, brandable page; job cards link to public job
// detail pages with an application form.
import { esc } from './db.js';

// ---------- color utils ----------

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function safeColor(v, fallback) {
  return HEX_RE.test(String(v || '')) ? String(v).toLowerCase() : fallback;
}

export function hexToRgba(hex, alpha) {
  const h = safeColor(hex, '#000000').slice(1);
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------- rich text sanitizer (staff-authored content; allowlist approach) ----------

export function sanitizeRich(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/\son\w+\s*=\s*'[^']*'/gi, '').replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  s = s.replace(/javascript:/gi, '');
  // drop any tag that is not in the allowlist (keeps inner text)
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (m, tag) => {
    const t = tag.toLowerCase();
    const allowed = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a'];
    return allowed.includes(t) ? m : '';
  });
  // sanitize anchors: keep only safe hrefs
  s = s.replace(/<a\b[^>]*>/gi, (m) => {
    const href = (m.match(/href\s*=\s*"([^"]*)"/i) || m.match(/href\s*=\s*'([^']*)'/i) || [])[1] || '';
    const ok = /^(https?:\/\/|mailto:|\/)/i.test(href);
    return ok ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">` : '<a>';
  });
  return s;
}

function youtubeEmbed(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  const id = m ? m[1] : (/^[A-Za-z0-9_-]{6,20}$/.test(u) ? u : '');
  return id ? `https://www.youtube.com/embed/${id}` : '';
}

// ---------- section data helpers ----------

export function defaultSectionData(type) {
  switch (type) {
    case 'text': return { title: '', body: '' };
    case 'values': return { title: '', values: [{ title: '', description: '' }] };
    case 'photoCollage': return { description: '', images: [{ id: 'img1', url: '' }] };
    case 'video': return { videoUrl: '' };
    case 'members': return { title: '', members: [{ name: '', jobTitle: '', testimony: '', avatarUrl: '' }] };
    default: return {};
  }
}

export function sanitizeConfig(input) {
  const src = (input && typeof input === 'object') ? input : {};
  const out = {
    backgroundColor: safeColor(src.backgroundColor, '#1f0021'),
    textColor: safeColor(src.textColor, '#fffdfe'),
    sections: [],
  };
  const types = ['hero', 'openPositions', 'text', 'values', 'photoCollage', 'video', 'members'];
  const seenSystem = {};
  const sections = Array.isArray(src.sections) ? src.sections : [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    const type = types.includes(s.type) ? s.type : null;
    if (!type) continue;
    if ((type === 'hero' || type === 'openPositions') && seenSystem[type]) continue;
    seenSystem[type] = true;
    const d = (s.data && typeof s.data === 'object') ? s.data : {};
    const str = (v, n = 400) => String(v ?? '').slice(0, n);
    const data = {};
    if (type === 'hero') {
      data.image = str(d.image, 600);
      data.title = str(d.title, 200);
      data.description = str(d.description, 2000);
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
      if (d.primaryTextColor) data.primaryTextColor = safeColor(d.primaryTextColor, '');
      if (d.secondaryTextColor) data.secondaryTextColor = safeColor(d.secondaryTextColor, '');
    } else if (type === 'openPositions') {
      data.title = str(d.title, 200);
      data.description = str(d.description, 1000);
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
      if (d.textColor) data.textColor = safeColor(d.textColor, '');
    } else if (type === 'text') {
      data.title = str(d.title, 200);
      data.body = sanitizeRich(str(d.body, 8000));
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
      if (d.textColor) data.textColor = safeColor(d.textColor, '');
    } else if (type === 'values') {
      data.title = str(d.title, 200);
      data.values = (Array.isArray(d.values) ? d.values : []).slice(0, 24).map((v) => ({
        title: str(v && v.title, 120),
        description: str(v && v.description, 600),
      }));
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
      if (d.textColor) data.textColor = safeColor(d.textColor, '');
    } else if (type === 'photoCollage') {
      data.description = str(d.description, 600);
      data.images = (Array.isArray(d.images) ? d.images : []).slice(0, 24).map((im, i) => ({
        id: str(im && im.id, 40) || `img${i}`,
        url: str(im && im.url, 600),
      }));
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
    } else if (type === 'video') {
      data.videoUrl = str(d.videoUrl, 400);
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
    } else if (type === 'members') {
      data.title = str(d.title, 200);
      data.members = (Array.isArray(d.members) ? d.members : []).slice(0, 40).map((mm) => ({
        name: str(mm && mm.name, 120),
        jobTitle: str(mm && mm.jobTitle, 120),
        testimony: str(mm && mm.testimony, 800),
        avatarUrl: str(mm && mm.avatarUrl, 600),
      }));
      if (d.backgroundColor) data.backgroundColor = safeColor(d.backgroundColor, '');
      if (d.textColor) data.textColor = safeColor(d.textColor, '');
    }
    out.sections.push({ id: str(s.id, 40) || `s${out.sections.length}`, type, data });
  }
  return out;
}

// ---------- public page rendering ----------

export const CAREERS_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
a { text-decoration: none; }
.cp-wrap { min-height: 100vh; display: flex; flex-direction: column; padding-bottom: 56px; }
.cp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 80px; padding: 0 32px; }
.cp-brand { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; }
.cp-brand:hover { background: rgba(255,255,255,.08); }
.cp-brand img { width: 24px; height: 24px; border-radius: 4px; }
.cp-brand span { font-size: 14px; font-weight: 500; }
.cp-see { display: inline-flex; align-items: center; gap: 6px; background: #171717; color: #fafafa; height: 40px; padding: 0 16px 0 12px; border-radius: 8px; font-size: 14px; font-weight: 500; }
.cp-see:hover { background: #2b2b2b; }
.cp-see svg { width: 16px; height: 16px; }
.cp-hero { padding: 8px 32px 48px; text-align: center; }
.cp-hero h1 { font-size: clamp(36px, 6vw, 60px); font-weight: 700; letter-spacing: -.02em; margin: 56px 0 0; }
.cp-hero p { font-size: 18px; line-height: 1.55; max-width: 700px; margin: 24px auto 0; white-space: pre-line; }
.cp-hero img.cp-heroimg { max-width: 100%; border-radius: 12px; margin-top: 32px; }
.cp-sec { padding: 32px; display: flex; flex-direction: column; align-items: center; }
.cp-inner { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 32px; }
.cp-h2 { text-wrap: balance; max-width: 640px; font-size: 36px; font-weight: 700; line-height: 40px; margin: 0; }
.cp-desc { font-size: 18px; line-height: 1.55; max-width: 640px; margin: -16px 0 0; white-space: pre-line; }
@media (max-width: 800px) { .cp-h2 { font-size: 30px; line-height: 36px; } }
@media (max-width: 640px) { .cp-h2 { font-size: 24px; line-height: 32px; } .cp-head { padding: 0 16px; } .cp-sec { padding: 24px 16px; } }
/* job cards */
.cp-jobs { list-style: none; margin: 0; padding: 0; width: 100%; border-radius: 12px; overflow: hidden; }
.cp-jobs li { position: relative; }
.cp-jobs .cp-cardlink { display: block; padding: 16px 24px; position: relative; z-index: 10; }
.cp-jobtitle { font-size: 18px; font-weight: 500; margin: 0; }
.cp-jobmeta { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-top: 4px; font-size: 14px; align-items: center; }
.cp-jobmeta svg { width: 16px; height: 16px; }
.cp-details { display: flex; align-items: center; gap: 4px; font-size: 16px; }
.cp-details svg { transition: transform .2s; }
.cp-cardlink:hover .cp-details svg { transform: translateX(4px); }
.cp-jobs li .cp-hover1 { position: absolute; inset: 0; opacity: 0; background: #fff; mix-blend-mode: overlay; transition: opacity .2s; }
.cp-jobs li .cp-hover2 { position: absolute; inset: 0; opacity: 0; background: #000; transition: opacity .2s; }
.cp-jobs li:hover .cp-hover1 { opacity: .15; }
.cp-jobs li:hover .cp-hover2 { opacity: .05; }
/* rich text */
.cp-rich { font-size: 18px; line-height: 1.6; max-width: 640px; }
.cp-rich p { margin: 0 0 16px; }
.cp-rich p:empty { display: none; }
.cp-rich a { text-decoration: underline; color: inherit; }
.cp-rich ul, .cp-rich ol { padding-left: 22px; margin: 0 0 16px; }
/* values */
.cp-values { display: flex; flex-wrap: wrap; gap: 56px 40px; width: 100%; }
.cp-value { flex: 1 1 300px; display: flex; flex-direction: column; gap: 4px; }
.cp-value h3 { font-size: 18px; font-weight: 600; margin: 0; }
.cp-value p { font-size: 18px; line-height: 1.5; margin: 0; white-space: pre-wrap; }
/* gallery */
.cp-gal { display: flex; flex-wrap: wrap; gap: 12px; }
.cp-gal img { border-radius: 12px; max-height: 320px; max-width: 100%; object-fit: cover; }
/* video */
.cp-video { width: 100%; max-width: 900px; aspect-ratio: 16/9; border-radius: 12px; overflow: hidden; background: rgba(0,0,0,.3); }
.cp-video iframe { width: 100%; height: 100%; border: 0; display: block; }
/* members */
.cp-members { display: flex; flex-wrap: wrap; gap: 24px 40px; width: 100%; }
.cp-member { flex: 1 1 220px; max-width: 320px; display: flex; flex-direction: column; gap: 12px; }
.cp-member .ph { position: relative; width: 100%; aspect-ratio: 1/1; border-radius: 12px; overflow: hidden; background: rgba(255,255,255,.08); }
.cp-member .ph img { width: 100%; height: 100%; object-fit: cover; }
.cp-member h3 { font-size: 18px; font-weight: 600; margin: 0; }
.cp-member .jt { font-size: 14px; opacity: .75; margin: -8px 0 0; }
.cp-member .tm { font-size: 15px; line-height: 1.5; white-space: pre-line; margin: 0; }
/* footer badge */
.cp-foot { margin: 40px 0 24px; text-align: center; }
.cp-badge { display: inline-flex; align-items: center; gap: 6px; background: #f3f4f6; color: #6b7280; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 500; }
.cp-badge b { color: #4b5563; font-weight: 600; }
/* job detail page */
.cp-jobhead { display: flex; align-items: center; gap: 16px; height: 80px; padding: 0 32px; }
.cp-alljobs { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; padding: 8px 12px; border-radius: 8px; white-space: nowrap; }
.cp-alljobs:hover { background: rgba(255,255,255,.08); }
.cp-applybtn { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; background: #171717; color: #fafafa; height: 40px; padding: 0 16px 0 12px; border-radius: 8px; font-size: 14px; font-weight: 500; }
.cp-title { text-wrap: balance; max-width: 900px; font-size: 36px; font-weight: 700; line-height: 1.15; margin: 0; }
.cp-jobsec { padding: 32px; display: flex; justify-content: center; }
.cp-jobinner { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 24px; }
.cp-apply-card { background: #fff; color: #0a0a0a; border: 1px solid #e9e9ed; border-radius: 8px; padding: 24px; }
.cp-apply-card h3 { font-size: 20px; font-weight: 600; letter-spacing: -.01em; margin: 0 0 6px; }
.cp-apply-card .sub { color: #64708a; font-size: 14px; margin: 0 0 18px; }
.cp-form { display: grid; gap: 16px; }
.cp-frow { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 640px) { .cp-frow { grid-template-columns: 1fr; } }
.cp-field label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 8px; color: #0a0a0a; }
.cp-field label .req { color: #d33; margin-left: 2px; }
.cp-field input, .cp-field textarea { width: 100%; border: 1px solid #d7d7db; border-radius: 6px; padding: 8px 12px; font-size: 14px; font-family: inherit; color: #0a0a0a; background: #fff; }
.cp-field input { height: 40px; }
.cp-field textarea { min-height: 110px; line-height: 1.5; }
.cp-field input:focus, .cp-field textarea:focus { outline: 2px solid #b9c8f5; border-color: #2f5fde; }
.cp-submit { height: 40px; width: 100%; background: #171717; color: #fafafa; border: 0; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer; }
.cp-submit:hover { background: #2b2b2b; }
.cp-flash { border-radius: 8px; padding: 12px 16px; font-size: 14.5px; margin: 0 0 16px; background: #e8f7ee; color: #1e7a44; }
.cp-flash.err { background: #fdeaea; color: #a52a2a; }
`;

function brandHeader(companyName, textColor, preview) {
  const href = preview ? '#' : '/daya-ventures';
  return `<div class="cp-head">
    <a class="cp-brand" href="${href}">
      <img src="/assets/daya-logo.png" width="24" height="24" alt="${esc(companyName)}">
      <span style="color:${textColor}">${esc(companyName)}</span>
    </a>
    <a class="cp-see" href="#open-positions">${svgIcon('chevron-down')} See positions</a>
  </div>`;
}

function svgIcon(name) {
  const icons = {
    'chevron-down': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    'chevron-right': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    'chevron-left': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    'briefcase': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M22 13a18.15 18.15 0 0 1-20 0"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>',
    'check': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 6 9 17l-5-5"/></svg>',
    'pencil': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
  };
  return icons[name] || '';
}

function jobCardsHtml(jobs, bg, textColor, preview) {
  if (!jobs.length) return '';
  return `<div class="cp-jobs" style="background-color:${hexToRgba(bg, 0.867)};border:1px solid ${hexToRgba(textColor, 0.31)}">
    <ul style="list-style:none;margin:0;padding:0">
    ${jobs.map((j) => `<li>
      <div class="cp-hover1"></div><div class="cp-hover2"></div>
      <a class="cp-cardlink" href="${preview ? '#' : `/daya-ventures/${j.id}`}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <h3 class="cp-jobtitle" style="color:${textColor}">${esc(j.title)}</h3>
            <div class="cp-jobmeta" style="color:${textColor}">
              <div style="display:flex;align-items:center;gap:4px">${svgIcon('briefcase')}<span>${esc((j.jobType || 'Other').toLowerCase())}</span></div>
            </div>
          </div>
          <div class="cp-details" style="color:${textColor};margin-left:16px">
            <span>Details</span>${svgIcon('chevron-right')}
          </div>
        </div>
      </a>
    </li>`).join('')}
    </ul>
  </div>`;
}

function sectionHtml(section, ctx) {
  const { pageBg, pageText, preview } = ctx;
  const d = section.data || {};
  const bg = d.backgroundColor || pageBg;
  switch (section.type) {
    case 'hero': {
      const primary = d.primaryTextColor || pageText;
      const secondary = d.secondaryTextColor || pageText;
      return `<section class="cp-hero" style="background-color:${bg}">
        <h1 style="color:${primary}">${esc(d.title)}</h1>
        ${d.description ? `<p style="color:${secondary}">${esc(d.description)}</p>` : ''}
        ${d.image ? `<img class="cp-heroimg" src="${esc(d.image)}" alt="">` : ''}
      </section>`;
    }
    case 'openPositions': {
      const text = d.textColor || pageText;
      return `<section class="cp-sec" id="open-positions" style="background-color:${bg}">
        <div class="cp-inner">
          ${d.title ? `<h2 class="cp-h2" style="color:${text}">${esc(d.title)}</h2>` : ''}
          ${d.description ? `<p class="cp-desc" style="color:${text}">${esc(d.description)}</p>` : ''}
          ${jobCardsHtml(ctx.jobs, bg, text, preview)}
        </div>
      </section>`;
    }
    case 'text': {
      const text = d.textColor || pageText;
      return `<section class="cp-sec" style="background-color:${bg}">
        <div class="cp-inner">
          ${d.title ? `<h2 class="cp-h2" style="color:${text}">${esc(d.title)}</h2>` : ''}
          <div class="cp-rich" style="color:${text}">${sanitizeRich(d.body || '')}</div>
        </div>
      </section>`;
    }
    case 'values': {
      const text = d.textColor || pageText;
      const vals = (d.values || []).filter((v) => (v.title || '').trim() || (v.description || '').trim());
      return `<section class="cp-sec" style="background-color:${bg}">
        <div class="cp-inner">
          ${d.title ? `<h2 class="cp-h2" style="color:${text}">${esc(d.title)}</h2>` : ''}
          <div class="cp-values">
            ${vals.map((v) => `<div class="cp-value" style="color:${text}">
              ${v.title ? `<h3>${esc(v.title)}</h3>` : ''}
              ${v.description ? `<p>${esc(v.description)}</p>` : ''}
            </div>`).join('')}
          </div>
        </div>
      </section>`;
    }
    case 'photoCollage': {
      const imgs = (d.images || []).filter((i) => (i.url || '').trim());
      return `<section class="cp-sec" style="background-color:${bg}">
        <div class="cp-inner">
          ${d.description ? `<p class="cp-desc" style="color:${pageText}">${esc(d.description)}</p>` : ''}
          <div class="cp-gal">${imgs.map((i) => `<img src="${esc(i.url)}" alt="">`).join('')}</div>
        </div>
      </section>`;
    }
    case 'video': {
      const embed = youtubeEmbed(d.videoUrl);
      if (!embed) return '';
      return `<section class="cp-sec" style="background-color:${bg}">
        <div class="cp-video"><iframe src="${esc(embed)}" allowfullscreen loading="lazy" title="Video"></iframe></div>
      </section>`;
    }
    case 'members': {
      const text = d.textColor || pageText;
      const members = (d.members || []).filter((m) => (m.name || '').trim() || (m.avatarUrl || '').trim());
      return `<section class="cp-sec" style="background-color:${bg}">
        <div class="cp-inner">
          ${d.title ? `<h2 class="cp-h2" style="color:${text}">${esc(d.title)}</h2>` : ''}
          <div class="cp-members">
            ${members.map((m) => `<div class="cp-member" style="color:${text}">
              <div class="ph">${m.avatarUrl ? `<img src="${esc(m.avatarUrl)}" alt="${esc(m.name)}">` : ''}</div>
              ${m.name ? `<h3>${esc(m.name)}</h3>` : ''}
              ${m.jobTitle ? `<p class="jt">${esc(m.jobTitle)}</p>` : ''}
              ${m.testimony ? `<p class="tm">${esc(m.testimony)}</p>` : ''}
            </div>`).join('')}
          </div>
        </div>
      </section>`;
    }
    default: return '';
  }
}

export function renderCareersDoc(config, jobs, { preview = false, companyName = 'Daya Ventures' } = {}) {
  const cfg = sanitizeConfig(config);
  const pageBg = cfg.backgroundColor, pageText = cfg.textColor;
  const ctx = { pageBg, pageText, jobs, preview };
  const body = cfg.sections.map((s) => sectionHtml(s, ctx)).join('\n');
  const footer = `<div class="cp-foot"><span class="cp-badge">${svgIcon('check')} Hiring with <b>Daya Pipeline</b></span></div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Careers at ${esc(companyName)}</title>
<style>${CAREERS_CSS}</style>
</head>
<body>
<div class="cp-wrap" style="background-color:${pageBg}">
${brandHeader(companyName, pageText, preview)}
${body}
${footer}
</div>
</body>
</html>`;
}

// ---------- public job detail page ----------

export function publicJobPage({ config, job, formConfig, applied, error, values = {} }) {
  const cfg = sanitizeConfig(config);
  const pageBg = cfg.backgroundColor, pageText = cfg.textColor;
  const questions = Array.isArray(job.questions) ? job.questions : [];
  const v = (k) => esc(values[k] || '');
  // Application Form settings (per job): only visible fields are rendered; required adds the *.
  const fcDefault = { firstName: { visible: true, required: true }, lastName: { visible: true, required: true }, email: { visible: true, required: true }, linkedIn: { visible: true, required: true } };
  const fc = formConfig && typeof formConfig === 'object' ? formConfig : fcDefault;
  const vis = (k) => !fc[k] || fc[k].visible !== false;
  const req = (k) => !!(fc[k] && fc[k].visible !== false && fc[k].required);
  const field = (name, label, type = 'text', required = false, placeholder = '') => `
    <div class="cp-field">
      <label>${esc(label)}${required ? '<span class="req">*</span>' : ''}</label>
      <input type="${type}" name="${name}" value="${v(name)}" ${required ? 'required' : ''} ${placeholder ? `placeholder="${esc(placeholder)}"` : ''}>
    </div>`;
  const textarea = (name, label, required = false, placeholder = '') => `
    <div class="cp-field">
      <label>${esc(label)}${required ? '<span class="req">*</span>' : ''}</label>
      <textarea name="${name}" ${required ? 'required' : ''} placeholder="${esc(placeholder)}">${v(name)}</textarea>
    </div>`;
  const stdFields = [
    vis('firstName') || vis('lastName') ? `<div class="cp-frow">
            ${vis('firstName') ? field('firstName', 'First Name', 'text', req('firstName')) : ''}
            ${vis('lastName') ? field('lastName', 'Last Name', 'text', req('lastName')) : ''}
          </div>` : '',
    vis('email') ? field('email', 'Email', 'email', req('email')) : '',
    vis('linkedIn') ? field('linkedIn', 'LinkedIn URL', 'text', req('linkedIn'), 'https://www.linkedin.com/in/...') : '',
    vis('phone') ? field('phone', 'Phone', 'text', req('phone'), '+46 ...') : '',
    vis('personalWebsite') ? field('personalWebsite', 'Personal Website', 'text', req('personalWebsite'), 'https://...') : '',
    vis('education') ? textarea('education', 'Education', req('education'), 'Enter your education') : '',
    vis('workExperience') ? textarea('workExperience', 'Work Experience', req('workExperience'), 'Enter your work experience') : '',
    vis('fileUpload') ? `
          <div class="cp-field">
            <label>File Upload${req('fileUpload') ? '<span class="req">*</span>' : ''}</label>
            <input type="file" name="file" ${req('fileUpload') ? 'required' : ''}>
          </div>` : '',
  ].join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(job.publicTitle || job.title)}</title>
<style>${CAREERS_CSS}</style>
</head>
<body>
<div class="cp-wrap" style="background-color:${pageBg}">
  <div class="cp-jobhead">
    <a class="cp-alljobs" style="color:${pageText}" href="/daya-ventures">${svgIcon('chevron-left')} All Jobs</a>
    <a class="cp-brand" href="/daya-ventures">
      <img src="/assets/daya-logo.png" width="24" height="24" alt="Daya Ventures">
      <span style="color:${pageText}">Daya Ventures</span>
    </a>
    <a class="cp-applybtn" href="#apply">${svgIcon('pencil')} Apply</a>
  </div>
  <section class="cp-jobsec" style="background-color:${pageBg}">
    <div class="cp-jobinner">
      <div style="display:flex;flex-direction:column;gap:24px">
        <h2 class="cp-title" style="color:${pageText}">${esc(job.publicTitle || job.title)}</h2>
        <div class="cp-rich" style="color:${pageText};font-size:16px">${sanitizeRich(job.descriptionHtml || '')}</div>
      </div>
      <div class="cp-apply-card" id="apply">
        <h3>Job Application</h3>
        <p class="sub">Please fill out the form below to apply for this position.</p>
        ${applied ? '<div class="cp-flash">Your application has been submitted — thank you! We will be in touch.</div>' : ''}
        ${error ? `<div class="cp-flash err">${esc(error)}</div>` : ''}
        <form class="cp-form" method="post" action="/daya-ventures/${job.id}/apply" enctype="multipart/form-data">
          ${stdFields}
          ${questions.map((q, i) => `
          <div class="cp-field">
            <label>${esc(typeof q === 'string' ? q : (q && q.label) || '')}<span class="req">*</span></label>
            <textarea name="question${i + 1}" required placeholder="Enter your answer">${v('question' + (i + 1))}</textarea>
          </div>`).join('')}
          <button class="cp-submit" type="submit">Submit Application</button>
        </form>
      </div>
    </div>
  </section>
  <div class="cp-foot"><span class="cp-badge">${svgIcon('check')} Hiring with <b>Daya Pipeline</b></span></div>
</div>
</body>
</html>`;
}

// ---------- editor page ----------

export const EDITOR_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { background: #f5f6f8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #17181c; display: flex; flex-direction: column; }
a { text-decoration: none; color: inherit; }
.ed-top { display: flex; align-items: center; gap: 10px; background: #fff; border-bottom: 1px solid #e7e8ec; padding: 12px 20px; flex-shrink: 0; }
.ed-back { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; font-size: 18px; color: #4b5563; }
.ed-back:hover { background: #f1f2f5; }
.ed-org { font-weight: 600; font-size: 15px; }
.ed-spacer { flex: 1; }
.ed-visit { font-size: 13.5px; color: #374151; display: inline-flex; align-items: center; gap: 5px; padding: 8px 10px; border-radius: 8px; }
.ed-visit:hover { background: #f1f2f5; }
.ed-save { background: #17181c; color: #fff; border: 0; border-radius: 8px; height: 38px; padding: 0 18px; font-size: 13.5px; font-weight: 500; cursor: pointer; }
.ed-save:hover { background: #2b2c31; }
.ed-save:disabled { opacity: .55; cursor: default; }
.ed-layout { display: flex; flex: 1; min-height: 0; }
.ed-previewcol { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 0 8px 8px; }
.ed-prevlabel { text-align: center; color: #8a8f98; font-size: 13px; padding: 10px 0; }
.ed-prevbox { flex: 1; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04); }
.ed-prevbox iframe { width: 100%; height: 100%; border: 0; display: block; }
.ed-side { width: 440px; flex-shrink: 0; background: #f5f6f8; overflow-y: auto; padding: 20px 20px 40px; }
.ed-side h2 { font-size: 20px; margin: 0 0 4px; }
.ed-side .sub { color: #6b7280; font-size: 13.5px; margin: 0 0 18px; }
.acc { background: #fff; border: 1px solid #e7e8ec; border-radius: 10px; margin-bottom: 12px; }
.acc.shadowcard { box-shadow: 0 1px 2px rgba(0,0,0,.05); }
.acc-head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 16px; cursor: pointer; }
.acc-head .ttl { flex: 1; min-width: 0; }
.acc-head h3 { font-size: 14.5px; font-weight: 600; margin: 0; }
.acc-head p { font-size: 12.5px; color: #6b7280; margin: 2px 0 0; }
.acc-head .chev { color: #9ca3af; transition: transform .15s; margin-top: 2px; }
.acc.open .acc-head .chev { transform: rotate(180deg); }
.acc-body { display: none; padding: 2px 16px 16px; }
.acc.open .acc-body { display: block; }
.dragh { cursor: grab; color: #b3b8c2; padding: 2px 0; margin-top: 1px; }
.dragh:active { cursor: grabbing; }
.acc-menu { border: 0; background: transparent; cursor: pointer; color: #9ca3af; padding: 3px 5px; border-radius: 6px; font-size: 15px; line-height: 1; }
.acc-menu:hover { background: #f1f2f5; color: #17181c; }
.fld { margin-top: 12px; }
.fld > label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.fld input[type=text], .fld input[type=url], .fld input[type=email], .fld textarea, .fld select {
  width: 100%; padding: 9px 11px; border: 1px solid #dfe1e7; border-radius: 8px; font-size: 13.5px; font-family: inherit; background: #fff; color: #17181c; }
.fld textarea { min-height: 90px; line-height: 1.5; resize: vertical; }
.fld input:focus, .fld textarea:focus { outline: 2px solid #cdd8f6; border-color: #6d8df0; }
.fld .hint { font-size: 12px; color: #8a8f98; margin-top: 4px; }
.colorrow { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; }
.colorrow label { font-size: 13px; font-weight: 600; }
.colorctl { display: flex; align-items: center; gap: 6px; }
.swatch { width: 24px; height: 24px; border-radius: 999px; border: 1px solid #d5d7dd; cursor: pointer; padding: 0; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.resetic { border: 0; background: transparent; color: #b3b8c2; cursor: pointer; padding: 3px; border-radius: 6px; display: inline-flex; }
.resetic:hover { background: #f1f2f5; color: #c23434; }
.picker { position: absolute; z-index: 50; background: #fff; border: 1px solid #e7e8ec; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.14); padding: 12px; width: 224px; }
.picker input[type=color] { width: 100%; height: 44px; border: 1px solid #dfe1e7; border-radius: 8px; padding: 2px; cursor: pointer; background: #fff; }
.picker .hexrow { display: flex; gap: 8px; margin-top: 10px; }
.picker .hexrow input { flex: 1; padding: 7px 9px; border: 1px solid #dfe1e7; border-radius: 7px; font-size: 13px; font-family: ui-monospace, Menlo, monospace; text-transform: lowercase; }
.picker .presets { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.picker .presets button { width: 20px; height: 20px; border-radius: 999px; border: 1px solid #d5d7dd; cursor: pointer; padding: 0; }
.richwrap { border: 1px solid #dfe1e7; border-radius: 8px; overflow: hidden; background: #fff; }
.richtools { display: flex; gap: 4px; padding: 6px; border-bottom: 1px solid #eef0f3; background: #fafbfc; }
.richtools button { border: 1px solid #e3e5ea; background: #fff; border-radius: 6px; min-width: 28px; height: 26px; font-size: 13px; cursor: pointer; color: #17181c; }
.richtools button:hover { background: #eef2fd; }
.rich { min-height: 110px; padding: 10px 12px; font-size: 13.5px; line-height: 1.55; outline: none; }
.rich:empty::before { content: attr(data-placeholder); color: #9ca3af; }
.listitem { border: 1px solid #eceef2; border-radius: 8px; padding: 10px 12px; margin-top: 10px; background: #fbfcfd; }
.listitem .rowtop { display: flex; justify-content: flex-end; }
.listitem .rm { border: 0; background: transparent; color: #b3b8c2; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
.listitem .rm:hover { color: #c23434; background: #fdeaea; }
.additem { margin-top: 10px; border: 1px dashed #cfd3db; background: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: #374151; }
.additem:hover { background: #f4f5f8; }
.imgrow { display: flex; gap: 8px; align-items: center; }
.imgrow img { width: 64px; height: 40px; object-fit: cover; border-radius: 6px; border: 1px solid #e7e8ec; background: #f1f2f5; flex: 0 0 auto; }
.imgrow input { flex: 1; }
.ed-addwrap { position: relative; }
.ed-addblock { width: 100%; background: #17181c; color: #fff; border: 0; border-radius: 8px; height: 42px; font-size: 14px; font-weight: 500; cursor: pointer; }
.ed-addblock:hover { background: #2b2c31; }
.ed-addmenu { position: absolute; bottom: 48px; left: 0; right: 0; background: #fff; border: 1px solid #e7e8ec; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.14); padding: 6px; }
.ed-addmenu button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 9px 12px; border-radius: 7px; font-size: 13.5px; cursor: pointer; }
.ed-addmenu button:hover { background: #f1f2f5; }
.ed-toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #17181c; color: #fff; padding: 10px 18px; border-radius: 10px; font-size: 13.5px; box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 100; }
.ed-toast.show { opacity: 1; }
`;

export function careersEditorPage({ user, config, jobs }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Careers page · Daya Pipeline</title>
<style>${EDITOR_CSS}</style>
</head>
<body>
<div class="ed-top">
  <a class="ed-back" href="/overview" title="Back to dashboard">&#8249;</a>
  <span class="ed-org">Daya Ventures</span>
  <div class="ed-spacer"></div>
  <a class="ed-visit" href="/daya-ventures" target="_blank">Visit careers page <span aria-hidden="true">&#8599;</span></a>
  <button class="ed-save" id="ed-save">Save changes</button>
</div>
<div class="ed-layout">
  <div class="ed-previewcol">
    <div class="ed-prevlabel">Live preview</div>
    <div class="ed-prevbox"><iframe id="ed-preview" sandbox="" title="Live preview"></iframe></div>
  </div>
  <div class="ed-side">
    <h2>Careers page</h2>
    <p class="sub">Adjust the content and style of your public careers page.</p>
    <div id="ed-accordions"></div>
    <div class="ed-addwrap">
      <button class="ed-addblock" id="ed-addblock">Add block</button>
      <div class="ed-addmenu" id="ed-addmenu" hidden>
        <button data-add="text">Text section</button>
        <button data-add="values">Values section</button>
        <button data-add="photoCollage">Photo gallery</button>
        <button data-add="video">Video section</button>
        <button data-add="members">Members section</button>
      </div>
    </div>
  </div>
</div>
<div class="ed-toast" id="ed-toast"></div>
<script>window.__careersConfig = ${JSON.stringify(sanitizeConfig(config))}; window.__careersJobs = ${JSON.stringify(jobs.map((j) => ({ id: j.id, title: j.title })))};</script>
<script src="/careers-editor.js"></script>
</body>
</html>`;
}
