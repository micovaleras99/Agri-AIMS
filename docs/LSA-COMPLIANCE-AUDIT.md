# Agri-AIMS — LSA Guidelines Alignment & RSC Audit

**Audited system:** `agri-aims` (ETECHNICS capstone)
**Primary reference:** *Guidelines on the Enhancement of Learning Site for Agriculture I and II (LSA I and II)* — DA-ATI, 44 slides (cited below as **PDF p.N**)
**Audit date:** 2026-08-20
**Method:** direct inspection of every non-`node_modules` file (84 files), plus live checks of the ATI e-Extension and ATI main websites for RSC-03/RSC-07.

Every claim below is tied to a file and line. Where something could not be established from the code, it says **"Cannot be verified from the provided code."**

---

## Phase 1 status — applied 2026-08-20

| Fix | Status |
|---|---|
| SEC-01 admin fallback for anonymous visitors | ✅ fixed — `middleware/roleContext.js` rewritten; guests are `role: 'guest'` |
| SEC-01b `req.app.locals` cross-request identity leak | ✅ fixed — state moved to `res.locals` |
| SEC-02 `?role=` switcher | ✅ gated behind `ALLOW_ROLE_SWITCH=true` + non-production |
| Page-level auth gate | ✅ added — `middleware/requireAuthPage.js`, mounted on all 7 app routers |
| Working logout | ✅ added — `GET /logout` |
| SEC-03 JS-readable session cookie | ✅ fixed — server sets `HttpOnly; SameSite=Lax` (+`Secure` in production) |
| SEC-05 committed secret | ✅ `.gitignore` + `.env.example` added, `JWT_SECRET` rotated |
| DB-01 `documentModel.create()` insertId | ✅ fixed — uses `pool.execute` |
| DB-05 truncating migration script | ✅ guarded — requires `--force`, blocked in production |
| Demo credentials in the login page | ✅ fixed — role cards and pre-filled values render only when `ALLOW_ROLE_SWITCH=true` |
| SEC-04 CSRF | ✅ fixed — `middleware/csrf.js`, double-submit cookie; all 13 EJS forms post a `_csrf` token, browser fetch sends `x-csrf-token`, Bearer-token API clients are unaffected, login/register exempt and rate limited instead |
| SEC-06 login rate limiting | ✅ fixed — `middleware/rateLimit.js`: 10 failed sign-ins / 15 min (successes do not count), 5 registrations / hour, 600 other API calls / 15 min |
| SEC-08 security headers | ✅ fixed — `helmet` with a CSP naming only the CDNs the pages use; `X-Powered-By` removed, `frame-ancestors 'none'`, `nosniff`, HSTS in production only |
| SEC-09 permissive CORS | ✅ fixed — `origin` was `process.env.CORS_ORIGIN || true`, and `true` reflects whatever `Origin` the caller sends; with `credentials: true` that let any website make authenticated cross-origin requests carrying a visitor's session cookie. `CORS_ORIGIN` was unset, so this was the live configuration. Cross-origin browser access is now off unless `CORS_ORIGIN` names an allowlist (comma-separated). The app's own pages are same-origin and unaffected, and Bearer-token API clients are not governed by CORS |
| SEC-10 stack traces | ✅ fixed — the test was `NODE_ENV !== 'production'`, so an unset `NODE_ENV` (the normal state on a server nobody configured) returned full stack traces and file paths to API callers. Traces are now returned only when `NODE_ENV` is exactly `development`, and are written to the server log in every environment |
| CSP `'unsafe-inline'` | ✅ removed from `script-src` — `app.js` issues a per-request nonce and all 14 inline `<script>` blocks carry it, so an injected `<script>` is now refused. ⚠️ `script-src-attr 'unsafe-inline'` **remains**: the 74 inline `onclick=`/`oninput=` handler attributes cannot carry a nonce, and only rewriting them as `addEventListener` lifts it. Verified per-request and matching the header on every page |
| CSP `script-src-attr` regression, since fixed | ✅ fixed — helmet defaults `script-src-attr` to `'none'`, which blocks every inline handler attribute. That silently broke the geo-tagging map (`oninput="updateMapPreview()"`, `onclick="useCurrentLocation()"` and the geo-tag panel toggle) plus 35 inline handlers elsewhere. `app.js` now sets `scriptSrcAttr: ["'unsafe-inline'"]`, and it lifts with the same refactor as the row above |
| `Referrer-Policy` regression, since fixed | ✅ fixed — helmet defaults `Referrer-Policy` to `no-referrer`, which strips the `Referer` header from every outgoing request. OpenStreetMap's tile usage policy **requires** a Referer and answers a stripped one with a 403 "Access blocked" tile, so every map in the system rendered as blocked tiles. `app.js` now sets `strict-origin-when-cross-origin`, the modern browser default: other sites receive only the origin, never the path or query, so applicant and farm ids are still not leaked |

The security work was verified against the running app (23 checks): CSP and the other headers present, `X-Powered-By` gone, a cookie-authenticated POST refused with no token and with a forged token, accepted with the real one via both the form field and the header, JSON refusals for API callers, Bearer-token writes unaffected, forms rendering the current token, failed sign-ins blocked after 11 attempts with a correct password also refused while limited, and normal browsing untouched. All 15 pages still render.

**System answers were verified with 20 checks that assert the ANSWER, not merely that something matched** — the original defect was a match with the wrong content, which a "did it match?" test would have passed. Sixteen real questions are checked against the text they must contain, the guideline answers are re-checked to prove they were not displaced, and an unrelated question ("the price of rice in Manila") is still refused rather than answered from a loose keyword.

**The model layer was verified with 20 checks against a stand-in provider**, so no key was needed and nothing was spent. The grounding is asserted directly on the outgoing request: the retrieved context is present, the real figure is in that context rather than left for the model to recall, and the instruction to answer only from it is included. A token cap is sent so a runaway reply cannot run up a bill, and `describe()` never leaks the key. The five failures a free tier really produces — 401, **402 credits exhausted**, 429, an empty reply, and a provider that never answers — each fall back to retrieval without throwing.

**The scheduler was verified with 13 checks** against a stubbed sync, so nothing touched the network: it stays off without the variable, refuses a non-numeric or zero interval rather than guessing, raises 1 minute to the 15-minute floor *and says so*, records the last run for the admin page, swallows and reports a failing run instead of throwing, and — the one that matters most — skips an overlapping tick so a slow run cannot post the same article twice. Startup and the admin page were then confirmed on a running server: `Article sync: every 15 min`.

**Chat links were verified with 16 checks**, half of them adversarial: a `<script>` tag in a message stays escaped, `javascript:` and `data:` are never linkified, a quote inside a URL cannot break out of the href attribute, and an `<img onerror=…>` appended to an address stays text. Clicking was then confirmed in a real browser — the anchor opened the ATI article in a second tab, and the target URL answers HTTP 200.

**The ATI website reader was verified with 16 checks**, most of them offline against a saved fragment so the suite does not depend on the network, plus one live request to confirm the page still parses (50 articles). Two defects were found while building it. The listing renders **newest first**, but the sync treats the tail of the array as most recent, so the first version would have posted the five *oldest* articles; the driver now hands back oldest-first. And `elearning_articles.source` is an **ENUM** that did not include `ati_website` — MySQL is not in strict mode here, so it silently coerced all 50 rows to an empty string rather than failing. Migration 015 widens the enum and re-attributes the affected rows. A first run against 50 existing articles would also have posted 50 messages at once; the newest few are posted and the rest recorded as seen, so nothing is published retrospectively.

**The application was finally driven by hand in a browser, not just over HTTP.** Signed in through the login form, navigated by the new grouped dropdowns, opened an application, opened its edit form, opened the notification panel and asked the chatbot a question. Everything built in this session renders and behaves: the tracker reads Briefing → Self-Assessment → Submit Documents, the Operator Qualifications, Disqualification, Farm Area and Basic Facilities cards all appear, the RSBSA field is present and labelled on the edit form, the notification panel opens on screen, and the chatbot answered "Calamity Assistance: up to ₱100,000" with its citation. This mattered because most of the defects found today were of the "renders fine, does nothing" kind that a status-code crawl cannot see.

**The RSBSA field was verified with 11 checks**, the important pair being that an edit updates it and an *unrelated* edit leaves it alone — the second would have failed before, because the omitted column meant every edit blanked it. Placeholder and parameter counts in `update()` were re-verified after the change (18 and 18).

**Every browser-side constraint was then checked against the server.** A second scanner listed each `required`, `min`, `max`, `pattern` and typed input on the eight native form actions, and each was traced to its handler. Most were already enforced — the report period, the assistance cap and kind, the e-learning title, and the compliance status, which `complianceModel` coerces to `pending` when it is not one of the five known values. Two were not: the Step 5 coordinate check and the farm area on edit, both fixed above. **12 checks** cover the result, including that a longitude of 999 posted directly to Step 5 stores nothing at all rather than a latitude on its own.

**A sweep of every form found this defect three more times.** A scanner over all 40 templates looked for controls inside a native `<form>` with no `name` attribute — the browser never submits those, so `required` gates the button and nothing else. Besides the three certifications on the briefer, it found the confirmation checkboxes on endorsement and certificate issuance. The 13 further hits were all on the login and registration forms, which are submitted by JavaScript reading elements by id, where a missing name is correct; the scanner now skips forms with no `action` so it stays useful. After the fixes it reports clean. **Confirmations were then verified with 13 checks**, including that an unconfirmed certificate POST writes neither a certificate number nor an issue date.

**The disqualification declaration was verified with 15 checks.** The one that matters most bypasses the browser entirely: a direct POST carrying only a signature is refused and the application stays on step 1 with nothing recorded, which is exactly what the old `required`-only form allowed through. Ticking two of the three is still refused. A complete declaration advances the application and stores both the flag and the date. On the page, a declared application reads "Declared eligible" while an older one reads "Not declared" rather than being silently treated as eligible. Fixing this also exposed that `SELECT_BASE` in `applicantModel` is an explicit column list — the new columns were stored correctly but never read back until they were added to it.

**The organisation config was verified with 11 checks**, including one that would have been easy to miss: a grep asserting no director name survives in the routes or the two document templates caught a **third** hardcoded copy in `step7_issued_by` that the first pass left behind. An override was then proved end to end in a child process (so `dotenv` could not mask it) and against the running app — with `ORG_DIRECTOR` and `ORG_OFFICE` set, both the endorsement letter and the certificate render the new name and office, the old name appears nowhere, and a variable left unset keeps its default.

**The minimum-area rule was verified with 21 checks.** Both exemptions behave (a 50 sq.m. urban plot passes, half a hectare fails for Coco-LSA), the boundary is inclusive as the guidelines word it ("at least"), and — the case most likely to cause a false accusation — a *missing* area returns null rather than false, so "not recorded" never reads as "too small"; the same holds for an empty string, a zero and unparseable input. End to end, a 400 sq.m. registration was warned about, still recorded, and shown on the application page as below minimum with the shortfall and the briefer citation. All nine existing applications were re-checked against the rule and every one already complies.

**The assessment work was verified with 22 checks against the live database.** A throwaway application was created, Step 2 submitted with a deliberate subset ticked, and Step 5 submitted with a different subset: all 21 step-2 rows and all 12 step-5 rows were stored including the unticked ones, the `facility` keys mapped correctly, the question text was stored beside each answer, and the existing `step2_self_assessment_score` came out identical to the old arithmetic (76% for 16 of 21). The page rendered the Field Validation Report, the Basic Facilities table and the self-assessment detail, and showed a facility the TWG did not find as "Not present". Re-submitting a step replaced its answers rather than accumulating them, and deleting the application cascaded the answers away. The throwaway record was removed and the database returned to 8 applicants / 4 users.

**SEC-09 and SEC-10 were verified with 11 checks.** For CORS the app was booted twice: with no allowlist a request carrying `Origin: https://evil.example` came back with no `Access-Control-Allow-Origin` at all while the endpoint still answered 200, and same-origin requests were unaffected; with `CORS_ORIGIN` set to two comma-separated origins each was echoed correctly and a third, unlisted origin was still refused. For stack traces the error middleware was driven directly with `NODE_ENV` unset, `production`, `staging` and `development` — only `development` returns a trace, and the other three return the generic "Internal server error" with no internals. The 404 page interpolates the requested URL through EJS `<%= %>`, which escapes it, so that reflection is not an injection point.

Verified with a stubbed-DB smoke test: all 7 protected routers redirect guests to `/?auth=required`, `POST /applicants/delete/:id` and `POST /accreditation/:id/step/7` no longer reach a handler, `?role=admin` no longer elevates, and `/`, `/directory`, `/logout` stay reachable. The login page renders no credentials with the flag off.

## Phase 2 status — applied 2026-08-20

