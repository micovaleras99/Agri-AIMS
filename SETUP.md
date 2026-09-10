# Agri-AIMS — MySQL backend setup

This guide walks through installing dependencies, creating the database, importing the relational schema, migrating legacy JSON demo data, and running the server.

## 1. Prerequisites

- Node.js 18+ recommended  
- MySQL Server 8.x (or compatible MariaDB) with a user that can create databases and tables  
- Git (optional)

## 2. Install Node packages

From the project root:

```bash
npm install
```

Packages include: `express`, `mysql2`, `dotenv`, `bcrypt`, `jsonwebtoken`, `cors`, `express-async-errors`, `ejs`, `morgan`, and `nodemon` (dev).

## 3. MySQL: create database and schema

Log into MySQL and create an empty database (name should match `DB_NAME` in `.env`):

```sql
CREATE DATABASE agri_aims CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Import the schema (creates tables `applicants`, `farms`, `documents`, `reports`, `users` with keys and timestamps):

```bash
mysql -u root -p agri_aims < database/schema.sql
```

Optional: `database/seed.sql` only prints a reminder; real demo data comes from the migration script.

### Migrations on an existing database

`schema.sql` already contains everything below — these are only for a database created before the change:

```bash
npm run migrate:sql -- database/migrations/002_chat.sql
npm run migrate:sql -- database/migrations/003_location_hierarchy.sql
npm run migrate:sql -- database/migrations/004_admin_farmer_registration.sql
npm run migrate:sql -- database/migrations/005_barangay_duplicate_names.sql
npm run migrate:sql -- database/migrations/006_notifications.sql
npm run migrate:sql -- database/migrations/007_services.sql
npm run migrate:sql -- database/migrations/008_compliance.sql
npm run migrate:sql -- database/migrations/009_elearning.sql
npm run migrate:sql -- database/migrations/010_assessment_responses.sql
npm run migrate:sql -- database/migrations/011_document_files.sql
npm run migrate:sql -- database/migrations/012_lsa2.sql
npm run migrate:sql -- database/migrations/013_assistance.sql
npm run migrate:sql -- database/migrations/014_disqualification_declaration.sql
npm run migrate:sql -- database/migrations/015_ati_website_source.sql
```

Migrations `016`–`032` were added later and follow the same pattern — run any your
database predates, in order. Two are worth calling out: `031_remove_assistance.sql`
drops the discontinued Provision-of-Assistance tables (and `documents.assistance_id`),
and `032_direct_message_foreign_keys.sql` adds the direct-message foreign keys. On a
database created before `031`, the earlier `013`/`024`/`025` assistance migrations are
undone by `031`, so a fresh install can skip all four.

`migrate:sql` runs the file through the `mysql2` driver the project already depends on, so it works whether or not the
`mysql` command-line client is on your PATH — on Windows it usually is not, unless you added it yourself. Statements that
were already applied are reported as `skip`, so re-running a migration is safe.

If you would rather use the command-line client, XAMPP ships one:

```bat
C:\xampp\mysql\bin\mysql.exe -u root -p agri_aims < database\migrations\003_location_hierarchy.sql
```

### Load the location reference data

Region → Province → Municipality/City → Barangay drives the address selectors, so it must be populated before the forms are useful:

```bash
npm run seed:locations
```

The reference data is the official Philippine Standard Geographic Code hierarchy. Fetch it, then load it:

```bash
npm run fetch:psgc                    # Region V (Bicol) — writes data/psgc.json
npm run seed:locations -- --strict
```

That gives Region V complete: 6 provinces, 7 cities, 107 municipalities, 3,471 barangays. `--strict` removes any locally
seeded placeholder that is not in the official list, so the dropdowns only ever offer real locations; records that pointed
at a placeholder have their barangay cleared and can be set again from the form.

Other regions: `npm run fetch:psgc -- 040000000` (CALABARZON), or `npm run fetch:psgc -- all` for the whole country.
Region codes are listed at the top of `scripts/fetch-psgc.js`.

The data comes from <https://psgc.gitlab.io/api>, a free static mirror of the PSA publication. It is community-maintained,
so before an official submission check the counts against the current PSGC release on psa.gov.ph.

Without `data/psgc.json`, the seeder falls back to the locations found in `data/applicants.json` and `data/farms.json` —
enough to start the app, but not a real location list.

Also worth knowing: a municipality can contain two barangays with the same name (six such pairs exist in Region V), so
`(municipality_id, name)` is deliberately not unique on the `barangays` table. Migration 005 corrects that on databases
created before this was understood.

## 4. Environment variables

Copy the example file and edit values:

```bash
copy .env.example .env
```

On macOS/Linux use `cp .env.example .env`.

Generate a session secret and paste it into `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Important:** `.env` is gitignored and must never be committed. `JWT_SECRET` signs both API tokens and the browser session cookie — a shared or default value lets anyone forge an admin session. Set `DB_PASSWORD` if your MySQL user has a password.

