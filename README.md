# ATS

A multi-board applicant tracking system — kanban hiring pipeline, careers page builder and job-board publishing — built on **Cloudflare Workers + D1** with **zero npm dependencies** (server-rendered HTML and vanilla JS, no build step).

## Features

- **Kanban pipeline** — drag-and-drop candidate cards across per-job columns; favourites, reject and interview suggestions; column management.
- **Candidates** — deduplicated candidate list with tags, inline editing, search, filters, sorting and pagination.
- **Jobs** — create, edit, publish, unpublish and close job posts; per-job settings.
- **Job settings** — General, Notifications, Job Boards (Monster / Jooble / Careerjet / Indeed / LinkedIn) and a per-job Application Form builder.
- **Careers page builder** — public careers site with a live-preview editor: global and per-section colors, hero, open positions, text, values, photo gallery, video and team-member blocks with drag-to-reorder.
- **Public job pages & apply flow** — applications land straight on the kanban board, with per-job custom questions and configurable form fields.
- **Email log** — outbound notifications and interview suggestions are recorded (demo mode).

## Stack

- Cloudflare Workers — a single worker, ES modules
- Cloudflare D1 (SQLite) — schema in `schema.sql`, migrations in `migrations/`
- Vanilla JS + CSS — no frameworks, no dependencies
- PBKDF2 password hashing (WebCrypto), session cookies, CSRF-protected forms

## Layout

```
src/
  index.js                  worker entry: router, auth, APIs, client script
  db.js                     data-access layer (D1)
  views.js                  server-rendered pages (shell, board, lists)
  careers.js                public careers page + job detail / apply flow
  careers-editor-client.js  careers page editor (live preview)
  logo.js                   embedded workspace logo
scripts/seed.mjs            demo data seeder
migrations/                 incremental SQL migrations
schema.sql                  full schema
```

## Local development

```bash
npm i -g wrangler
wrangler dev          # start the worker locally
wrangler d1 execute <db> --local --file=schema.sql
node scripts/seed.mjs
```

The seed script expects a `boards-all.json` export that is intentionally **not included** in this repository (it contains personal data).

## Screenshots

| Jobs | Careers page | Careers editor |
| --- | --- | --- |
| ![Jobs](screenshots/jobs-list.png) | ![Careers page](screenshots/careers-page.png) | ![Careers editor](screenshots/careers-editor.png) |