| Fix | Status |
|---|---|
| **RSC-01** Region → Province → Municipality → Barangay hierarchy | ✅ built — 4 reference tables (`003_location_hierarchy.sql`), `barangay_id` FK on applicants/farms/users, `models/locationModel.js`, 5 endpoints under `/api/locations`, cascading selector partial reused by the application form, the registration form, and the admin form |
| **RSC-01** seeding | ✅ `npm run seed:locations` — imports `data/psgc.json` when present, otherwise seeds from the project's own records, then backfills `barangay_id` from address text |
| **RSC-02** Admin registers farmers | ✅ built — `/admin/farmers/new`, admin-only, creates the applicant record and the login account in one transaction via `services/farmerRegistration.js` (now shared with self-registration); captures barangay, RSBSA/NCFRS number, farm profile and status; optional generated password shown once |
| Supporting schema | ✅ `004_admin_farmer_registration.sql` adds `users.created_by_admin`, `users.is_active`, `applicants.rsbsa_number` |
| **RSC-01** official location data | ✅ complete Region V loaded from the PSGC: 6 provinces, 7 cities, 107 municipalities, 3,471 barangays. `npm run fetch:psgc` pulls it; `npm run seed:locations -- --strict` loads it and drops any non-official placeholder |
| Barangay uniqueness defect | ✅ fixed — `005_barangay_duplicate_names.sql`. A municipality can hold two barangays with the same name (6 such pairs in Region V); the original UNIQUE key silently dropped the second of each |
| Notifications backend | ✅ built — `006_notifications.sql`, `models/notificationModel.js`, `/api/notifications`, live navbar dropdown (`public/js/notifications.js`). The hardcoded sample list is gone; 9 real events now emit notifications (each accreditation step, returned documents, failed validation, certificate issued, document submitted, account created by admin) |
| **RSC-04** Service monitoring | ✅ built — `007_services.sql` (`services` + `service_participants`), the five service types taken from the LSA II components; `/services` catalogue with filters, staff create/edit, members enrol, staff record application status, attendance and completion |
| **RSC-05** Compliance monitoring | ✅ built — `008_compliance.sql`, 18 requirements seeded by `npm run seed:compliance`, **each citing the section of the guidelines it comes from**; `/compliance` overview with computed scores and `/compliance/farm/:id` checklist with full check history; findings notify the operator. The fabricated operator-dashboard panel now reads these real checks |
| **RSC-03** e-Learning monitoring | ✅ built — `009_elearning.sql`, `services/elearningSource.js` (Moodle Web Services driver + manual driver), `services/elearningSync.js` (detect → dedupe → store → post to `#e-learning` → notify), `npm run sync:elearning` for scheduling, and `/admin/elearning` for manual entry and on-demand runs. Duplicate posting is prevented by a unique key, not by in-memory state |
| Date off-by-one defect | ✅ fixed — `config/database.js` now returns DATE columns as strings. MySQL DATE values were being converted to local-midnight `Date` objects and then formatted with `toISOString()`, which in UTC+8 rendered **every date one day early** across farms, reports, applicants and services |
| Two competing intake forms | ✅ consolidated — `/applicants/add` created an application row with no login and no RSBSA number, and was open to `applicant`, so a farmer who already had an application from signing up could create a second, unlinked one for themselves. Both routes now redirect to `/admin/farmers/new`, which carries a **"Create a login account for this farmer"** checkbox: ticked (the default) it behaves exactly as before, unticked it records the application without an account and without requiring an email address — the case of a farmer who has none. `services/farmerRegistration.js` grew an optional-account branch; self-registration is unchanged |
| **LSA-08** Minimum farm area never enforced | ✅ built — the floor was printed as prose in the briefer and on two checklist labels, but nothing ever compared it against `farm_area`: a 400 sq.m. plot could be accredited without a warning. `config/farmEligibility.js` now computes the requirement per applicant, including both exemptions the guidelines give — urban and peri-urban agriculture has no minimum, Coco-LSA needs a full hectare. The application page shows a **Farm Area Requirement** card citing the briefer, and registration reports a shortfall. It warns rather than refusing: an application received on paper still has to be recorded, and the shortfall belongs in front of staff rather than in the way |
| **LSA-04** Endorsing director hardcoded | ✅ built — the Regional Director's name was typed into the endorsement route and, worse, directly into the **certificate template** the farmer receives, with a third copy stored as `step7_issued_by`. The office name and both addresses were scattered across half a dozen files. `config/organization.js` now holds all of it, and every value is overridable by environment variable (`ORG_DIRECTOR`, `ORG_OFFICE`, `ORG_ADDRESS`, …) so a change of director is a deployment setting rather than a template edit. Deliberately **not** a `settings` table: these change once every few years, and a table would mean a settings screen to build and maintain — add one only if ATI wants staff editing this without a deploy |
| **LSA-20** Disqualification never actually asked | ✅ built — **the three certifications on the briefer page had an `id` but no `name`**, so not one of them was ever submitted. The browser's `required` attribute gated the button and nothing more: a direct POST signed the briefer with no declaration at all, and the database had nowhere to record one. `014_disqualification_declaration.sql` adds `not_disqualified` and `disqualification_declared_at`, the three boxes now submit, the server refuses to advance unless all three are ticked, and the application page shows the declaration with its date. `NULL` means *never asked* and renders as "Not declared" — deliberately not conflated with "declared eligible", which is what every application signed before this change is |
| Confirmations on endorsement and certificate issuance | ✅ fixed — the same `id`-without-`name` defect sat on `confirmEndorse` (step 6) and `confirmCert` (step 7). A direct POST **endorsed an application to ATI Central Office, or issued the official certificate, with nothing confirmed**. Both now submit and are required server-side; a refusal redirects with `?error=confirm` and the page explains it. A sweep of every native form found no others |
| Query-string banners never rendered | ✅ fixed — views guard their success and error alerts with `typeof query !== 'undefined'`, but `query` was only passed by the newer routes. On the application page that meant the geo-tag success alert, the invalid-coordinates alert and the update confirmation **had never once appeared** — every geo-tag looked silently ignored. `res.locals.query` is now set once in `middleware/roleContext.js`, so every view has it |
| Coordinate rule enforced on one axis only | ✅ fixed — the geo-tag route rejected a point outside the Philippines on both axes, but the Step 5 field validation checked **latitude only**, so a TWG inspection could store a longitude anywhere on Earth. The rule existed twice and the two copies disagreed. `utils/validation.js` now holds `isWithinPhilippines()` and both routes call it |
| Negative farm area accepted on edit | ✅ fixed — `parseInt("-5")` is truthy, so `parseInt(...) \|\| existing` let a negative area through, which would then make the new minimum-area rule report a nonsensical shortfall. Clamped at zero |
| `favicon.ico` 404 on every page | ✅ fixed — the browser console logged a failed request on every single page load, which is the sort of thing a panel notices. `header.ejs` now points at the existing site logo rather than adding an asset |
| **RSC-03** ATI Bicol website → community chat | ✅ built — the panel asked for ATI Bicol posts to appear in chat automatically. The site was inspected first, as the brief requires: **no `robots.txt` (404), no RSS, no sitemap, no JSON:API, and no feed declared in the markup** — `?_format=json` answers 406, so Drupal's REST layer exists but is not enabled. It is Drupal 9 / Varbase and renders the article list server-side, so `services/atiWebsite.js` parses that listing. **One request per run**, listing only, with an identifying User-Agent and a contact address. Articles post to `#region-v-bicol` through the pipeline already built for RSC-03, so dedupe is by unique key and nothing is ever posted twice. `ELEARNING_SOURCE=ati` turns it on |
| URLs in chat were not clickable | ✅ fixed — the community chat escaped message bodies for safety, which also meant a posted link rendered as plain text: readers had to select and copy it. Messages are now escaped **first** and only then linkified, so a `<script>` a sender types stays visible text while a genuine address becomes an anchor. Only `http` and `https` are matched — never `javascript:` or `data:` — and links carry `target="_blank"` with `rel="noopener noreferrer"` so the opened page cannot reach back into the session |
| The sync still needed a human to run it | ✅ automated — the panel asked for posts to appear **automatically**, and `npm run sync:elearning` is not that. `services/syncScheduler.js` runs it on a timer while the server is up: off unless `SYNC_INTERVAL_MINUTES` is set, so nothing reaches the internet during a demo unless asked; anything below a 15-minute floor is raised, because the ATI page sends `no-cache` on 121 KB and polling harder is rude and pointless; an overlapping tick is skipped so a slow run cannot double-post; and a failed run is logged rather than thrown, because a background job must never take the web server down. The admin page shows the interval and the last run, so staff can see it working instead of trusting it. Windows Task Scheduler calling the npm script remains the better option for runs while the app is stopped, and the two are safe together |
| Chatbot language model | ✅ optional, and free by default — the panel asked for a pre-trained model. **Cost, checked 2026-08-21:** a free Hugging Face account gets **$0.10 of credits a month** and PRO $2.00; OpenAI has no free tier at all; Ollama on the team's own machine costs nothing. Because HF's router, OpenAI and Ollama all speak the same `/chat/completions` shape, `config/aiProvider.js` holds a base URL, key and model rather than a vendor SDK, so any of the three works unchanged. Every failure mode a free tier actually produces — bad key, credits exhausted, rate limited, empty reply, no reply in time — falls back to the retrieval answer, so an expired key can never leave a defence without a working chatbot |
| Chatbot knew the guidelines but not the system | ✅ fixed — the corpus held the LSA rules and nothing about using Agri-AIMS, so "how do I register a farmer?" returned *"Farmer-leader or respected in the community"*: a confident wrong answer, which is worse than none. `config/systemHelp.js` adds 18 entries covering registration, application status, documents, geo-tagging, certificates, reports, compliance, services, assistance, sign-in, roles, notifications, chat, the directory and addresses — **each naming the route it describes**, so it can be checked when the code changes. The minimum-area rule, the disqualification grounds and the field-validation pass mark were also added, quoting the same constants the code enforces |
| **LSA-10** Qualifications not queryable | ✅ built — `rsbsa_number` existed in the schema and on the admin registration form, and **nowhere else**: not on the edit form, not saved by the edit route, not displayed. All nine applications had it blank, so "who is RSBSA-registered" could not be answered. Worse, `applicantModel.update()` writes an **explicit column list** that omitted it, so even a value set at registration was silently blanked by the next edit — the same shape of defect as the `SELECT_BASE` omission found with the disqualification declaration. The field is now on the edit form, written by `update()`, and shown on the application page in an **Operator Qualifications** card alongside the nine operator answers from Step 2, which are already stored per item rather than collapsed into a score. No duplicate columns were added for citizenship or tiller status: those answers already exist as rows carrying their own question text |
| `application_id` collision | ✅ hardened — the next number comes from `MAX(id) + 1`, which is not a locking read, so two staff saving at the same moment could pick the same `LSA-YYYY-NNNN`. `applicants.application_id` already carries a UNIQUE key, so the loser got an error rather than a corrupt row; `registerFarmer()` now re-reads and retries up to 5 times. A duplicate on anything else, an email for instance, is not retried |
| **LSA-09** Basic facilities not persisted | ✅ fixed — Step 2 asked 21 questions and stored one percentage, so the system could report a farm scored 81% but not whether it had a wash area. `010_assessment_responses.sql` keeps one row per item, including which of the four basic facilities (PDF p.11) were claimed. The score itself is computed exactly as before |
| **LSA-03** Field validation results discarded | ✅ fixed — Step 5 stored only a count, so "10 of 12" could not be audited: which two failed was lost on submission. The same table now holds the TWG's per-item findings, and the application page renders a **Field Validation Report** listing every item with its result and the inspector's name |
| Checkboxes displayed as all-ticked | ✅ fixed — both step pages rendered every box as `checked disabled` once submitted, regardless of what had been answered, so a submitted assessment always *looked* perfect. They now show the answers that were actually given; an assessment submitted before this change says so rather than showing a misleading blank |
| Facility declaration vs verification | ✅ added — the application page shows each basic facility side by side, as declared by the applicant in Step 2 and as confirmed by the TWG in Step 5, and warns when something declared was not found on site |

**Verified against the live database (2026-08-20).** Both migrations were applied with the new `npm run migrate:sql` runner — it uses the `mysql2` driver the project already depends on, so the missing `mysql` command-line client on Windows is no longer a blocker. Results:

- 4 location tables created; `barangay_id` added to applicants, farms, and users with all three foreign keys in place.
- The full Region V PSGC hierarchy is loaded and verified against the published figures (6 provinces, 7 cities, 107 municipalities, 3,471 barangays), with all six same-named barangay pairs preserved and no broken parent chains.
- **Data-quality finding, since corrected:** 7 of the 8 demo addresses in `data/applicants.json` named barangays that do not exist in the municipality they claimed (there is no Brgy. San Jose in the City of Naga, no Salvacion in the City of Legazpi). The importer refused to guess. `scripts/fix-demo-addresses.js` then rewrote them to hand-picked real barangays of the same LGU — San Isidro (Naga), Banquerohan and Bitano (Legazpi), Caratagan (Pio Duran), N. Roque (Bulan), Bikal (Caramoan), Salvacion (Iriga) — updating `data/applicants.json`, `data/farms.json` and the database together. All 8 applicants and 5 farms now resolve to official PSGC rows, and each address text re-resolves to the same row, so a future re-seed or re-migrate reproduces the links.
- The location API answered correctly from real data, including barangay search across two municipalities.
- Admin registration was driven through the running app with a real signed-in admin: the form rendered, a farmer was created as `LSA-2026-0009`, the generated password was shown once, and that farmer could then sign in with it. The test record was deleted afterwards (8 applicants, 5 users — as before).
- The login cookie came back as `Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`, a guest hitting `/dashboard` was redirected, and the login page contained zero credential strings.
- **Map tiles, confirmed from the failing tile itself:** the tiles OpenStreetMap returned carried the text *"403 — Referer is required by tile usage policy of OpenStreetMap's volunteer-run servers"*. The app was sending `Referrer-Policy: no-referrer`, a helmet default, so the browser omitted the header the policy demands. Fixed as above. Browsers cache those 403 tile images, so a hard refresh is needed to see the change, and OSM may hold a short-lived block against a client that was refused repeatedly.
- **Consequence of removing the admin fallback, confirmed by testing:** because every visitor previously resolved to the first admin user, the role checks already present in `routes/farms.js`, `routes/applicants.js` and `routes/accreditation.js` were unreachable. With real roles enforced they now apply, and the map-bearing staff pages are gated: an operator is refused `/farms/:id` for a farm that is not theirs, `/applicants/:id` and Step 5, and an applicant is refused Step 5. Admin and evaluator reach all five map pages. These gates are pre-existing application rules, not new restrictions, and they were left as written.

**Phase 2 module testing (2026-08-20).** Notifications were verified end to end against the live
database — 16 checks: a real document submission produced a `document_submitted` notification with a
working link, per-user read state behaved, mark-all-read cleared the badge, CSRF was enforced on the
read endpoints, and the invented sample notifications are gone from the navbar. Services, compliance
and e-learning were then driven through the running app — 24 of 25 checks passed on the first run
(service created, enrolled, participant listed, filters working; compliance overview and checklist
rendering with guideline citations, checks recorded and displayed; the e-learning article posted to
`#e-learning`, 5 members notified, dry-run sync reporting correctly).

The one failure was a date rendering as one day early, which turned out to be the driver-level
off-by-one described above rather than a fault in the module; the stored value was correct
(`DATE_FORMAT` confirmed `2026-08-20`). It is fixed in `config/database.js`, and the fix was
verified through the app's own pool across compliance checks, farms, reports and applicants.

**The suite was re-run clean after the fix (2026-08-21): 25 of 25 checks pass**, including the date
check that had failed. The notification suite was re-run at the same time and passes 16 of 16. Both runs
were made against a freshly started pool so the driver change was actually in effect, and every row the
tests created was removed afterwards — no test service, participant, compliance check, chat message,
e-learning article, notification or document remains in the database.

Between the two runs the XAMPP MariaDB instance (10.4.32) went into a wedged restart: it listened on
3306 but never finished crash recovery, so every connection timed out. Its error log showed
`InnoDB: Expected tablespace id 3 but found 4294967294 in .\mysql\transaction_registry.ibd`, a corrupt
file in MariaDB's own `mysql` system schema rather than in `agri_aims`; the same error appeared in an
entry timestamped before that restart, and nothing in this work touches the system schema. After a
restart from the XAMPP control panel the server recovered on its own, and all schema and seed data
survived intact — 3,471 barangays, 18 compliance requirements, 8 applicants, 5 farms, 19 documents.
No database files were repaired or deleted.

Offline suites also pass: location API against a fake DB (8 checks), admin registration through the real controller and service (19 checks, including rollback on duplicate email and rejection of an unknown barangay id), login-page rendering (7 checks), guest access (13 checks), all 36 EJS templates compile, and INSERT placeholder/parameter counts were re-verified after every schema change.

---

## Current score — 2026-08-21

Counted from the compliance matrix below, scoring ✅ as 1, 🟡/⚠️ as 0.5, ❌ as 0:

| Area | Score | |
|---|---|---|
| LSA guidelines (LSA-01…22) | **20.5 / 22** | **93%** |
| Team requirements (RSC-01…07) | **6.5 / 7** | **93%** |
| **Overall** | **27 / 29** | **93%** |

At the start of the audit this was LSA 41%, RSC 14%, overall about 33%.