## 5. Import existing JSON data into MySQL

The script **truncates** all five tables, then loads `data/*.json`, hashing user passwords with bcrypt.

```bash
npm run migrate -- --force
```

The `--force` flag is required: without it the script refuses to run, and it always refuses when `NODE_ENV=production`.

After migration you can log in through the REST API with the same passwords as in the old JSON (for example `admin123` for `admin@ati-bicol.da.gov.ph` — change these in production).

## 6. Start the application

```bash
npm start
```

For auto-reload during development:

```bash
npm run dev
```

Open the site at `http://localhost:3000` (or your `PORT`) and **sign in**. Every page except the landing page and `/directory` requires a session; visiting one while signed out redirects to the login page and returns you there afterwards.

Sign out with the Logout item in the user menu (`GET /logout`), which clears the session cookie.

### Optional: the development role switcher

`?role=evaluator` signs you in as that role **without a password**. It is off by default and ignored entirely when `NODE_ENV=production`. Enable it only for local work:

```
ALLOW_ROLE_SWITCH=true
```

Leave it `false` for any demo or deployment that other people can reach.

## 7. REST API and JWT

Base URL: `http://localhost:3000/api`

### Register (creates applicant-role user)

**Request**

`POST /api/auth/register`  
`Content-Type: application/json`

```json
{
  "firstName": "Ana",
  "lastName": "Garcia",
  "email": "ana@example.com",
  "password": "Str0ng!Pass",
  "phone": "09170000000",
  "region": "Region V"
}
```

**Response** `201`

```json
{
  "success": true,
  "data": {
    "user": { "id": 5, "firstName": "Ana", "lastName": "Garcia", "email": "ana@example.com", "role": "applicant", "...": "..." },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Login

**Request**

`POST /api/auth/login`

```json
{
  "email": "admin@ati-bicol.da.gov.ph",
  "password": "admin123"
}
```

**Response** `200`

```json
{
  "success": true,
  "data": {
    "user": { "id": 1, "role": "admin", "...": "..." },
    "token": "eyJ..."
  }
}
```

### Users CRUD (JWT required)

Send header: `Authorization: Bearer <token>`

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/users` | **Admin only.** Query: `page`, `limit`, `search`, `role`, `sort` (`id`,`email`,`first_name`,`last_name`,`role`,`created_at`), `order` (`asc`/`desc`). |
| GET | `/api/users/:id` | Admin or the same user id. |
| POST | `/api/users` | **Admin only.** Body includes `password` (strength rules apply). |
| PUT | `/api/users/:id` | Admin (full fields) or self (profile fields; no role/farm/application linkage for non-admin). |
| DELETE | `/api/users/:id` | **Admin only.** Cannot delete own account through this endpoint. |

**Example: list users (admin)**

```http
GET /api/users?page=1&limit=10&sort=created_at&order=desc HTTP/1.1
Host: localhost:3000
Authorization: Bearer <token>
```

**Example response**

```json
{
  "success": true,
  "data": [ { "id": 1, "email": "admin@ati-bicol.da.gov.ph", "role": "admin", "...": "..." } ],
  "meta": { "page": 1, "limit": 10, "total": 4, "totalPages": 1 }
}
```

### Location reference data (public, no JWT)

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/locations/regions` | All regions |
| GET | `/api/locations/regions/:regionId/provinces` | Provinces in a region |
| GET | `/api/locations/provinces/:provinceId/municipalities` | Municipalities and cities in a province |
| GET | `/api/locations/municipalities/:municipalityId/barangays` | Barangays in a municipality/city |
| GET | `/api/locations/barangays/search?q=` | Barangay type-ahead (minimum 2 characters) |

These are public because the registration form needs them before anyone has an account.

## 8. Notifications, services, compliance and e-learning

### Compliance requirements

```bash
npm run seed:compliance
```

Loads the 18 requirements the monitoring module checks against. Each one carries the part of the
LSA Guidelines it comes from, and appears on every farm's checklist at `/compliance/farm/:id`.
Re-running refreshes the wording without losing recorded checks.

### e-Learning monitoring (RSC-03)

The ATI e-Learning site (<https://elearn.e-extension.gov.ph>) runs Moodle, and its Web Services
REST endpoint is live — a request with an invalid token answers `{"errorcode":"invalidtoken"}`
rather than 404, which means the API is enabled and only needs credentials.

**That token can only be issued by the site's administrator** (Site administration → Plugins →
Web services → Manage tokens). Once you have one:

```
ELEARNING_SOURCE=moodle
MOODLE_URL=https://elearn.e-extension.gov.ph
MOODLE_TOKEN=your-token-here
# Optional: the Site announcements forum id, read from the forum's URL
MOODLE_ANNOUNCEMENT_FORUM_ID=
```

Then check for new items:

```bash
npm run sync:elearning              # fetch, store, post to chat, notify
npm run sync:elearning -- --dry-run # report what is new, change nothing
```

Schedule that command however the deployment allows (Windows Task Scheduler, cron, or a hosting
platform's scheduler). Running it twice is harmless: an item already recorded is skipped, never
re-posted — the unique key on `(source, external_id)` enforces that at the database.

Without a token the system runs in **manual mode**: staff add announcements at `/admin/elearning`
and they follow exactly the same path — recorded, posted to the `#e-learning` Community Chat
channel, members notified. HTML scraping is deliberately not implemented.

### Chatbot language model (RSC-06)

The AgriBot widget answers questions about the LSA programme. It is **optional**: with no key
it answers from the system's own LSA knowledge (definitions, requirements, steps, help topics,
compliance rules) using keyword retrieval, at no cost. Set a key and the same knowledge is
handed to a language model, which phrases the answer and handles reworded questions — but it is
told to answer **only** from that knowledge and to cite it, never from its own training, so no
applicant data is ever sent to the model.

```
AI_BASE_URL=https://api.openai.com/v1     # any OpenAI-compatible provider
AI_API_KEY=sk-xxxxxxxx
AI_MODEL=gpt-4o-mini
```

Requests are capped at 40 questions per 5 minutes per IP, so a configured model cannot be run
up into a large bill. If the key is missing, expired or out of credits, the chatbot silently
falls back to keyword answers — a bad key is never an outage.

## 9. Administrator: registering a farmer

`/admin/farmers/new` (admin role only) creates the applicant record and the farmer's login account in one transaction, capturing the barangay, RSBSA/NCFRS number, and farm profile. Choose "Generate a temporary password" to have the system produce one — it is displayed once on the confirmation screen and stored only as a bcrypt hash, so copy it before leaving the page.

Self-registration at `/` is unchanged; both paths share `services/farmerRegistration.js`.

## 10. Project layout (high level)

- `config/database.js` — `mysql2/promise` pool and `query()` helper (prepared statements, optional query logging).  
- `database/schema.sql` — DDL.  
- `scripts/migrate-json-to-mysql.js` — JSON → MySQL import.  
- `models/` — SQL only.  
- `controllers/` — HTTP / orchestration for API and dashboard.  
- `routes/` — Express routers (web + `routes/api`).  
- `middleware/` — JWT auth, role context for EJS, errors, request logging.  
- `utils/` — logger, validation, case conversion.

## 11. Logging

With `LOG_TO_FILE=true`, logs are appended under `logs/` (`request.log`, `error.log`, `query.log` when DB logging is enabled).

## 12. Security reminders

- Never commit `.env` — it is gitignored; `.env.example` is the template to share.
- Use a strong `JWT_SECRET` and HTTPS in production.
- Replace demo passwords after migration. The login page currently pre-fills demo
  credentials for all four roles; remove that before any public deployment.
- Keep `ALLOW_ROLE_SWITCH=false` outside local development.
- The session cookie is set server-side as `HttpOnly; SameSite=Lax` (plus `Secure`
  when `NODE_ENV=production`), so page scripts cannot read it.
- Page routes are gated by `middleware/requireAuthPage.js`; API routes by `authenticateJWT`.
- All SQL in this codebase goes through `pool.execute` with `?` placeholders.
- CSRF: every form posts a `_csrf` token (`middleware/csrf.js`, double-submit cookie).
  Browser `fetch` calls send it as `x-csrf-token`. Requests authenticated with
  `Authorization: Bearer` skip the check — a browser cannot attach that header cross-site.
  `/api/auth/login` and `/api/auth/register` are exempt (no session to protect yet) and
  are rate limited instead.
- Rate limits (`middleware/rateLimit.js`): 10 failed sign-ins per 15 minutes, 5 registrations
  per hour, 40 chatbot questions per 5 minutes (the chatbot calls a paid model), and 600 other
  API requests per 15 minutes. Counters are per-process and in memory — behind more than one
  instance, move them to a shared store.
- Security headers via `helmet`, including a Content-Security-Policy naming the CDNs the
  pages actually use. Behind a reverse proxy, set `TRUST_PROXY` so the rate limiters see the
  real client IP rather than the proxy's.
- The CSP allows no inline scripts or `onclick` handlers (`script-src` uses a per-request
  nonce, `script-src-attr` is `'none'`). Page behaviour lives in `/public/js` and is wired
  through `data-*` attributes by `public/js/actions.js`.