Still open: LSA-20 (only the one-LSA-per-municipality rule now — the
public-official disqualification is asked and recorded, and a single category is
already structurally enforced by the form's select), LSA-21 (TWG membership, optional),
and RSC-07 (export built — JSON, CSV and XML — but the outbound push and
`integration_logs` are not, because ATI has published no endpoint to push to).
RSC-06 is now closed: a pre-trained model is configured and answering
(see below). The CSP still needs
`script-src-attr` lifted, which means rewriting 74 inline handler attributes.

---

## Headline result

| Metric | Score |
|---|---|
| **LSA alignment (PDF-derived requirements)** | **41 %** |
| **RSC alignment (the 7 recommendations)** | **14 %** |
| **Overall weighted (70 % PDF / 30 % RSC)** | **≈ 33 %** |

The system is a **well-built LSA I certification workflow** (the 7-step procedure of PDF p.17/20 is genuinely implemented end-to-end). It is **not yet an LSA program management system**: LSA II, the provision-of-assistance module, services, compliance monitoring, and every RSC item are absent, and one security defect makes every administrative page publicly reachable.

---

# PART 1 — THE CURRENT SYSTEM

## A. Technology stack (verified)

| Layer | What is actually there | Evidence |
|---|---|---|
| Runtime | Node.js, Express 4.18 | [package.json](../package.json), [app.js](../app.js) |
| Views | EJS 3.1, server-rendered; Bootstrap 5.3 + Chart.js 4.4 from jsDelivr CDN | [views/partials/scripts.ejs](../views/partials/scripts.ejs) |
| Architecture | MVC-lite: `routes/` → `controllers/` → `models/` (all SQL isolated in models) | [models/](../models/), [controllers/](../controllers/) |
| Database | MySQL 8 via `mysql2/promise` pool, prepared statements, `namedPlaceholders` | [config/database.js](../config/database.js) |
| Schema | 7 tables: `applicants`, `farms`, `documents`, `reports`, `users`, `chat_channels`, `chat_messages` | [database/schema.sql](../database/schema.sql) |
| Auth | bcrypt (cost 12) + JWT (`jsonwebtoken`), read from `Authorization: Bearer` **or** the `agri_token` cookie | [middleware/auth.js:14-19](../middleware/auth.js#L14-L19) |
| REST API | `/api/auth`, `/api/users`, `/api/community` only | [routes/api/index.js](../routes/api/index.js) |
| Notifications | **None.** The bell and dropdown are hardcoded HTML per role | [views/partials/navbar.ejs:240-289](../views/partials/navbar.ejs#L240-L289) |
| Chat/community | Real: MySQL-backed channels + messages, client polls every N ms | [models/chatMessageModel.js](../models/chatMessageModel.js), [views/pages/community.ejs:166](../views/pages/community.ejs#L166) |
| AI chatbot | **Not a model.** Was a 7-branch `if/else` in the browser; now server-side retrieval over the system's own LSA data with a citation per answer (`services/chatbotKnowledge.js`). Still no LLM | [public/js/main.js:110-137](../public/js/main.js#L110-L137) |
| External integrations | **None.** No HTTP client dependency exists (`axios`/`node-fetch` absent from `package.json`) | [package.json](../package.json) |
| File uploads | **Not implemented.** No `multer`; the file input has no `name`, and `filename`/`fileSize` are hidden text fields | [views/pages/document-submit.ejs:64,75-76](../views/pages/document-submit.ejs#L64) |
| Deployment | Local only: `npm start`, `.env` committed to the repo, no Docker/CI | [.env](../.env), [SETUP.md](../SETUP.md) |

## B. User roles

`users.role` is `ENUM('admin','evaluator','operator','applicant')` ([schema.sql:170](../database/schema.sql#L170)).

| Role | Can currently do | Verified in |
|---|---|---|
| **admin** | Everything: applicant CRUD + delete, all 7 accreditation steps, Step 7 certificate issuance, all documents, farms, reports, directory, community, full `/api/users` CRUD | [routes/applicants.js:204-214](../routes/applicants.js#L204-L214), [routes/accreditation.js:510-517](../routes/accreditation.js#L510-L517) |
| **evaluator** (ATI TWG) | Steps 4–6 (doc evaluation, field validation + geo-tag, endorsement), edit applicants, view reports. Blocked from Step 7 | [routes/accreditation.js:283-290, 356-363, 448-455](../routes/accreditation.js#L283-L290) |
| **operator** (certified LSA) | Own farm detail, own reports (read-only), own documents, community. Blocked from `/applicants` | [routes/farms.js:56-62](../routes/farms.js#L56-L62), [routes/applicants.js:22-28](../routes/applicants.js#L22-L28) |
| **applicant** | Own application, Steps 1–3, submit own documents, community. Blocked from `/reports` | [routes/reports.js:10-17](../routes/reports.js#L10-L17) |

⚠️ **This role model is not enforced for anonymous visitors.** See Part 9, finding SEC-01.

## C. Existing modules

| Module | Purpose | Tables | Routes | Role | Aligns with PDF? |
|---|---|---|---|---|---|
| Landing/Auth | Login + self-registration (applicant or operator) | `users`, `applicants` | [routes/index.js](../routes/index.js), [routes/api/authRoutes.js](../routes/api/authRoutes.js) | all | 🟡 partial — no barangay, no LSA I/II choice |
| Dashboard | 4 role-specific dashboards with Chart.js | all | [controllers/dashboardController.js](../controllers/dashboardController.js) | all | ✅ the fabricated panels are now real queries — operator visitor chart, compliance panel and report calendar (2026-09-05), and the evaluator Field/Virtual Validation panel (2026-09-05, see below) |
| Applications | Applicant CRUD, filters, geo-tag | `applicants` | [routes/applicants.js](../routes/applicants.js) | admin/evaluator/applicant | ✅ good fit for PDF p.19 |
| Accreditation | The 7-step LSA I procedure | `applicants` (step1–step7 columns) | [routes/accreditation.js](../routes/accreditation.js) | step-gated | ✅ **strongest module** — matches PDF p.17/20 step-for-step |
| Documents | 12 documentary requirements, review status | `documents` | [routes/documents.js](../routes/documents.js) | all but evaluator can't submit | ✅ files stored and served through an authorised route; per-document accept/reject with remarks added 2026-09-03 (see below) — list still incomplete vs PDF p.18 |
| Farms / My LSA | Certified LSA registry, compliance score, GIS coords | `farms` | [routes/farms.js](../routes/farms.js) | admin/evaluator/operator | ✅ the "Level 1/2/3" badge was demo data with no meaning in the code; corrected to **LSA I** on 2026-09-04 (see below) |
| Reports | Semestral accomplishment reports | `reports` | [routes/reports.js](../routes/reports.js) | not applicant | 🟡 **read-only — there is no submission route**, contradicting PDF p.37 |
| Directory | Public-style searchable LSA list | `farms` | [routes/directory.js](../routes/directory.js) | all | ✅ supports PDF p.7 (visit area) |
| Community Chat | 5 seeded channels, polling messages | `chat_channels`, `chat_messages` | [routes/community.js](../routes/community.js), [routes/api/communityRoutes.js](../routes/api/communityRoutes.js) | all | N/A — not a PDF requirement, but the RSC-03 host |
| AgriBot | Floating chat widget | — | client-only | all | ❌ no AI, no LSA knowledge base |

---

# PART 2 — CHECK AGAINST THE LSA PDF

## 2.1 What the registration form actually captures

From [database/schema.sql:19-33](../database/schema.sql#L19-L33) and [views/pages/applicant-form.ejs](../views/pages/applicant-form.ejs):

| PDF requirement | Field in system | Status |
|---|---|---|
| Farmer identity (name, email, phone) | `first_name`, `last_name`, `email`, `phone` | ✅ |
| Farm name / area | `farm_name`, `farm_area` (INT sq.m.) | ✅ |
| Region / Province / Municipality | 3 separate `VARCHAR` columns | 🟡 free text, not referential |
| **Barangay** | **absent** — buried in `farm_address` free text (seed rows read `"Brgy. San Jose, Naga City"`, [data/applicants.json](../data/applicants.json)) | ❌ **RSC-01** |
| Ownership: private / organization / government (PDF p.11) | `category` enum-in-a-VARCHAR, form offers exactly those 3 | ✅ |
| Farming classification (PDF p.9) | `classification` — GAP, GAHP, Natural, Organic, Integrated, Cut Flowers, Halal, Urban + Agri-Processing | ✅ **complete match to PDF p.9-10** |
| LSA **I vs II** (PDF p.4-8, 16) | 🟡 `farms.accreditation_level` now holds **LSA I** — the tier the Step 7 certificate awards — instead of the invented *"Level 1/2/3"*; `lsa_type` still holds *Regular / RCEF / Coco*, which is the commodity programme, not the tier | 🟡 **partly corrected 2026-09-04** |
| Basic facilities: TDA, holding area, wash area, toilet (PDF p.11) | Checkbox items `f3`–`f6` in Step 2 that are **counted and thrown away** — only an aggregate `step2_self_assessment_score` is stored ([routes/accreditation.js:174-186](../routes/accreditation.js#L174-L186)) | ❌ not persisted |
| Minimum area 1,000 sq.m. / 1 ha coco / 25 heads livestock (PDF p.11) | `farm_area` captured; **no validation rule anywhere** | 🟡 |
| Training/certification, RSBSA, good standing, medical, citizenship (PDF p.12) | Exist only as `documents.type` rows (`training_certificates`, `rsbsa_certificate`, `good_standing`, `medical_certificate`) | 🟡 no structured fields — you cannot query "who is RSBSA-registered" |
| Agri-processing enterprise: business permit + DTI/FDA (PDF p.13, p.18) | ❌ absent from both the 12-document list and the schema | ❌ |
| Government-owned: Special Order (PDF p.15, p.18) | ❌ absent | ❌ |
| Organizations: Board Resolution / SEC / BIR (PDF p.18) | ❌ absent | ❌ |
| Supporting documents | 12 types tracked as metadata; **no file is ever stored** | 🟡 |

## 2.2 Where the workflow diverges from the PDF

1. **Field Validation Report is not a record (PDF p.17 Step 5, p.19).** The TWG checklist has 12 items; the code counts how many were ticked and stores the integer only ([routes/accreditation.js:405-407](../routes/accreditation.js#L405-L407)). Per-item results, the item texts, and the report itself cannot be reproduced or audited later.
2. **Self-assessment answers are discarded** the same way (`step2_self_assessment_score` only), so the ATI-QF-PAD-164 form cannot be regenerated.
3. **Semestral reports cannot be submitted.** [routes/reports.js](../routes/reports.js) exposes a single `GET /`. PDF p.37 and p.40 make semestral submission a core operator responsibility.
4. **No LSA II path at all.** PDF p.16 (up-scaling criteria), p.21 (the *5*-step LSA II procedure), p.22-23 (LSA II documents incl. Certificate of Good Standing) have no representation in schema, routes, or views.
5. **Provision of assistance is unmodelled.** PDF p.26 (Financial+Technical vs Technical-Only), p.27 (₱150,000 facility / ₱100,000 calamity), p.29 (3-month disaster deadline), and the quarterly LSA Project Completion Report have no table, no field, no route.
6. **TWG structure not modelled** (PDF p.33-34). The `evaluator` role approximates the RTWG, and the endorsing director's name is hardcoded: `'JOEY A. BELARMINO, Ph.D.'` ([routes/accreditation.js:464](../routes/accreditation.js#L464), [:587](../routes/accreditation.js#L587)).
7. **Miscellaneous provisions unenforced** (PDF p.41-42): the disqualification of public officials is *displayed* in the Step 1 briefer ([routes/accreditation.js:75-79](../routes/accreditation.js#L75-L79)) but never captured or checked; the "at least one LSA per municipality / varied commodities" rule and the "one category only" rule have no logic.
8. ✅ **Correctly implemented:** 5-year certificate validity (PDF p.37/40) — Step 7 computes `validUntil = issueYear + 5` ([routes/accreditation.js:526-527](../routes/accreditation.js#L526-L527)).

---

# PART 3–7 — THE SEVEN RECOMMENDATIONS (RSC)

## RSC-01 — Separate Barangay ✅ Built

**Since built.** The address is a four-level PSGC hierarchy, not a text column.
`regions`, `provinces`, `municipalities` and `barangays` hold 1 / 6 / 114 / **3,471**
rows for Region V, each row carrying its `psgc_code`, and `barangay_id` is a foreign
key on `applicants`, `farms`, `services` and `users`.

One partial — `views/partials/location-select.ejs` — renders the cascading control, and
it is used by all four forms that take an address: the applicant form, the admin
farmer form, the service form and the public registration on the landing page. Five
read-only endpoints in `routes/api/locationRoutes.js` feed it.

The free-text problem the original finding describes is gone with it: the province
filter no longer comes from `SELECT DISTINCT province` over typed strings but from
the reference table, so "Naga City", "naga city" and "Naga" can no longer be three
provinces. `applicantModel.findFiltered()` filters on the hierarchy.

The original finding follows.

## RSC-01 — Separate Barangay ❌ Missing *(original)*

**Current:** barangay is text inside `applicants.farm_address` / `farms.address`. Region is a hardcoded 5-option `<select>` ([applicant-form.ejs:137-144](../views/pages/applicant-form.ejs#L137)); province and municipality are free-text inputs, so `"Naga City"`, `"naga city"`, and `"Naga"` are three different provinces to `SELECT DISTINCT province` ([models/applicantModel.js](../models/applicantModel.js)).

**Impact of doing this properly** (as you instructed — not a bare text column):

- **Database:** 4 new reference tables (`regions`, `provinces`, `municipalities`, `barangays`) keyed by **PSGC code**, plus `region_code`/`province_code`/`municipality_code`/`barangay_code` FK columns on `applicants` and `farms`. Keep the existing VARCHAR columns during migration (dual-write) so nothing breaks.
- **Registration form:** cascading selects fed by 4 new read-only API endpoints.
- **Admin form:** same cascading control in `applicant-form.ejs`.
- **Farmer profile:** display the resolved 4-level address.
- **Search/filter:** `findFiltered()` in `applicantModel`/`farmModel` gains `barangayCode`, and the province dropdown moves from `SELECT DISTINCT` to the reference table.
- **Reports:** enables the PDF p.42 rule "at least one LSA per municipality" to be *computed* rather than eyeballed.

## RSC-02 — Admin registers farmers ✅ Built

**Since built.** `GET /admin/farmers/new` and `POST /admin/farmers` create the
application row, the farm profile and — when the form's checkbox is ticked — the login
account, in **one transaction** (`controllers/adminFarmerController.js`,
`services/farmerRegistration.js`). Either all three exist or none does.

The checkbox matters: the Guidelines have ATI register farmers who walk into the
office, and a farmer with no email address cannot be given a login. Leaving it
unticked is the supported case, not a failure. When it is ticked and no password is
supplied, one is generated that satisfies the strength rules and is shown once for
staff to read out — and the farmer can now change it themselves at `/profile`.

`users.created_by_admin` marks these accounts, as the original recommendation asked.
The old `POST /applicants/add` is retired: both its verbs now redirect to
`/admin/farmers/new`, so there is one way in rather than two half-ways.

The original finding follows.

## RSC-02 — Admin registers farmers 🟡 Partial *(original)*

Two half-paths exist, neither is what you asked for:

- `POST /api/users` (admin-only, JWT) creates a **user account** with no farm data ([controllers/userController.js:38-90](../controllers/userController.js#L38-L90)).
- `POST /applicants/add` creates an **application row** with farm data but **no login account** and **no password** ([routes/applicants.js:71-109](../routes/applicants.js#L71-L109)).
  - **Resolved.** This route is retired and redirects to `/admin/farmers/new`; the no-login case it served is now the unticked state of one checkbox on that form.

So an admin cannot today create a farmer who can log in *and* has a farm profile in one action. The public `POST /api/auth/register` does do both, transactionally ([controllers/authController.js:110-190](../controllers/authController.js#L110-L190)) — that transaction is the right template to reuse for an admin-side endpoint. Authorization primitives already exist (`requireRole('admin')`, [middleware/auth.js:66-77](../middleware/auth.js#L66-L77)) but the web routes use a weaker, separate check.

**Recommendation:** yes, keep it separate from self-registration — admin-created accounts should be marked (e.g. `users.created_by_admin`) and should support setting status, documents, and barangay in one form.

## RSC-03 — e-Learning monitoring ✅ Built — one driver of three needs a credential ATI must issue

**Since built.** `services/elearningSource.js` offers three drivers behind one
interface, chosen by `ELEARNING_SOURCE`:

| Driver | State |
|---|---|
| `ati` — the ATI Bicol website listing | **Running.** 51 articles stored in `elearning_articles`, all from this source. |
| `moodle` — the e-learning portal's REST API | **Built, unused.** Needs `MOODLE_TOKEN`; the endpoint was verified reachable during the audit and answers `invalidtoken` to an unauthenticated call. |
| `manual` — staff entry at `/admin/elearning` | **Available.** The fallback when neither of the above is configured. |

Be precise about this in the defence: the Moodle integration is written and the
endpoint is confirmed live, but **no e-learning course has been ingested**, because a
web-service token can only be issued by whoever administers
`elearn.e-extension.gov.ph`. The token is read from the environment and is not in the
repository. Nothing here fabricates an ATI API — the driver targets Moodle's own
documented REST interface.

`services/syncScheduler.js` runs whichever driver is configured on a timer and posts
new items to the community channel.

The original finding follows.

## RSC-03 — e-Learning monitoring ❌ Missing *(original — but feasible, verified)*

Nothing in the codebase touches an external URL. I checked the actual ATI properties before recommending an approach:

| Endpoint tested | Result |
|---|---|
| `https://elearn.e-extension.gov.ph/` | **Moodle** LMS (footer: "Powered by Moodle"); has a "Site announcements" forum with new-course posts |
| `https://elearn.e-extension.gov.ph/webservice/rest/server.php?wstoken=test&…` | Returned `{"exception":"moodle_exception","errorcode":"invalidtoken","message":"Invalid token - token not found"}` → **the Moodle Web Services REST API is enabled and reachable; it only needs a valid token** |
| `https://elearn.e-extension.gov.ph/robots.txt` | 404 |
| `https://www.e-extension.gov.ph/feed` | 404 |
| `https://ati2.da.gov.ph/ati-main/…` (Drupal, article URLs `/ati-main/content/article/<slug>`) | No `rel="alternate"` RSS link found; `/ati-main/rss.xml` → 404; `/sitemap.xml` → 404 |

**Conclusion — do NOT scrape.** The correct integration is **Moodle Web Services over REST/JSON**:

```
GET /webservice/rest/server.php
    ?wstoken=<token>&moodlewsrestformat=json
    &wsfunction=core_course_get_courses_by_field   ← new/updated courses
    &wsfunction=mod_forum_get_forum_discussions    ← Site announcements posts
```

**Blocking prerequisite:** a token must be issued by the ATI e-Extension Moodle administrator for your service account (Site administration → Plugins → Web services → Manage tokens). **This is a written request your team must make to ATI; it cannot be self-served.** Moodle can also emit per-forum RSS (`/rss/file.php/...`), but that requires `enablerssfeeds` to be switched on and a per-user token in the URL — the Web Services route is cleaner and equally token-gated.

**Safe fallback if ATI declines a token:** an admin-curated "Announcements" form that posts to the same `elearning_articles` table and fires the same notification path. The pipeline you specified (detect → dedupe → store → auto-post to Community Chat → notify) is unchanged; only the ingestion adapter differs. Design it as `services/elearningSource.js` with two drivers (`moodle`, `manual`) so the switch is a config change.

## RSC-04 — Service monitoring ✅ Built

**Since built (2026-09-02).** `services` and `service_participants` exist with the fields set out
below. `services.service_type` is an ENUM of exactly the five components the Guidelines name on
p.8 — `training`, `demonstration`, `information_support`, `technical_assistance`,
`complementary_project` — so a sixth cannot be introduced by a typo. `routes/services.js` covers
listing, creation, editing, self-enrolment and recording attendance and completion.

The catalogue is seeded by `npm run seed:services` from the document itself: the nine training
courses named under Technical Assistance (p.30) and the three items given priority to LSA II
(p.31) — PAF-ESP accreditation, the FITS kiosk, and AI sa Barangay. Nothing in that seed is
invented, and scheduling is left empty because a catalogue entry describes what ATI offers, not
when a particular run happens.

The track record the audit called for is wired: `models/lsa2Model.js` counts
`service_participants` rows with `completed_at` set when assessing an LSA II application, which
is what p.16 requires.

The original finding follows.

## RSC-04 — Service monitoring ❌ Missing *(original)*

No `services` table, no route, no view. The PDF supports exactly five component types (p.8): **Training, Demonstration Services, Information Support, Technical Assistance, Complementary Projects**, plus the named training courses on p.30 and the LSA II-priority items on p.31 (PAF-ESP, FITS kiosk, AI sa Barangay).

Of the fields you listed, these are justified by the PDF or by existing data: `service_type` (the five above), `name`, `provider`, `description`, `target_beneficiaries`, `schedule_start/end`, `location` (reuse the new barangay FK), `eligibility`, `status`. Participation belongs in a separate `service_participants` table (`farmer_id`, `service_id`, `application_status`, `attended`, `completed_at`, `certificate_document_id`, `remarks`) — this is what feeds PDF p.16's "track record" requirement for LSA II up-scaling.

## RSC-05 — Compliance monitoring ✅ Built

**Since built (2026-09-02).** The catalogue and the checks both exist —
`compliance_requirements` (18 rows, each citing the part of the Guidelines it comes from) and
`compliance_checks` with the fields listed below. The operator dashboard's hardcoded six-item
array is gone; it reads the real checklist.

The last piece was the number itself. `farms.compliance_score` was still seed data that no code
ever updated, so the Farms list and each farm's page showed 95%, 88%, 72%, 65% and 80% for five
farms against which **not one check had ever been recorded** — while the operator dashboard,
reading real checks, showed 0% for the same farms at the same moment.

That column is now derived: `complianceModel.recomputeFarmScore()` recalculates it from the
recorded checks and is called whenever a check is saved (`routes/compliance.js`). Migration 019
made it nullable and cleared the seeded figures.

NULL is a distinct state and is not zero. A farm nobody has assessed reads **"Not yet assessed"**;
0% means assessed and meeting nothing. Collapsing those two is what made the original numbers look
convincing.

The farm page's three compliance items were a green tick, a green tick, and a tick keyed off the
score ("Documents Complete", "Field Validated", "Report Submitted"). They now count recorded
checks: how many of the applicable requirements are met, how many findings are open, and how many
have not been checked.

The original finding follows.

## RSC-05 — Compliance monitoring ⚠️ Cosmetic only *(original)*

There *appears* to be compliance monitoring, and this is the most misleading part of the current build:

- `farms.compliance_score` is a `TINYINT` **loaded from seed JSON and never computed** ([data/farms.json](../data/farms.json)).
- The operator dashboard's six compliance items are a **hardcoded array** whose statuses are derived from unrelated numbers — e.g. "Farm Available as Demo Area" is `compliant` iff `visitorsThisYear > 0`, and "ATI Monitoring Access Granted" is the literal string `'compliant'` ([controllers/dashboardController.js:241-249](../controllers/dashboardController.js#L241-L249)).

A real implementation needs the structure you described, and it is well supported by PDF p.17/21 ("field/virtual validation … to ensure compliance or conformity to approved guidelines") and the operator responsibilities on p.36-37/39-40: `compliance_requirements` (catalogue, each row citing its PDF basis) + `compliance_checks` (`farmer_id`, `requirement_id`, `status`, `checked_at`, `checked_by`, `evidence_document_id`, `remarks`, `corrective_action`, `next_check_date`).

## RSC-06 — Pre-trained chatbot ✅ Done — model configured, grounded and cited

**Update 2026-09-09.** RSC-06 is now complete end to end. `services/chatbotLlm.js`
and `config/aiProvider.js` wire a pre-trained model over the retrieved snippets,
and it **is** configured and answering on the running system.

State of the record:

1. The integration is **provider-agnostic**, not ChatGPT-specific. Anything that
   speaks the `/chat/completions` shape works; the provider is a few `.env`
   variables. It is currently pointed at **OpenRouter** serving
   `openai/gpt-4o-mini` (via the `@openrouter/sdk` client), and `isConfigured()`
   returns true (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` are all set).
2. Grounding is unchanged and mandatory: the model is told to answer only from
   the numbered context and to refuse rather than fill a gap, and the citation
   still comes from the retrieved snippet, so it cannot be invented.
3. The bot now also **recognises the signed-in user** — it answers "who am I / what
   is my role" from server-side session state and tailors guidance to the role
   (an operator asking "how do I apply?" is pointed to renewal, not application).
4. If the key is ever missing, expired or rate-limited, it degrades to the
   retrieval answer automatically — a missing key can never leave the demo
   without a chatbot.

The retrieval layer and the citation rule described below still run underneath;
the model now sits on top of them.

## RSC-06 — Pre-trained chatbot 🟡 Grounded and cited, still no model *(original)*

**Since built (2026-08-21).** The browser `if/else` is deleted. `GET /api/chatbot?q=` answers from `services/chatbotKnowledge.js`, which assembles its answer set from data the app already enforces — `config/accreditationChecklists.js`, `config/documentRequirements.js`, `config/lsa2.js`, `config/assistance.js` and the seeded `compliance_requirements` rows — so an answer cannot drift from the rules the rest of the system applies. Every answer carries the guideline section it came from, and a question that matches nothing returns "I could not find that in the LSA guidelines this system holds" with no citation, rather than a plausible invention. Retrieval is keyword overlap: **no model, no API key, no network call, no new dependency.** It is a GET because it only reads reference data, which also keeps it clear of CSRF. The recommendation below — a hosted model over the same retrieved snippets — still stands as the next step; the grounding and citation layer it needs now exists.

The original finding follows.


The current bot is [public/js/main.js:110-137](../public/js/main.js#L110-L137): a keyword `if/else` chain with 7 canned answers, entirely client-side. There is no `/api/chatbot` route, no conversation table, no model. It is also already **factually wrong about your own system** — it tells users the process has "5 steps" and lists a step order that does not match the 7 steps your own `accreditation.js` implements.

**Comparison for this project:**

| Approach | Accuracy | Cost | Hardware | Filipino/agri | Integration | Privacy |
|---|---|---|---|---|---|---|
| Keep keyword matcher | Poor, already wrong | ₱0 | none | none | done | best |
| Self-hosted open model (Llama/Mistral) | Fair | ₱0/call but needs a GPU box | **GPU required — you have none** | weak Tagalog/Bikol | heavy | best |
| **Hosted API + RAG over your own DB/PDF** | **Best** | **per-token, small** | none | strong Filipino | ~1 file + 1 route | data leaves your server |

**Recommendation: hosted API with retrieval grounding.** Concretely, for a Node/Express app: `npm install @anthropic-ai/sdk`, add `POST /api/chatbot`, and on each question (a) retrieve from a new `knowledge_base` table seeded from the LSA Guidelines PDF plus live rows the user is entitled to see, (b) pass only those snippets as context, (c) instruct the model to answer **only** from them and to say "not covered in the LSA Guidelines" otherwise, (d) log to `chatbot_conversations`.

Current model IDs and list pricing (per million tokens): `claude-haiku-4-5` — $1 in / $5 out (cheapest suitable, 200K context); `claude-sonnet-5` — $3/$15; `claude-opus-5` — $5/$25. **For this workload, `claude-haiku-4-5` is the right default.** Typical Q&A here is a few thousand context tokens and a couple hundred output tokens, so cost lands in the fractions-of-a-centavo range per question.

**Separation of knowledge is non-negotiable for a government system:** every answer that states an LSA rule must come from a retrieved snippet with a visible citation (e.g. *"LSA Guidelines, Provision of Assistance"*); anything else must be labelled as general agricultural information. Never let the model answer "what is my application status" from its own knowledge — that comes from a DB query.

## Document Management, grouped by requirement ✅ Changed (2026-09-05)

Requested by the team. The page listed every document flat — first a wide
nine-column table, then a flat card grid — mixing all applicants and all
requirement types together, which was hard to scan.

It is now grouped by document TYPE: one container per requirement (Signed
Briefer, Self-Assessment Form, Farm Development Plan, …), each holding every
applicant's submission of that type, in the order the requirements appear on
the official checklist. Each container header carries the form code and a
count summary ("3 submitted · 3 verified"). This is the order a reviewer
actually works in — verify everyone's Signed Briefer, then everyone's
endorsement — rather than jumping between requirement types per applicant.

Only types with at least one submission get a container. Calamity-assistance
evidence is filed as documents too and its types are not in the accreditation
catalogue, so their labels are pulled from `config/assistance.js`
(`CALAMITY_EVIDENCE_ITEMS`); any type in neither list is humanised from its key
rather than printed as `snake_case`. The per-submission card keeps everything
from before — status edge colour, file link, remarks, the staff accept/reject
form, and the owner's Re-submit action on a returned document.

**Check.** `tests/documents_test.js` and `tests/resubmit_test.js` both exercise
the grouped page (status controls for staff, outcome-only for applicants, the
Re-submit link on a returned document); `tests/structure_test.js` is clean.

## A returned document did not tell the owner how to fix it ✅ Fixed (2026-09-05)

Asked by the team: once a document is rejected, is the applicant told to
re-submit, and does re-uploading replace the returned file with an accepted one?

The mechanics were already sound, and the audit records them because they are
easy to assume wrong:

- **Rejecting keeps the file.** `documentModel.review` only sets the status and
  remarks; the returned file stays on disk and the row stays `incomplete`, so
  both the applicant and the reviewer can still see exactly what was returned.
- **Re-uploading replaces it.** A new upload for the same requirement runs
  `removeSameType`, which deletes the previous row *and its stored file from
  disk* (`removeWhere` → `removeStored`) before writing the new one as
  `pending_review`. No duplicate row, no orphaned file, and the fresh copy goes
  back into the review queue for the evaluator to accept.

What was thin was the **guidance**. The rejection notice said "Document needs
revision" with the reason, but linked to `/documents` — the read-only list — and
a returned document offered the owner no action at all (the accept/reject
controls are staff-only). The applicant had to notice the top "Submit Document"
button and re-pick the exact requirement from a dropdown, easy to get wrong.

Closed on three surfaces:

1. **The returned card carries a Re-submit action** (owner-facing, shown only on
   an `incomplete` document) that opens the submission form with the requirement
   and applicant already chosen.
2. **The submission form pre-selects** from `?type=` and `?applicant=`, and shows
   a note that re-uploading replaces the returned file.
3. **The rejection notification links straight to that pre-filled form**, not to
   the list, and its body ends "— open this to re-submit."

**Check.** `tests/resubmit_test.js` runs the whole cycle over HTTP: upload,
reject with a reason, and asserts the returned file is still on disk and the
notice links to the re-submit form for that requirement; then re-uploads and
asserts there is still one row, the new file is on disk, **the old returned file
was deleted from disk**, and the status is back to `pending_review`; then the
reviewer accepts it and it becomes `verified`.

## The evaluator's validation schedule was four invented farms ✅ Fixed (2026-09-05)

The evaluator dashboard's *"Field/Virtual Validation Schedule"* panel listed
Green Valley Organic Farm, Villanueva Natural Farm, Morales Organic Herb Garden
and Sunrise Rice Farm, with dates in March 2026. **None of those farms exists in
the database** — the array was typed into the controller
([dashboardController.js:185](../controllers/dashboardController.js#L185)), the
same class of defect as the operator dashboard's visitor chart and compliance
panel.

The real Step 5 data is on the applicant: `step5_validation_date`, `_type`,
`_result` and `_inspected_by`, written when a validation is performed. There is
**no separate "planned visit" field**, so a future scheduled date cannot be
shown honestly — inventing one is exactly what the old panel did. What the
evaluator actually needs is a worklist, and that is what the panel is now:

- **awaiting a visit** — past document review (`accreditation_step >= 4`), no
  validation recorded yet;
- **validated** — a validation date is on the record, shown with its real date,
  type and result.

Applications still in the document stage do not appear, and rejected ones drop
off. The stat card above it changed from *"Scheduled Validations"* (counting a
hard-coded `status === 'scheduled'`) to *"Awaiting Validation"*, counting the
worklist. The panel carries an empty state for when nothing has reached
validation.

Rendered against the live evaluator dashboard, it now shows the two applications
actually validated — Mico's Farm (2026-09-04) and Joseph Farm (2026-09-05) —
and nothing invented.

**Check.** `tests/validation_schedule_test.js` stages three applications — one
in the document stage, one past it awaiting a visit, one validated — and asserts
the four invented farm names are gone, the awaiting one shows with no date, the
validated one shows with its real date and result, and the document-stage one
does not appear at all.

While wiring this in I gave the empty-state row `colspan="6"`, which is correct
for that six-column table — but `tests/structure_test.js` flagged it, because
its colspan check read only the file's first `<thead>` and the dashboard has six
tables of differing widths. The checker now compares each colspan against its
own table's header. That is the tool being wrong, not the markup, and the tool
was fixed rather than the finding suppressed.

## One applicant could read and edit another applicant's file ✅ Fixed (2026-09-05)

Found by a sweep, not by inspection: every page in the app opened as every role,
looking for what breaks. Nothing 500'd — but the applicant role came back **200**
on another applicant's detail page.

The Applications LIST is filtered to the caller's own application
(`applicantModel.findFiltered({ applicationId: currentUser.applicationId })`),
which is what made this look contained. The detail page, the accreditation
overview and Steps 1-3 checked the caller's **role** and never **which
application they were opening**.

Reproduced against two throwaway accounts before anything was changed:

    applicant A -> /applicants/<B's id>       200  LEAKS BEA'S DATA
    applicant A -> /accreditation/<B's id>    200  LEAKS BEA'S DATA

— name, email, phone, RSBSA number, farm details and document list, by changing
the id in the URL. In a government system holding farmer records that is a Data
Privacy Act exposure, not a cosmetic one.

The write side was worse. Steps 1, 2 and 3 have POST handlers with no ownership
check either:

    applicant A posts step 1 on B's application -> 302 /accreditation/383/step/2?advanced=1
      B briefer signed:  false -> true
      B acknowledged by: null -> Al Nosy
      B step/progress:   1/10 -> 2/20

One applicant **signed another's LSA briefer under his own name** and advanced
their application a step. The record afterwards states that Al Nosy acknowledged
Bea's briefer — a false entry on an accreditation file, made by someone with no
relationship to it.

This was live: the database currently holds two applicant-side accounts besides
the seed, so it was reachable, not theoretical.

**The fix.** `mayHandleApplication()` in `routes/accreditation.js` — staff handle
every application, an applicant handles the one whose `application_id` matches
their account — applied to seven handlers: GET and POST for Steps 1, 2 and 3,
and the overview. The same check guards the detail page in
`routes/applicants.js`. Document upload already checked ownership properly and
was left alone.

**Also in this sweep:** three more `currentUser.farmId || 1` fallbacks, in
`routes/documents.js` and twice in `routes/farms.js`. An operator account with no
Learning Site linked was shown farm 1's documents and farm 1's record as though
they were their own. The `|| 0` variants elsewhere are safe — no farm has id 0,
so they exclude rather than substitute.

**Check.** `tests/ownership_test.js` registers two applicants and asserts that
one cannot read the other's detail page, overview or any of Steps 1-3; that the
POST to sign their briefer is refused and their record is untouched afterwards;
that the same holds for the self-assessment; that their own application still
opens normally; and that ATI staff are unaffected.

## Submitting the semestral report ✅ Fixed (2026-09-05)

Asked by the team: *"in monitoring and reporting, when submitting a report, can
you check that it's correct?"* The route worked; four things around it did not.

**1. The form offered periods the farm does not owe — and none that it does.**
The dropdown was built from `new Date().getFullYear()`: this year's two
semesters, whoever you are. Signed in as the operator of a site accredited
2026-09-04, the page returned:

    period options offered: ["Semester 1 2026","Semester 2 2026"]

while that site's calendar owes **Semester 1 2027 through Semester 2 2031** —
the two on offer fell due before it was accredited. Zero overlap: the Submit
button on the dashboard led to a form that could not file what the dashboard was
asking for. Anything filed would carry a period matching no calendar row, so the
calendar would go on showing it as unsubmitted and the chart would go on showing
the empty state, while the farm counters counted it.

The cause was two derivations of the same thing. The calendar was computed
inside the operator dashboard and the form guessed. Both now read
`services/reportSchedule.calendarFor()`, and the dropdown lists exactly the
periods the farm still owes, overdue first, with the due date on each.

**2. The same period could be filed any number of times.** `reports` had no
unique constraint and the route did not check. The calendar shows the first row
and ignores the rest, but `syncFarmCounters` sums every row, so each duplicate
inflated the farm's visitor and training totals. The route now refuses a period
already filed, and migration `027_report_review.sql` adds
`UNIQUE (farm_id, period)` so it holds even if something reaches the model
another way.

**3. A report could never be approved.** `create()` wrote `status = 'pending'`
and nothing in the application ever wrote `'approved'` — there was no review
route and no control. The Reports page counted approved reports for its stat
card, and `models/lsa2Model` counts them as an LSA II up-scaling criterion, so
**no farm could satisfy that criterion**, however many reports it filed.
`POST /reports/:id/review` now records ATI's decision: accept, or return with
remarks. A return with no remarks is refused, the same rule documentary
requirements already follow — an operator told only that their report came back
has nothing to act on. Both outcomes notify the operator, and a submission now
notifies ATI staff, which it never did.

**4. `currentUser.farmId || 1`.** An operator account with no Learning Site
linked read farm 1's reports and filed new ones **against farm 1** — somebody
else's accredited site. That fallback is reachable: `farmId` is optional when an
operator account is created. Removed from the reports route and from the
operator dashboard, both of which now say no LSA farm is linked to the account.

**Check.** `tests/reports_test.js` builds a farm accredited in September and
asserts the form offers the period it owes and not the one it does not; that
filing an unowed period is refused; that the owed period is accepted, counted
once, and cannot be filed twice; that a return with no reason is refused and one
with a reason is recorded; that the report can then be accepted, which is what
LSA II counts; that an operator cannot decide; and that an operator with no farm
is refused rather than shown farm 1.

While moving the calendar out of the dashboard controller I deleted the
compliance block that sat between it and the activity chart, and the operator
dashboard returned 500. `tests/certification_test.js` caught it on the next run
— which is the argument for the checks these fixes keep leaving behind.

## The location fields half-duplicated each other ✅ Fixed (2026-09-05)

Asked by the team: *"are the farm address and the region / province /
municipality / barangay section redundant?"* Half of it was, and the other half
was being used as though it were.

**The three place names are derivable.** `applicants` and `farms` each store
`region`, `province` and `municipality` as plain VARCHARs beside
`barangay_id`, which is a foreign key into the PSGC hierarchy that already
yields all three by joining barangay → municipality → province → region. They
had already drifted: Reyes Integrated Farm recorded its municipality as
*"Sorsogon City"* while the barangay in the very next column resolved to
*"City of Sorsogon"*.

They are not dead weight, which is why they were kept rather than dropped:
`applicantModel.findFiltered` and `farmModel.findFiltered` filter on
`province`, `countByProvince` groups the reports chart by it, and
`barangay_id` is nullable — an application filed without one still has to say
where it is. Dropping the columns would mean a four-table join on every list
page and no location at all for those records.

So they stay, and stop being writable by hand: `locationModel.placeNamesFor()`
derives the three names from the barangay, and both applicant write paths —
`services/farmerRegistration.js` and the staff edit form in
`routes/applicants.js` — now take them from there whenever a barangay is set,
falling back to what was typed only when it is not. `farms` inherits the
values from the applicant at certification, so it is covered by the same change.

**The address field was redundant only in practice.** `farm_address` is for the
detail the hierarchy cannot hold — purok, sitio, street, lot — but the form
asked for the *"Complete Farm Address"* with a placeholder reading *"Address"*,
so people supplied exactly that: `"Sto. Niño Iriga City"` and
`"Brgy. Poblacion, Sorsogon City"`, both of them the barangay and city they
were about to select again two fields later. Neither carried one fact the
dropdowns did not already have. Both forms now ask for **Street / Purok /
Sitio**, with the placeholder `Purok 3, Zone II` and a line saying the barangay
and above are selected separately.

**Repair.** `npm run resync:places` lists every record whose stored names
disagree with its own barangay and, with `--apply`, corrects them. One row
qualified — farm 1's municipality.

**Check.** `tests/location_test.js` registers an applicant that names a real
barangay while posting a deliberately wrong region, province and municipality,
and asserts the barangay wins on all three while the street-level address is
kept verbatim; registers another with no barangay and asserts the typed values
survive; then asserts that no record in either table disagrees with its
barangay.

## "Level 3" meant nothing ✅ Fixed (2026-09-04)

Asked by the team, looking at the farms list: *"what is the level 3 mean?"*

Nothing. `farms.accreditation_level` is a free-text `varchar(40)`, and Reyes
Integrated Farm's value came straight out of `data/farms.json`, the file the
system ran on before MySQL — five demo farms carrying *Level 3* (×2), *Level 2*
(×2) and *Level 1*, invented for the demo.

Nothing in the application ever read it. It is printed on the farms list, the
farm record, the directory and the operator dashboard, and included in the
registry export, and no code anywhere uses it to decide anything: not
eligibility, not LSA II up-scaling (`config/lsa2.js` never looks at it), not
compliance, not renewal.

The Guidelines define **LSA I** and **LSA II** — a tier you up-scale into after
years as an LSA I, with its own five-step procedure — not a 1/2/3 ladder. This
audit flagged the scheme as unsupported from the beginning; what made it visible
was Step 7 starting to stamp new farms **LSA I**, which put the real vocabulary
and the demo vocabulary side by side on the same screen.

Corrected in both places, because fixing only the database would let
`npm run migrate` put it back: every farm whose level matched `Level %` is now
`LSA I` (one row in the live database, five in `data/farms.json`). No LSA II
site exists to mislabel — `lsa2_applications` is empty.

`lsa_type` is left alone: *Regular / RCEF / Coco* is the commodity programme a
site belongs to, which `config/farmEligibility.js` genuinely reads for the
one-hectare Coco-LSA area rule. It is not the accreditation tier and was only
ever conflated with it in the audit table above.

## The operator dashboard showed figures the system does not hold ✅ Fixed (2026-09-04)

Reported by the team from the first operator dashboard the system ever
produced, with the instruction *"the image must show the actual data."* Two
panels were inventing it.

**The activity chart.** `visitorData` in `controllers/dashboardController.js`
was twelve hard-coded monthly numbers —
`[8, 14, 22, 18, 30, 25, 12, 28, 35, 19, 22, …]` — with a token nod to the
farm's counter on the last bar only. A farm with nothing reported still drew a
full year of activity, directly beside a **"Total: 0"** badge reading the real
column. The chart and its own badge contradicted each other on screen.

There is no monthly source anywhere in this system. Visitors and training
sessions exist in exactly one place: the semestral accomplishment reports
operators submit (`reports.visitors`, `reports.training_sessions`), which the
ATI Briefer requires and which the calendar directly below the chart tracks. So
the chart now draws one bar group per reporting period, oldest first, labelled
`S1 2027` rather than `Aug`, and before the first report is submitted it draws
nothing at all — it says no semestral report has been submitted yet and names
the next due date. The fixed `max: 6` on the sessions axis went too; it clipped
any farm that ran a seventh session in a semester.

**The report calendar.** It ran from the January of the accreditation *year*:

    const accreditYear = parseInt(String(myFarm.accreditedSince).substring(0, 4), 10);
    for (let yr = accreditYear; yr < accreditYear + 5; yr += 1) { … }

So a site accredited **2026-09-04** opened its dashboard to *Semester 1 2026*
and *Semester 2 2026* both marked **OVERDUE** — due 2026-01-31 and 2026-07-31,
seven and two months before it was accredited. The calendar is now bounded by
the certificate itself: a period is owed only if it falls due after the
accreditation date and on or before the expiry date. Same ten periods, none of
them fabricated.

**The counters behind both.** `farms.visitors_this_year` and
`farms.training_sessions` are shown on the operator dashboard, the farm record
and the public directory — and nothing in the application had ever written
them. They held whatever the seed put there, so a farm accredited through the
system would have displayed **0 for ever**, however many reports its operator
filed. `reportModel.syncFarmCounters()` now re-derives both from the reports
table whenever a report is created — re-derived rather than incremented, so a
correction later cannot leave them drifting, and running it over an existing
farm repairs it. Running it once over the current data corrected the seeded
Reyes Integrated Farm from an all-time 189 / 14 to its actual current-year
95 / 7, which is what the label "Visitors This Year" claims.

**The compliance panel.** The checklist itself is real — 18 requirements in
`compliance_requirements`, each carrying its most recent recorded check — but
the dashboard collapsed five states into three on the way to the screen:

    status: c.status === 'compliant' ? 'compliant'
          : c.status === 'partial' ? 'partial'
          : c.status === 'not_applicable' ? 'compliant'
          : 'non-compliant',

`pending` is the catalogue's own word for **"Not yet checked"**, and it was
being rendered as `non-compliant`. A farm accredited yesterday, with zero
recorded checks, opened its dashboard to a column of red crosses accusing it of
failing every requirement — and a **0%** compliance score in red beside them.
The other half of the collapse claimed the opposite: `not_applicable` was drawn
as **compliant**, asserting compliance with requirements that do not apply.

The panel now carries the five real states with the model's own labels, and a
farm nobody has checked is reported as *Not yet assessed* rather than as failing
— on the stat card and in the gauge. This is not a new policy: `recomputeFarmScore()`
already stores `NULL` rather than 0 for an unassessed farm, with the comment
*"Writing 0 would read as 'assessed, met nothing', which is a different and much
worse claim to make about someone's farm."* The dashboard was the one place that
ignored a rule the rest of the module already followed. The `/compliance` pages
were already honest about it (*"have never been checked"*, *"unchecked"*).

**Check.** `tests/dashboard_test.js` builds a farm accredited in September,
opens its dashboard, and asserts that nothing is charted, nothing is overdue and
nothing is marked non-compliant before anyone has checked or reported anything;
then records one failed check and asserts it appears as a finding while the rest
stay merely unchecked; then files one report and asserts the chart carries that
report's own numbers under its own period label, and that the farm's counters
followed.

## The certificate was issued, but the Learning Site was never created ✅ Fixed (2026-09-04)

Asked by the team: *"what happens when an applicant is already fully
accredited?"* The answer, before this fix, was **almost nothing**.

`POST /accreditation/:id/step/7` stamped the applicant row — status
`approved`, step 7, progress 100, certificate number, issue date, valid-until,
MOA date — sent the "certificate has been issued" notification, and stopped.

It never created a `farms` row, because **no code in the running application
could**: `models/farmModel.js` had `findAll`, `findById`, `findFiltered`,
`countByProvince` and `getApplicantIdForFarm`, and no insert of any kind. The
only `INSERT INTO farms` in the repository was in the one-off JSON migration
script. Nor did it change the account: the newly accredited operator stayed
`role = 'applicant'` with `farm_id` NULL.

Every capability the certificate is supposed to confer reads one of those two
things:

| reads `farms` | reads `role` / `farm_id` |
|---|---|
| Renewal (`routes/renewal.js`) | the operator dashboard and everything on it |
| the renewal reminder job (`renewalModel.findExpiringFarms`) | the MOA obligations it tracks |
| LSA II up-scaling (`routes/lsa2.js`) | Compliance, Reports, Assistance |
| the public LSA directory | the navigation the person is offered |
| the RSC-07 registry export | |

So the observable behaviour was:

- `/renewal` answered the freshly certified operator with *"Renewal applies to
  Learning Sites that are already accredited."* — they were. Their five-year
  certificate could not be renewed from their own account.
- The reminder job reads the `farms` table; the expiry lived in
  `applicants.step7_valid_until`, which nothing schedules against. No warning
  either.
- The accredited site never appeared in the public directory or the registry
  export.
- The MOA the operator had just signed obliges them to submit a semestral
  accomplishment report; the report calendar is on the operator dashboard,
  which they could not reach.
- The services suitability panel showed a certified LSA to reviewers as
  *"Applicant · step 7 of 7"*, because `standingOf()` finds no farm.

**The fix.** `services/certification.js` — one `certify()` used by both the
Step 7 route and the backfill script, so they cannot drift. It creates the
Learning Site from the application (name, operator, location, barangay,
classification, LSA type, area and the Step 5 geo-tag are all copied, never
re-asked), sets `accreditation_level` to **LSA I** — what the Step 7
certificate and MOA actually award — dates it from the certificate, and
promotes the account to `operator` pointed at the new farm.

Two deliberate choices:

- `certify()` runs **before** `advanceStep()`. If the Learning Site cannot be
  created, the certificate is not issued either, rather than leaving behind a
  second certified application with nowhere to be certified.
- It is keyed on `applicant_id`, not on the farm name — two applicants may
  well name their farms the same thing — so a re-posted Step 7 finds the
  existing site and creates nothing.

`userModel.promoteToOperator()` writes only `role` and `farm_id`; the existing
`updateUser()` rewrites eleven columns from a form and would have needed every
other field re-supplied.

**Backfill.** `npm run backfill:farms` lists certified applications with no
Learning Site and creates them with the same `certify()`; `--apply` makes the
change. LSA-2026-0001 (certificate ATI-LSA-RegionV-2026-0262, valid to
2031-09-04) became farm 35 and its account became that farm's LSA Operator.

**Check.** `tests/certification_test.js` registers an application, issues its
certificate over HTTP, and asserts the farm exists with the application's own
values, that the account was promoted, that Renewal, LSA II, the operator
dashboard and the public directory all now answer for that operator, and that
issuing twice still leaves exactly one Learning Site.

A side-effect worth recording: certification means the database can hold **no
applicant account at all**. `tests/documents_test.js` had been finding one by
role, and silently skipped its "an applicant cannot review their own document"
authorisation check the moment the last applicant was promoted. It now creates
the account it needs.

## Registration never asked for what the application is judged on ✅ Fixed (2026-09-04)

Spotted by the team from the staff edit form: it marks **LSA Type**, **Applicant
Category**, **LSA Classification** and **Farm Area** as required, and
self-registration asked for none of them. The form posted only name, email,
phone, farm name, farm address and location, so every applicant record was
created on assumed defaults:

| field | what registration produced | consequence |
|---|---|---|
| `farm_area` | `0` | `checkArea()` returned "has not been recorded yet" — the minimum-area rule could not be evaluated for any self-registration |
| `classification` | `''` | the blank Classification column on the Applications list |
| `category` | `'private'` assumed | see below |
| `lsa_type` | `'regular'` assumed | the Coco-LSA area rule (1 ha, not 1,000 sq.m.) never applied |

**The damaging one is category.** `applicants.total_docs` is computed **at
registration** from category and classification, so a farmers' organisation or
an agri-processing enterprise was handed the private-farm document list. The
test measures it: an organisation owes **19** documents where the private
default is **16** — the board resolution, the SEC/CDA registration and the BIR
registration were simply never asked for.

The four fields (plus the optional RSBSA / NCFRS number, itself a documentary
requirement) are now on the applicant step of the registration form, with the
classification list read from `config/classifications.js` rather than typed out
again — the same list the staff edit form offers.

Two other places had to change for the values to survive: `routes/index.js`
passes the option lists to the login page, and `controllers/authController.js`
was destructuring the body without them, so they would have been dropped between
the form and `registerFarmer()` even once the form sent them.

Omitting them still works and still falls back to the old defaults, so nothing
that posts to `/api/auth/register` without them breaks.

Checked by `npm run test:registration` — 20 checks, including that the form
carries all five inputs, that an organisation registering as Coco-LSA on 2,500
sq.m. keeps every answer, that the area rule can now be evaluated at all (and
correctly reports 2,500 sq.m. as short of the 1-hectare Coco rule), that
`total_docs` is stored as the organisation's larger number, and that a
registration omitting them all still succeeds.

## Services — deciding an enrolment with nothing to decide on ✅ Built (2026-09-04)

Raised by the team: in Services, staff should check the person's information to
see whether they suit the service.

A service records `target_beneficiaries` and `eligibility` — "Accredited LSA I
and LSA II operators" on Training of Trainers, for instance — and the
participants table asked staff to set an application status against exactly
that. The row being decided carried **the name, the email, the role, the
application id and the farm name**. Nothing said whether the person was a
certified LSA or still an applicant, what they farm, or where they are.

`PARTICIPANT_SELECT` now also returns the applicant's status, accreditation
step, classification, category, province and farm area; the accredited farm
joined through `farms.applicant_id` (or `users.farm_id` for an operator); and a
count of services the person has actually attended — the track record PDF p.16
uses for LSA II up-scaling.

`standingOf()` derives the one thing a reviewer looks at first, in the model so
every page states it identically: **Certified LSA**, **LSA — lapsed**,
**Applicant · step N of 7**, or none on record. It is shown as a pill that
carries its own words, never colour alone.

The service's eligibility and target beneficiaries are repeated directly above
the participants table, so the criteria and the decision are on one screen
rather than one being recalled from a panel further up the page.

Checked by `npm run test:services` — the suite now also asserts the participant
carries a standing, that the standing names its state in words, that a count of
attended services is present, and that the reviewer sees both the standing and
the criteria on the page.

**Two things worth recording about how this went wrong first.** The join was
written as `a.farm_id`, which does not exist — the link runs
`farms.applicant_id → applicants.id`. And the page then threw
`Cannot read properties of undefined (reading 'state')` in the browser while the
tests passed: the running server had the **new view** and the **old model**,
because Node caches required modules and only `.ejs` and `public/` reload from
disk. Any change under `routes/`, `models/` or `config/` needs the server
restarted; `nodemon` does it automatically and is already a devDependency.

## Calamity evidence had nowhere to go ✅ Built (2026-09-04)

Asked by the team, looking at the calamity warning box: where are those three
documents submitted, and who validates them? **Nowhere, and nobody.**

PDF p.28 lists three things a calamity request must be supported by, and the
form printed all three. Nothing could receive them: no file input on any
assistance page, and no column in `assistance_records`, `assistance_items` or
`assistance_completion_reports` pointing at a document. `CALAMITY_EVIDENCE` was
a display-only array. The system stated a documentary requirement from the
guidelines and could not satisfy it — the same shape as the document review gap.

**Built on the `documents` table rather than beside it.** Migration `025` adds
`documents.assistance_id`, so evidence gets the upload path, the random-hex file
naming, the authorised download route and the accept/reject-with-remarks review
an evaluator already uses at Step 4 — reviewed by the same people, with the same
audit trail. A parallel table would have duplicated all of it.

The request page now lists the three requirements with a tick or an empty
circle, shows each attached file with its review status and any remarks, and
offers an upload naming which requirement it satisfies. Evidence arrives
`pending_review`: nobody self-verifies. **Who validates it** is the evaluator or
administrator, at `/documents/:id/review`, exactly as at Step 4.

Three defects surfaced while building it, each caught by the test rather than by
reading:

1. **Migration 025's own assumption was wrong.** It claimed "an assistance
   record carries the farm's applicant_id, so an evidence row always has one".
   A farm may have no applicant linked — the seeded Reyes Integrated Farm has
   none — and the first upload failed on `Column 'applicant_id' cannot be null`.
   Migration `026` makes the column optional; accreditation paths still set it.
2. **The render options landed on the wrong page.** `calamityEvidence` appears in
   both the list and detail renders and `String.replace` takes the first, so the
   detail page threw `evidenceItems is not defined`.
3. **A refused upload orphaned its file.** multer writes to disk before the
   handler runs, so every path that turns a request away leaves the bytes behind
   with nothing pointing at them. Both this route and `POST /documents/submit`
   now discard the file on each refusal — seven had accumulated in `uploads/`.
   `assistanceModel.remove()` had the same hole from the other direction: the
   database cascade drops evidence rows but cannot delete files, so it now goes
   through `documentModel.removeWhere` first.

Checked by `npm run test:evidence` — 22 checks, including that all three show as
outstanding until filed, that an upload is tied to the request and titled with
the requirement wording, that it arrives `pending_review`, that it downloads
through the normal document route, that a missing or invented requirement key is
refused and writes no row, that an operator cannot attach to another farm's
request, and that staff can reject it with a reason.

## Assistance — one officer could approve their own request ✅ Fixed (2026-09-04)

Asked after the Services fix: can staff request assistance too? They can, and
**that part is correct** — it is not the Services defect repeated:

- The route and the page agree. `canRequest` and `POST /assistance` enforce the
  same list, so there is no button offered that the route would refuse.
- **Staff can never be the beneficiary.** The requester must name a farm
  (`role === 'operator' ? currentUser.farmId : Number(req.body.farmId)`), and the
  record stores `farm_id` and `applicant_id`. Compare Services, where
  `addParticipant(id, currentUser.id, …)` made the staff member themselves the
  participant. Here the money goes to a farm and the officer's name is recorded
  as who filed it — the same pattern as staff registering a farmer on their behalf.

**What was wrong was who decides.** `POST /:reference/advance` checked only
`STAFF.includes(role)`. Nothing compared the approver to the requester, proved
end to end: one evaluator filed a PhP 5,000 facility request and approved it
herself, two requests, no second party. (The probe row was removed.)

**The rule applied: the person who filed a request does not decide it.**

Why not "administrators only", which would have matched Step 7 and renewal:

1. It does not close the hole. An administrator can file on a farm's behalf and
   then approve their own filing — the test asserts they now cannot.
2. Admin-only *combined* with this rule deadlocks an office with a single
   director: they file, and nobody can ever approve it.

Only the **decision** stages (`approved`, `rejected`) are blocked. Recording a
review or an ocular inspection stays with the filer, because the officer who
filed on a farm's behalf is often the one who did them; blocking everything
would make the rule unusable rather than safe.

Migration `024` adds `requested_by_user_id`. The check matches on the user id,
not on `requested_by`, which is a display name — comparing names would fail the
moment two staff share one or somebody is renamed, and neither is an acceptable
failure mode for a control over public money. Rows written before the column
existed fall back to the name rather than letting a decision through.

Checked by `npm run test:assistance` — 16 checks, including that the filer is
refused 403 on both approve and reject while the record stays untouched, that
they may still record a review and an inspection, that a second officer can
decide it, that the rule applies to the administrator too, and that the page
does not offer a decision the route will refuse.

## Services — ATI staff could enrol as beneficiaries ✅ Fixed (2026-09-04)

Raised by the team: *"in services evaluator can benefit the programs? I thought
she just verifies it just like the admin did."* Correct, and the system did not
enforce it.

`POST /services/:id/apply` had **no role check at all**, and the "Your
participation" card with its Enrol button rendered for every signed-in user. So
an evaluator could sign up as a beneficiary of a training they are meant to be
delivering — and one had: `evaluator@ati-bicol.da.gov.ph` was participant 46 in
"Artificial Insemination (AI) sa Barangay", which is where the Services page's
"0/1 Attended / Enrolled" came from.

Every other path on that page already drew the line the team described:
`STAFF = ['admin','evaluator']` gates creating and editing a service, and
participation outcomes are recorded through `POST /:id/participants/:pid`,
which is staff-only. Enrolment was the one route that never got the matching
gate. Staff are now refused with a message pointing them at the participants
list, and the card is not offered to them in the first place — the button and
the route are both closed, since a hidden button is not an authorisation check.

The one enrolment the defect had already created was removed; the operator and
applicant paths are unchanged.

Checked by `npm run test:services` — 13 checks, including that an admin and an
evaluator are both refused with 403 and write no row, that neither is shown the
button, that an operator may still enrol, and that the staff-only management
routes still work.

## Programs and Compliance — summary tiles that were never styled ✅ Done (2026-09-04)

Compliance, Services, LSA II and Assistance each write `.stat-value` and
`.stat-label` directly inside `.stat-card`. **Neither class had any CSS** — they
were written into four views and never defined — and `.stat-card` is
`display: flex; align-items: center`, built for the dashboard's [icon][info]
pair. So the two divs became flex siblings and every tile rendered as
"1  LSA farms monitored" on a single line with the number at body size. Not
stylistic drift: two classes that never existed.

They are now defined, and `.stat-card:has(.stat-value)` stacks the variant that
carries no icon, so the four pages gain the dashboard's hierarchy without the
dashboard's tiles changing. `:has()` avoids adding a modifier class to four
views; `flex-wrap` keeps the tiles legible if it is unsupported.

**Thirty links on the Services page rendered in Bootstrap blue** (`#0d6efd`),
including every service card title — the loudest colour on the page was one the
design system uses nowhere. Bootstrap 5.3 composes link colour from an RGB
triplet, so `--bs-link-color-rgb` is what had to change. Zero blue links remain
anywhere in the app.

Also fixed:

- **Zero open findings was coloured amber.** The one number on the compliance
  page that says nothing is wrong was styled as a warning. It is now neutral
  until the count is above zero.
- The compliance meter put the percentage beside a shrinking bar with the counts
  wrapping underneath. Score and count now share a baseline above a full-width
  bar, and the bar carries `role="progressbar"` with its values.
- The Assistance empty state was the bare line "No assistance requests yet." It
  now explains what the space is for and offers the action.

Verified in a browser across 13 pages: all 200, no table overflows its
container, no Bootstrap-blue links.

**A test leak found while doing this.** The renewal test deleted notifications
by `user_id` for the users it created — but `renewalDue()` and
`renewalSubmitted()` also notify ATI staff, who are real seeded accounts. **68 of
the 142 notifications in the administrator's bell were test residue.** Removed,
and the test now clears anything naming a farm it created; a full run leaves the
count unchanged.

## UI refinement — geometry as a system ✅ Done (2026-09-04)

The ui-ux-pro-max data places this product under **Government/Public Service**,
whose recorded direction is *"Accessible & Ethical + Minimalism & Swiss Style"*,
an Executive Dashboard layout, and the note *"WCAG AAA mandatory. Trust
paramount."* One deliberate deviation: that entry recommends a professional blue,
and Agri-AIMS stays green because the green is ATI/DA's own and already clears
contrast. Brand identity outranks a generic palette recommendation.

The earlier pass fixed what was measurably broken — contrast, focus rings, touch
targets, the button size ladder. What it did not fix is that the **geometry was
never a system**. Measuring both stylesheets found:

| | before |
|---|---|
| distinct font sizes | 25 (9px to 120px) |
| distinct border radii | 13 |
| distinct box-shadows | 20, of which 4 were tokens |
| distinct padding values | 65 |
| tokens for type, space or radius | none — only colour was tokenised |

`public/css/ejs-styles.css` now declares a type, spacing and radius scale, and
the recurring components read from it.

**Defects found by rendering the pages, not by reading the CSS:**

- `.page-title` was 36px with a gradient clipped to the text. Gradient text
  cannot be contrast-measured — it renders as whatever the gradient happens to
  be behind each glyph — and it competed with the brand wordmark for first read.
  Now 28px, solid `--primary-dark`.
- Table headers were the same colour and weight as the data, so the labels read
  as loudly as the record. Now 12px, uppercase, letter-spaced, secondary colour.
- The status pill wrapped inside itself: "Document Review" rendered as
  "Document" / "Review", which reads as two states.
- `2026-09-04` wrapped to `2026-09-` / `04`. Dates and reference numbers are
  now `nowrap` with `tabular-nums`.
- The Classification column rendered an **empty grey pill** for every applicant
  with no classification set. It now shows an em dash.
- The dashboard's "Recent Applications" card carried `h-100`, stretching it to
  the height of the chart beside it — roughly 450px of empty white under a
  single row. Removed; the card sizes to its content.
- Quick Actions used `auto-fit/minmax(140px)`, fitting three tiles and leaving
  the fourth alone on its own row. Now a 2×2 grid the four items fill exactly.
- The floating assistant covered the footer's "All rights reserved".

**A regression I introduced and caught by measuring:** `white-space: nowrap` on
table headers made "CLASSIFICATION" wider than its column and pushed the Actions
column off the edge. A header may wrap; a data value may not. Cell padding then
came down from 16px to 12px, which removed the overflow and took the row from
90px to 76px.

Verified in a browser across 11 pages — all render 200, no table overflows its
container, and no page scrolls horizontally.

## A drawn signature on the briefer ✅ Built (2026-09-04)

Step 1 captured a **typed name** and labelled the field "Signature (Type full
name to confirm)". That is an acknowledgement, not a signature — anyone with the
account can type the name, and the generated ATI-QF-PAD-162 carried no mark made
by the applicant's own hand.

The briefer now has a canvas signature pad. The mark is stored as a PNG under a
random hex name in `uploads/`, the filename in `applicants.step1_signature_file`
(migration 023), and `services/formPdf.js` prints it on the generated briefer
above the printed name — signature over printed name, as on the paper form.

**The data URL is entirely under the client's control**, so `services/signature.js`
trusts none of it: the prefix must be `data:image/png;base64,`, the body must be
real base64, the decoded bytes must begin with the eight-byte PNG signature, and
the size is capped at 200 KB. An SVG with an `onload` handler base64-encoded
into a PNG data URL is refused by the magic-number check, and the test asserts
exactly that.

Two deliberate choices:

1. **The drawn mark is optional and the typed name stays.** A canvas cannot be
   operated by keyboard or screen reader, so making it mandatory would lock
   those applicants out of the procedure entirely. Typing the name remains a
   valid acknowledgement, and the PDF then reads "Printed name (acknowledged
   electronically)" instead of "Signature over printed name", so the document
   never overstates what happened.
2. **No signature-pad library.** A canvas with pointer events is about forty
   lines and covers mouse, finger and stylus alike; `touch-action: none` is what
   stops a finger scrolling the page instead of drawing.

Re-signing replaces the previous mark and deletes the old file rather than
orphaning it on disk.

Checked by `npm run test:signature` — 33 checks, including every refusal above,
that the filed briefer really contains an embedded image, that a briefer without
a drawn mark contains none, that a missing signature file still produces a
document, and that the pad's inline script carries its CSP nonce.

## Steps 1 and 2 file their own forms as PDFs ✅ Built (2026-09-04)

`signed_briefer` (ATI-QF-PAD-162) and `self_assessment` (ATI-QF-PAD-164) are
the first two of the twelve documentary requirements. The applicant completes
both **on screen** at Steps 1 and 2 — the declarations, the signature name, and
every checklist answer were already being stored — and then Step 3 asked them to
upload those same two forms, which they had no paper copy of.

`services/formPdf.js` renders each form from what was actually recorded and
files it through the same path an upload takes: random-hex filename in
`uploads/`, a `documents` row, replacing any previous copy of the same
requirement. Step 3 already matches requirements to documents by type, so both
now show as submitted with no change to that view.

Three decisions worth stating at the defence:

1. The filed form is **`pending_review`**, not `verified`. It is generated from
   the applicant's own submission, so letting it arrive accepted would let an
   applicant self-verify a requirement — and with the Step 4 gate now in place,
   that would help pass the step.
2. A failure to render **must not block the applicant**. Filing is wrapped so a
   PDF error is logged and the step still advances; the manual upload at Step 3
   remains available.
3. `pdfkit` was added as a dependency. Nothing in the stack generated PDFs, and
   a hand-rolled writer would mangle the ñ in Filipino names and places — the
   test renders "Iñigo Muñoz" of "Peñafrancia Farm" and reads the bytes back to
   prove it does not.

`applicants.documents`, the stored count, was maintained only inside the upload
route; anything else creating a document left it behind. It is now
`documentModel.syncCount()`, called by both.

Checked by `npm run test:forms` — 21 checks, including that the file on disk
is a PDF, that it cannot escape the uploads directory, that re-signing replaces
rather than duplicates, and that it downloads through `/documents/:id/file`.

## Document review — accept / reject with remarks ✅ Built (2026-09-03)

Reported by the team: *"in submitting document there is no function that will
give the status accepted and rejected and then the remarks."* Correct, and the
consequence was larger than a missing button.

**What was there.** `documents.status` and `documents.remarks` have existed
since the first schema and were read in four places — `statsGlobal()` on the
documents page, `countVerifiedForApplicantIds()` on the dashboard,
`findVerifiedByApplicant()` which builds Step 6's endorsement packet, and the
status filter and remarks column in the documents table. **A grep for
`UPDATE documents` across the whole project returned nothing.** Every upload
was written as `pending_review` and could never leave that state; the only
`verified` rows in the database were seeded ones. So the dashboard's verified
count could only ever fall, and a real application's endorsement packet at Step
6 would always be empty.

Step 4 recorded one verdict — `passed` or `returned` — for the whole
application, with one free-text remark, on the applicant row. An evaluator who
found one unreadable page out of twelve documents could only return the entire
application with a note that did not name the document.

**What exists now.** `POST /documents/:id/review` (admin and evaluator only),
with the decision surfaced both on the documents table and inline on the Step 4
worksheet, so the evaluator decides where they are already working.

The three statuses are the ones the application already filters, counts and
colours by — `verified` (accepted), `incomplete` (rejected), `pending_review`
(not yet looked at). No fourth word was introduced for an idea the schema
already had.

A rejection **requires remarks**, enforced in `documentModel.review()` rather
than in the form, so the rule holds for the route as well as the page: telling
an applicant to fix a document without saying what is wrong is the failure this
closes. An acceptance does not require them. Migration `022` adds
`reviewed_by` and `reviewed_at`, matching `renewal_applications` — an
accreditation record has to say who decided and when.

**Two rendering defects found on the way and fixed.** The Status cell in
`step4-docevaluation.ejs` was never closed and the Remarks cell had lost its
opening tag, so the page printed the literal text `class="text-muted small">`
and showed no status at all — on the one screen whose entire purpose is
reviewing status. And `documents.ejs` built its badge class with
`status.replace('_','-')`, producing `pending-review`, which matches no rule in
the stylesheet; the status most rows are actually in rendered as a colourless
pill.

**Step 4 now cannot be passed over undecided documents** (requested by the
team after the review feature landed). `canPassStep4()` in
[controllers/accreditationHelpers.js](../controllers/accreditationHelpers.js)
refuses a pass while any document is `pending_review` or `incomplete`, and
refuses one on an application with no documents at all. The page disables the
button and prints the reason; the route re-checks it, because a stale tab or a
direct POST does not go through the page.

**State this as a system rule, not a quoted one.** The Guidelines say Step 4 is
where documents are reviewed for "completeness and legibility" and do not spell
out what blocks a pass. What justifies it in the code is Step 6: the
endorsement packet is built from `status = 'verified'` rows only, so passing
with documents still pending would endorse an application on paperwork nobody
read and silently leave the rest out of the packet.

What the gate deliberately does **not** require is the full checklist from
`requirementsFor()`. Three of those — the Field Validation Report, the RTWG
endorsement, and the checklist itself — are produced by ATI at Steps 5 and 6,
after this one. Demanding them at Step 4 would deadlock the procedure.

Checked by `npm run test:documents` — 33 checks, including that a rejection
with no reason is refused by both the model and the route, that an applicant
cannot review their own document, and that the Step 4 page no longer emits raw
markup.

## Objective 2.5 — Renewal / re-accreditation ✅ Built (2026-09-02)

Added after checking the system against the manuscript rather than against the
Guidelines: Objective 2.5 and Table 10's "Renewal and Re-accreditation Module"
named three test cases, and only a date column existed behind them.

**What was there.** `farms.expiry_date` and `applicants.step7_valid_until` were
written at Step 7 and then read by nothing that could act on them. The five-year
period was inline arithmetic in the certificate route — `parseInt(issueDate)+5` —
so no other part of the system could ask how long a certificate runs.

**What exists now.**

| Table 10 test case | State |
|---|---|
| Accreditation Validity Tracking | `config/renewal.js` holds the one definition of the period, and Step 7 now reads it. `validityStatus()` returns active / expiring / expired / **unknown** — a farm with no expiry on record is not called "active", the same distinction the compliance score needed. |
| Re-accreditation Submission | `POST /renewal/:farmId/apply`. One application in flight per farm; an operator may only renew their own site. Approval extends `farms.expiry_date` **and** `applicants.step7_valid_until` in one transaction, so no screen can show a renewed farm with the old date. |
| Renewal Notification | `services/renewalReminders.js`, on its own 24-hour timer. Notices at 180 / 90 / 30 / 7 days to the operator and to ATI staff. |

The reminder cadence is the one invented thing here and is deliberately not a
rule: the Guidelines set no notice period, so the days are a schedule in config.
The five years are not invented — the Guidelines' own checklist item o9 has the
operator sustain the site "as LSA I for five (5) years", and Step 7 has always
issued a five-year certificate.

Reminders are sent once per farm, per expiry date, per window. That is enforced
by a unique key in `renewal_reminders` rather than by a check in the job, so two
schedulers cannot both send; and it is keyed on the expiry date so a renewed farm
starts a fresh set of windows five years later instead of being silenced by its
old rows. A farm with an application already submitted stops being chased.

Approval is administrator-only. An evaluator may review and reject, matching
Step 7, where the certificate is the administrator's to issue.

Checked by `npm run test:renewal` — 45 checks, including that an evaluator
cannot approve, that a decided application cannot be decided twice, and that
running the reminder job twice notifies nobody twice.

## RSC-07 — ATI services integration 🟡 Export built, push not; no public API exists

**Since built (2026-08-21, updated 2026-09-09).** `GET /api/export/lsa-registry?format=json|csv|xml` (`routes/api/exportRoutes.js`), admin and evaluator only, emits the accredited registry as a versioned payload (`schema: "agri-aims.lsa-registry.v1"`, with `generated_at` and `count`), as RFC 4180 CSV that downloads as a file, or as XML — one record shape in three encodings, the "via xml or Json" the RSC asks for. A staff-only `/registry` page (`routes/registry.js`) documents the endpoint and lets staff download each format. The field set is the one this section specifies, and the private fields listed below are excluded. **No ATI endpoint is invented and nothing is transmitted anywhere** — when ATI publishes an API, the only new code is the HTTP call, because the payload is already the thing to send. Still to build from the table below: outbound push on state change, `integration_logs`, and retry with backoff — all of which need an ATI destination that does not yet exist.

The original investigation follows.


**Investigation result — state this plainly in your defense:** no public, documented ATI farmer-data API was found. The only live, machine-readable ATI endpoint confirmed is the **Moodle Web Services REST endpoint on `elearn.e-extension.gov.ph`** (verified above), which serves e-learning data, not the LSA/RSBSA registry. The ATI main site (`ati2.da.gov.ph`) is Drupal with no discoverable feed or API. **Whether ATI operates an internal LSA/RSBSA API cannot be verified from the provided code or from public sources** — your team must ask ATI-RTC V directly.

Therefore: build **API-ready**, and do not claim an ATI API exists.

| Question | Recommended answer for this project |
|---|---|
| REST? JSON? XML? | Expose JSON (`Accept: application/json`) with an XML serializer behind a `?format=xml` switch — cheap to add, and government partners often ask for XML |
| Auth | Reuse your existing JWT for inbound; for outbound, config-driven bearer token/API key in `.env` — never hardcoded |
| Fields to exchange | `applicationId`, name, barangay→region codes, farm name/area, classification, LSA level, certificate no., issue/expiry dates, status |
| Keep private | `password_hash`, email, phone, exact GPS coordinates, document files, internal TWG remarks |
| Sync method | Outbound push on state change (certificate issued/renewed/revoked) + nightly reconciliation job |
| One-way or two-way | **One-way (Agri-AIMS → ATI) first.** Two-way needs a conflict policy you cannot define without ATI |
| Duplicates | Idempotency on `application_id` + `certificate_no`; upsert, never blind insert |
| Errors / retries | `integration_logs` table (endpoint, payload hash, status, response, attempt count) + exponential backoff, max 5 attempts, then flag for admin review |

---

# PART 8 — DATABASE REVIEW

## What exists and is sound

Prepared statements everywhere; sensible FKs on `farms→applicants`, `documents→applicants`, `reports→farms`, `users→farms`, `users→applicants`, `chat_messages→channels/users`; indexes on status/province/role/email; `utf8mb4` throughout; camelCase conversion isolated in [utils/caseConvert.js](../utils/caseConvert.js). **This does not need a redesign.**

## Missing tables (12)

`regions`, `provinces`, `municipalities`, `barangays`, `lsa_certifications` (LSA I/II history), `assistance_records`, `services`, `service_participants`, `compliance_requirements`, `compliance_checks`, `notifications`, `elearning_articles`, `chatbot_conversations`, `integration_logs`.

## Missing fields on existing tables

| Table | Add | Why |
|---|---|---|
| `applicants` | `barangay_code` FK, `rsbsa_number`, `is_public_official` (PDF p.41), `lsa_level` ENUM('I','II'), `assistance_type` ENUM('financial_technical','technical_only') (PDF p.26) | RSC-01, PDF p.12, p.26, p.41 |
| `applicants` | `farm_has_tda`, `farm_has_holding_area`, `farm_has_wash_area`, `farm_has_toilet` | PDF p.11 facilities, currently discarded |
| `farms` | `barangay_code` FK; **replace** `accreditation_level` "Level 1/2/3" with `lsa_level` ENUM('I','II') | ⚠️ current values have no basis in the PDF |
| `documents` | `file_path`, `mime_type`, `size_bytes` (real numeric), `uploaded_by` | files are never stored today |
| `reports` | `submitted_by`, `report_type` ENUM('semestral','project_completion') | PDF p.27 quarterly LSA Project Completion Report |
| `users` | `barangay_code`, `is_active`, `created_by_admin` | RSC-02 |

## Defects found

| ID | File | Problem |
|---|---|---|
| DB-01 | [models/documentModel.js:91](../models/documentModel.js#L91) | `create()` does `const result = await query(...)` then returns `result.insertId` — but `query()` returns the **rows array**, not the OkPacket. `insertId` is always `undefined`. (`chatMessageModel.create` does it correctly with `pool.execute`.) |
| DB-02 | schema | `documents.applicant_name`, `reports.farm_name`, `reports.operator` duplicate joinable data — denormalization that will drift after any rename |
| DB-03 | schema | `documents.size` is `VARCHAR(40)` holding `"2.4 MB"` — unsortable, uncomputable |
| DB-04 | schema | `status`, `lsa_type`, `category`, `classification` are free VARCHARs; nothing prevents `"Approved"` vs `"approved"` |
| DB-05 | [scripts/migrate-json-to-mysql.js:36-41](../scripts/migrate-json-to-mysql.js#L36-L41) | `npm run migrate` **truncates all five tables** with FK checks disabled. Safe for seeding, catastrophic if run against live data — it needs a confirmation guard |
| DB-06 | schema | No index on `farms.status`, `documents.upload_date`, `reports.submission_date`, though all three are filtered/sorted |

---

# PART 9 — SECURITY AND ACCESS CONTROL

### 🔴 SEC-01 — Anonymous visitors are served as the admin (critical)

[middleware/roleContext.js:33-34](../middleware/roleContext.js#L33-L34):

```js
if (!req.app.locals.currentUser) {
  req.app.locals.currentUser = users.find((u) => u.role === 'admin') || users[0] || null;
}
```

`roleContext` runs on **every** web route ([app.js:44](../app.js#L44)). With no JWT, `res.locals.role` becomes `'admin'`, and every page-level guard (`if (!['admin','evaluator'].includes(role))`) therefore passes. An unauthenticated visitor can browse all applicant PII, and can `POST /applicants/delete/:id` and `POST /accreditation/:id/step/7` (issue a certificate). Worse, `req.app.locals` is **application-scoped, not request-scoped** — one user's identity leaks into other concurrent requests.

Two separate bugs: (a) the demo fallback, (b) `req.app.locals` used as per-request storage.

### 🔴 SEC-02 — `?role=` switcher grants any role

[middleware/roleContext.js:27-30](../middleware/roleContext.js#L27-L30) — `?role=admin` picks the first matching user with no credential check. Documented as a feature in [SETUP.md](../SETUP.md). Must be gated behind `NODE_ENV !== 'production'` at minimum, and removed before evaluation.

### 🟠 SEC-03 — JWT stored in a JavaScript-readable cookie

[views/pages/index.ejs:311](../views/pages/index.ejs#L311) sets `document.cookie = 'agri_token=…'` from client JS. Not `HttpOnly`, not `Secure` — any XSS steals a 7-day token. The server should set this cookie itself with `HttpOnly; Secure; SameSite=Lax`.

### 🟠 SEC-04 — No CSRF protection

Every state-changing web form is a cookie-authenticated `POST` with no token: delete applicant, issue certificate, endorse. Combined with SEC-01 this is trivially exploitable.

### 🟠 SEC-05 — Secrets committed

[.env](../.env) is in the repo with `JWT_SECRET=change-this-to-a-long-random-string-in-production` — the literal default. Anyone with the repo can forge admin tokens. Add `.env` to `.gitignore`, ship `.env.example`, rotate the secret.

### 🟡 Others

| ID | Finding |
|---|---|
| SEC-06 | No rate limiting on `/api/auth/login` — unlimited password guessing |
| SEC-07 | `/documents/submit` accepts arbitrary `filename`; when real uploads land, this needs MIME allow-listing, size caps, randomized names, and storage outside the web root |
| SEC-08 | No `helmet`, so no CSP/HSTS/X-Frame-Options |
| SEC-09 | `cors({ origin: process.env.CORS_ORIGIN \|\| true, credentials: true })` ([app.js:26](../app.js#L26)) reflects **any** origin with credentials when the env var is unset |
| SEC-10 | `errorHandler` returns stack traces whenever `NODE_ENV !== 'production'` ([middleware/errorHandler.js:26-28](../middleware/errorHandler.js#L26-L28)) — and `.env` ships `NODE_ENV=development` |

### ✅ Done well

- **SQL injection:** every query is parameterized. `sortCol` in `findPaginated` is allow-listed against a `Set` ([models/userModel.js](../models/userModel.js)) — the one place dynamic SQL appears, handled correctly.
- **XSS:** EJS `<%= %>` escapes by default; the chat client escapes via `textContent`→`innerHTML` ([community.ejs:82-83](../views/pages/community.ejs#L82-L83)); `escapeHtml()` in main.js uses `createTextNode`.
- **Passwords:** bcrypt cost 12, strength rules enforced, hash never selected into public queries.
- **API authorization:** `/api/users` is properly JWT + role gated, and non-admins cannot escalate `role`/`farmId`/`applicationId` ([controllers/userController.js:110-113](../controllers/userController.js#L110-L113)).

**Net:** the **REST API is well secured; the EJS web layer is effectively unauthenticated.** Fixing SEC-01 and SEC-02 is the single highest-value change in this entire audit.

---

# PART 10 — FEATURE COMPLIANCE MATRIX

| ID | Requirement | Source | Status | Existing code | Missing / problem | Recommended change | Priority |
|---|---|---|---|---|---|---|---|
| LSA-01 | 7-step LSA I certification procedure | PDF p.17, 20 | ✅ | `routes/accreditation.js` (625 lines) | — | Keep as-is | — |
| LSA-02 | LSA I documentary requirements | PDF p.18-19 | ✅ | `config/documentRequirements.js` — 24 types | — | Done — full p.18-19 packet incl. conditional agri-processing / organization / government documents, and the Development Plan required only with financial assistance | High |
| LSA-03 | Field/virtual validation by TWG | PDF p.17 Step 5 | ✅ | `accreditation.js` + `assessment_responses` | — | Done — per-item results kept and rendered as a Field Validation Report | High |
| LSA-04 | Endorsement to ATI-CO by RTC | PDF p.17 Step 6 | ✅ | `config/organization.js` | — | Done — director, office and addresses come from configuration, overridable per deployment | Medium |
| LSA-05 | Certificate + MOA/MOU, 5-yr validity | PDF p.17 Step 7, p.37 | ✅ | `accreditation.js:566-592` | — | — | — |
| LSA-06 | LSA classification taxonomy | PDF p.9-10 | ✅ | `applicant-form.ejs:53-64` | — | — | — |
| LSA-07 | Ownership: private/org/government | PDF p.11 | ✅ | `applicants.category` | — | — | — |
| LSA-08 | Minimum area rules | PDF p.11 | ✅ | `config/farmEligibility.js` | — | Done — the rule is computed per applicant, with both exemptions | Medium |
| LSA-09 | Basic facilities TDA/holding/wash/toilet | PDF p.11 | ✅ | `assessment_responses` | — | Done — per-item rows with a `facility` key | High |
| LSA-10 | Farmer/farm-family qualifications | PDF p.12 | ✅ | `applicants.rsbsa_number` + `assessment_responses` | — | Done — RSBSA is capturable and queryable; citizenship, tiller status and the rest are per-item Step 2 rows | High |
| LSA-11 | Agri-processing enterprise requirements | PDF p.13-14 | ✅ | `config/documentRequirements.js` | — | Done — business permit, DTI/SEC and FDA registration required for agri-processing enterprises | High |
| LSA-12 | Government-owned requirements | PDF p.15 | ✅ | `config/documentRequirements.js` + `applicants.assistance_type` | — | Done — Special Order required for government-owned sites | Medium |
| LSA-13 | LSA I → II up-scaling criteria | PDF p.16 | ✅ | `config/lsa2.js`, `lsa2_applications` | — | Done — the four p.16 criteria, two computed and two recorded as ATI judgements | High |
| LSA-14 | LSA II 5-step procedure + documents | PDF p.21-23 | ✅ | `routes/lsa2.js`, `models/lsa2Model.js` | — | Done — the five-step p.21 procedure enforced in order, with the p.23 document packet | High |
| LSA-15 | Assistance: Financial+Technical vs Technical-Only | PDF p.26 | ✅ | `applicants.assistance_type` | — | Done — Financial+Technical vs Technical-Only, selectable on both intake forms | High |
| LSA-16 | ₱150k facility / ₱100k calamity + Dev Plan + quarterly report | PDF p.27-29 | ✅ | `assistance_records`, `assistance_items`, `assistance_completion_reports` | — | Done — PhP 150k / 100k ceilings, 3-month calamity window, expenditure breakdown, quarterly COA reports | Medium |
| LSA-17 | Technical assistance / ATI training participation | PDF p.30 | ✅ | `services` + `service_participants` | — | Done as RSC-04 | Medium |
| LSA-18 | Semestral accomplishment report | PDF p.37, 40 | ✅ | `POST /reports` | — | Done — operators submit the semestral report; operators are locked to their own farm | High |
| LSA-19 | Sustain 5 years / certificate validity | PDF p.37, 40 | ✅ | Step 7 + `farms.expiry_date` | — | — | — |
| LSA-20 | Miscellaneous provisions | PDF p.41-44 | 🟡 | `014_disqualification_declaration.sql` | **Disqualification now asked, answered and stored**; one-LSA-per-municipality still unenforced | Remaining: municipality uniqueness rule | Medium |
| LSA-21 | National/Regional TWG composition | PDF p.33-34 | ❌ | `evaluator` role approximates | No TWG membership | `twg_members` table (optional) | Low |
| LSA-22 | ATI field monitoring visits | PDF p.37 | ✅ | `compliance_checks` | — | Done as RSC-05 | Medium |
| **RSC-01** | Separate Barangay | RSC | ✅ | 4 PSGC tables + cascading selects | — | Done — full Region V loaded | **High** |
| **RSC-02** | Admin registers farmers | RSC | ✅ | `/admin/farmers/new` | — | Done — one intake form, optional login account | **High** |
| **RSC-03** | e-Learning monitoring | RSC | ✅ | `elearning_articles`, Moodle driver + manual fallback | ATI-issued token still required to run automatically | Done | Medium |
| **RSC-04** | Service monitoring | RSC | ✅ | `services`, `service_participants` | — | Done | Medium |
| **RSC-05** | Compliance monitoring | RSC | ✅ | `compliance_requirements`, `compliance_checks` | — | Done — 18 guideline-sourced requirements | **High** |
| **RSC-06** | Pre-trained chatbot | RSC | ✅ | `services/chatbotLlm.js` + `config/aiProvider.js` | **Done and configured.** A pre-trained model answers (OpenRouter `openai/gpt-4o-mini` via `@openrouter/sdk`, `isConfigured()` true), but only from snippets `chatbotKnowledge` retrieved: told to use the numbered context alone and to refuse rather than fill a gap, and the citation still comes from the retrieved snippet so it cannot be invented. Provider-agnostic (any `/chat/completions` host, three `.env` lines). Also recognises the signed-in user and tailors answers to role. With no key it degrades to retrieval, at no cost | Medium |
| **RSC-07** | ATI integration | RSC | 🟡 | `GET /api/export/lsa-registry` (`routes/api/exportRoutes.js`) + `/registry` UI | **Read side done, push side not.** The registry is exposed staff-only as versioned JSON (`agri-aims.lsa-registry.v1`), RFC 4180 CSV **and XML**, in the field set this audit specified, with a `/registry` page to download each. Still missing: outbound push on state change, `integration_logs`, and retry/backoff — blocked because ATI has published no endpoint to push to. No ATI endpoint is invented and nothing is transmitted | Low |

---

# PART 11 — IMPLEMENTATION PLAN

### Phase 1 — Critical fixes (do these before anything else)
1. **SEC-01 / SEC-02** — remove the admin fallback, move `currentUser` from `req.app.locals` to `res.locals`, gate `?role=` behind a dev flag, add a `requireAuthPage` middleware and a real `/login` redirect.
2. **SEC-03 / SEC-05** — server-set `HttpOnly` cookie; `.env` out of git, secret rotated.
3. **DB-01** — fix `documentModel.create()`'s `insertId`.
4. **DB-05** — confirmation guard on the truncating migration script.
5. **LSA-18** — add semestral report submission (operator responsibility, PDF p.37).

### Phase 2 — RSC features (in this order)
6. **RSC-01** barangay hierarchy → 7. **RSC-02** admin farmer registration → 8. `notifications` table + `/api/notifications` → 9. **RSC-04** services → 10. **RSC-05** compliance → 11. **RSC-03** e-learning ingestion + auto-post + notify.

*(Barangay first: services, compliance, and admin registration all reference location, and retrofitting is far more expensive than ordering it correctly.)*

### Phase 3 — AI
12. `knowledge_base` seeded from the LSA PDF → 13. `POST /api/chatbot` with retrieval grounding + citations → 14. rewire the widget, keep the keyword answers as an offline fallback.

### Phase 4 — ATI integration
15. Read-only JSON/XML export of certified farmers → 16. `integration_logs` + retry worker → 17. activate against a real ATI endpoint *if and when* ATI provides one.

### Also in scope for LSA completeness (parallel with Phase 2)
LSA-09 facilities fields, LSA-03 checklist persistence, LSA-11/12 document types, then LSA-13/14 (LSA II) and LSA-15/16 (assistance).

---

# PART 12 — CODE CHANGES

Per your instruction, **no code has been modified**. This section states what to change and why; each item is written against your actual structure (`routes/` → `controllers/` → `models/`, camelCase JS ↔ snake_case SQL via `utils/caseConvert.js`, `asyncHandler` for API, `res.render('pages/error', …)` for web).

### CH-01 — Fix the authentication bypass 🔴

- **File:** [middleware/roleContext.js](../middleware/roleContext.js)
- **Problem:** lines 33-34 default anonymous visitors to the admin user; `req.app.locals.currentUser` is process-wide, so identities cross between concurrent requests.
- **Change:** delete the admin fallback; set `res.locals.currentUser = chosen || null` and `res.locals.role = chosen ? chosen.role : 'guest'`; wrap the `?role=` branch in `if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_ROLE_SWITCH === 'true')`; stop writing to `req.app.locals` entirely.
- **Why:** without it every guard in `routes/*.js` evaluates against `'admin'`, so all RBAC in the app is decorative.
- **Companion:** add `middleware/requireAuthPage.js` (redirects guests to `/`) and mount it on `/dashboard`, `/applicants`, `/accreditation`, `/documents`, `/farms`, `/reports` in [app.js](../app.js) — leave `/`, `/directory`, `/api/auth` public.
- **Migration:** none.
- **Test:** in a private window with no cookie, `GET /applicants` must redirect to `/`; `POST /applicants/delete/1` must not delete; `GET /dashboard?role=admin` must not elevate; log in as `operator` and confirm `/applicants` still 403s.

### CH-02 — Server-set secure cookie 🔴

- **Files:** [controllers/authController.js](../controllers/authController.js) (`login`, `register`), [views/pages/index.ejs:311,362](../views/pages/index.ejs#L311)
- **Change:** in both handlers, `res.append('Set-Cookie', \`agri_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}\`)` — mirroring the existing `logout` which already uses `res.append('Set-Cookie', …)`. Remove both `document.cookie = …` lines from the client.
- **Why:** a JS-readable 7-day admin token is one XSS away from total compromise.
- **Test:** log in, confirm DevTools → Application → Cookies shows `HttpOnly ✓`, and `document.cookie` in the console does **not** contain `agri_token`; confirm you still reach `/dashboard`.

### CH-03 — Fix `documentModel.create()` 🟠

- **File:** [models/documentModel.js:88-104](../models/documentModel.js#L88)
- **Problem:** `query()` returns rows; `result.insertId` is `undefined`.
- **Change:** mirror [models/chatMessageModel.js](../models/chatMessageModel.js) — `const [res] = await pool.execute(sql, [...]); return res.insertId;` (import `pool` alongside `query`).
- **Test:** submit a document; the returned id must be a positive integer, and `SELECT MAX(id) FROM documents` must match it.

### CH-04 — Location hierarchy (RSC-01)

- **New file:** `database/migrations/003_location_hierarchy.sql`
  - `regions(code CHAR(10) PK, name)`, `provinces(code PK, region_code FK, name)`, `municipalities(code PK, province_code FK, name)`, `barangays(code PK, municipality_code FK, name)` — all PSGC-keyed, InnoDB/utf8mb4 to match the existing style.
  - `ALTER TABLE applicants ADD barangay_code CHAR(10) NULL, ADD KEY idx_applicants_barangay (barangay_code), ADD CONSTRAINT fk_applicants_barangay FOREIGN KEY (barangay_code) REFERENCES barangays(code) ON DELETE SET NULL;` — same for `farms` and `users`.
  - **Keep** `region`/`province`/`municipality`/`farm_address` for now; dual-write during transition.
- **New file:** `models/locationModel.js` — `findRegions()`, `findProvinces(regionCode)`, `findMunicipalities(provinceCode)`, `findBarangays(municipalityCode)`, all via `query()` + `rowToCamel`.
- **New file:** `routes/api/locationRoutes.js`, mounted in [routes/api/index.js](../routes/api/index.js) as `/locations`.
- **Edit:** [views/pages/applicant-form.ejs:137-155](../views/pages/applicant-form.ejs#L137) — replace the hardcoded region `<select>` and the province/municipality text inputs with four cascading selects fed by those endpoints; add the same block to the registration form in [views/pages/index.ejs:162-191](../views/pages/index.ejs#L162).
- **Edit:** [models/applicantModel.js](../models/applicantModel.js) — add `barangayCode: 'barangay_code'` to `CAMEL_TO_COL`, to `SELECT_BASE`, to `create()`/`update()`, and a `barangayCode` filter in `findFiltered()`.
- **Test:** create an applicant through the admin form choosing Region V → Camarines Sur → Naga City → Brgy. San Jose; verify the row stores the barangay **code**; verify filtering by barangay returns it; verify existing rows with `barangay_code = NULL` still render.

### CH-05 — Admin farmer registration (RSC-02)

- **New files:** `controllers/adminFarmerController.js`, `routes/admin.js` (mounted at `/admin` in `app.js`), `views/pages/admin/farmer-form.ejs`.
- **Change:** lift the transactional block from [authController.register:110-190](../controllers/authController.js#L110) into a shared `services/farmerRegistration.js` used by both self-registration and the admin path, so application-ID generation stays in one place. Admin path additionally accepts barangay, classification, RSBSA number, facilities booleans, initial status, and an optional generated password.
- **Authorization:** `requireRole('admin')` from [middleware/auth.js](../middleware/auth.js#L66) on the API side, `requireAuthPage` + role check on the page side.
- **Migration:** `ALTER TABLE users ADD created_by_admin TINYINT(1) NOT NULL DEFAULT 0, ADD is_active TINYINT(1) NOT NULL DEFAULT 1;`
- **Test:** as admin, create a farmer; confirm one `users` row **and** one `applicants` row with matching `application_id`; confirm the farmer can log in; confirm an `evaluator` gets 403 on the same route; kill the DB mid-request and confirm the transaction rolls back (no orphan user).

*(Detailed diffs for RSC-03 through RSC-07 follow the same shape and should be written once Phase 1–2 land — the tables above specify their columns.)*

---

# PART 13 — FINAL OUTPUT

## 1. Overall alignment score

**LSA (PDF) alignment: 41 %** — from the 22 PDF-derived requirements in Part 10, scoring ✅ = 1.0, 🟡 = 0.5, ❌/⚠️ = 0: `(5 × 1.0) + (8 × 0.5) + (9 × 0) = 9.0 / 22 = 40.9 %`.

**RSC alignment: 14 %** — RSC-02 = 0.5, RSC-05 = 0.25, RSC-06 = 0.25, the rest 0: `1.0 / 7 = 14.3 %`.

**Overall ≈ 33 %** (0.409 × 0.7 + 0.143 × 0.3). Only verifiable, code-backed implementation was counted; hardcoded UI that merely *looks* like a feature scored zero.

## 2. Critical missing features

1. Authentication on the entire web UI (SEC-01/SEC-02).
2. LSA I vs LSA II as a first-class concept — the PDF's central distinction.
3. The whole LSA II certification path (PDF p.16, 21-23).
4. Provision of assistance: amounts, development plans, completion reports (PDF p.26-29).
5. Real compliance monitoring (today it is decoration).
6. Semestral report submission (PDF p.37).
7. Actual file storage for the 12 documentary requirements.
8. Barangay as structured data.
9. A notifications backend.
10. An AI chatbot that is neither AI nor correct about your own workflow.

## Objective 2.5 and RSC-07 — update 2026-09-02

`GET /api/export/lsa-registry?format=xml` now exists beside `json` and `csv`.
The RSC asks for the registry to reach ATI Services "via xml or Json"; both
halves of that "or" are now available from the same record shape, so whichever
an eventual ATI endpoint accepts, the payload is already the thing to send.

This does not change the finding below: **nothing is pushed anywhere**, because
ATI publishes no endpoint to push to. What changed is that the format is no
longer a reason it could not be.

## 3. RSC status

| RSC | Status |
|---|---|
| 01 Separate barangay | ✅ Implemented (Phase 2) |
| 02 Admin registers farmers | ✅ Implemented (Phase 2) |
| 03 e-Learning monitoring | ✅ Implemented — Moodle driver plus manual fallback; still needs an ATI-issued token to run automatically |
| 04 Service monitoring | ✅ Implemented (Phase 2) |
| 05 Compliance monitoring | ✅ Implemented (Phase 2) — real checks against 18 guideline-sourced requirements |
| 06 Pre-trained chatbot | 🟡 Grounded retrieval answering today; provider-agnostic model integration built but unconfigured (no `AI_API_KEY`) |
| 07 ATI integration | 🟡 Registry exports as JSON, XML and CSV — the RSC's "xml or Json" is satisfied; no outbound push, because no public ATI farmer API exists |

## 4. Database changes required

New tables: `regions`, `provinces`, `municipalities`, `barangays`, `lsa_certifications`, `assistance_records`, `services`, `service_participants`, `compliance_requirements`, `compliance_checks`, `notifications`, `elearning_articles`, `chatbot_conversations`, `integration_logs`.
Altered: `applicants` (+`barangay_code`, `rsbsa_number`, `is_public_official`, `lsa_level`, `assistance_type`, 4 facility booleans), `farms` (+`barangay_code`, `lsa_level` replacing `accreditation_level`), `documents` (+`file_path`, `mime_type`, `size_bytes`, `uploaded_by`), `reports` (+`submitted_by`, `report_type`), `users` (+`barangay_code`, `is_active`, `created_by_admin`).
Indexes: `farms.status`, `documents.upload_date`, `reports.submission_date`, plus all new FK columns.

## 5. Files that need modification

`middleware/roleContext.js` · `app.js` · `controllers/authController.js` · `views/pages/index.ejs` · `models/documentModel.js` · `scripts/migrate-json-to-mysql.js` · `.env` + new `.gitignore`/`.env.example` · `views/pages/applicant-form.ejs` · `models/applicantModel.js` · `models/farmModel.js` · `routes/reports.js` · `routes/api/index.js` · `public/js/main.js` · `views/partials/navbar.ejs` · `views/partials/chatbot.ejs` · `database/schema.sql`
New: `middleware/requireAuthPage.js` · `models/locationModel.js` · `models/serviceModel.js` · `models/complianceModel.js` · `models/notificationModel.js` · `models/articleModel.js` · `controllers/adminFarmerController.js` · `controllers/chatbotController.js` · `routes/admin.js` · `routes/services.js` · `routes/compliance.js` · `routes/api/locationRoutes.js` · `routes/api/notificationRoutes.js` · `routes/api/chatbotRoutes.js` · `services/farmerRegistration.js` · `services/elearningSource.js` · `services/atiClient.js` · `database/migrations/003…008*.sql`

## 6. Recommended development order

Security fixes → DB defects → semestral submission → barangay hierarchy → admin registration → notifications → services → compliance → e-learning ingestion → LSA II + assistance → chatbot RAG → ATI export. Each step is independently demonstrable, which matters for a capstone defense.

## 7. Risks and limitations

- **No official ATI farmer/LSA API was found.** Only the e-Extension Moodle REST endpoint is confirmed live. Whether ATI operates an internal API **cannot be verified from the provided code** — it must be asked of ATI-RTC V in writing.
- **RSC-03 is blocked on a third party.** The Moodle token can only be issued by the ATI e-Extension administrator. Build the manual-entry fallback so the feature can be demonstrated regardless.
- **AI chatbot cost is per-token and ongoing** — a capstone-scale budget is small (`claude-haiku-4-5` at $1/$5 per million tokens), but it is not zero and needs an API key the panel may ask about. Rate-limit it.
- **Sending farmer data to any external service** (AI provider or ATI) touches the Data Privacy Act of 2012. Never send names, contact details, or GPS coordinates to the model; send only the retrieved LSA text plus non-identifying context.
- **File uploads do not exist yet**, so any claim that documents are "submitted" is currently metadata only.
- **Push notifications** in the browser require HTTPS and a service worker — deferrable; in-app notifications with polling are enough for evaluation.
- Some dashboard content (`validationSchedule`, `complianceItems`, `visitorData`) is hardcoded and will not survive a panel asking "where does this number come from?"

## 8. Final recommendation

**The system is not yet sufficiently aligned with the LSA Guidelines to be presented as an LSA management system**, though the LSA I certification workflow is genuinely strong and worth defending as-is. Two things separate the current build from a defensible one:

**Must fix before any evaluation:** the authentication bypass (SEC-01/SEC-02) — a panel that opens the site in a private window lands on the admin dashboard; the committed `JWT_SECRET`; the hardcoded "compliance" and notification panels, which currently present fabricated data as system output. Either wire them to real queries or label them clearly as mockups.

**Must add for LSA completeness:** the LSA I/II distinction and the LSA II path, semestral report submission, and structured facility/qualification fields — these are the PDF's core, not optional extras.

**Then the RSCs,** in the Phase 2 order above.

A realistic target: Phase 1 + RSC-01 + RSC-02 + RSC-05 + semestral submission lifts overall alignment to roughly **60–65 %**, with every remaining gap explainable as scoped future work. That is a defensible position. The current 33 % — with an open admin panel — is not.
