# 🌿 Agri-AIMS

### A Digital Accreditation and Information Management System with AI-Assisted Support for ATI Learning Sites

**Team:** ETECHNICS  
**Stack:** Node.js · Express.js · EJS · Bootstrap 5 · Chart.js · MySQL  
**Methodology:** Agile

Agri-AIMS runs the full lifecycle of a **Learning Site for Agriculture (LSA)** for
DA-ATI Regional Training Center V (Bicol): a farmer applies, submits documentary
requirements, is field-validated and endorsed, and — once accredited — becomes an
LSA operator whose site is monitored for compliance and can up-scale from LSA I to
LSA II. Every rule the system enforces comes from the ATI LSA Guidelines, so the
data and the guidelines never drift.

---

## 📁 Project Structure

```
agri-aims/
├── config/                   # Database pool, CSP, checklists, document requirements, AI provider
├── models/                   # SQL only — one module per table/feature
├── controllers/              # HTTP + orchestration for API and dashboard
├── routes/                   # Express routers — web pages, and routes/api (REST)
├── services/                 # Cross-cutting logic: certification, notifications,
│                             #   chatbot knowledge + language model, e-learning sync
├── middleware/               # JWT auth, role context for EJS, CSRF, rate limits, errors
│
├── public/                   # Static assets (served via Express middleware)
│   ├── css/
│   │   ├── style.css         # Main design system (colors, components)
│   │   └── ejs-styles.css    # EJS layout & page-specific styles
│   ├── js/
│   │   ├── main.js           # Client-side JS (chatbot, notifications, drag)
│   │   └── actions.js        # Delegated data-* dispatcher (replaces inline onclick)
│   └── images/               # Logo and image assets
│
├── views/                    # EJS templates
│   ├── partials/             # DRY reusable components (header, navbar, footer, chatbot, …)
│   └── pages/                # Full page views (dashboard, applicants, documents, farms, …)
│
├── database/                 # schema.sql, migrations/, generated schema dump
├── scripts/                  # Seeders, SQL migration runner, one-off maintenance
├── data/                     # Legacy JSON — seed/import source only (see SETUP.md §5), not the live store
│
├── app.js                    # Main server — middleware, routing, error handlers
├── SETUP.md                  # Full backend setup: database, schema, seed data, env vars
├── package.json              # Dependencies
└── README.md                 # This file
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18 or higher, npm
- MySQL 8 (or compatible MariaDB)

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Configure the database and environment (full detail in SETUP.md)
copy .env.example .env          # set DB_PASSWORD and generate JWT_SECRET
mysql -u root -p agri_aims < database/schema.sql
npm run seed:locations          # address reference data (PSGC)

# 3. Start the server
npm start                       # http://localhost:3000
```

See **[SETUP.md](SETUP.md)** for database creation, migrations, seed data, the REST
API reference, and security notes. `.env` is gitignored and must never be committed —
`JWT_SECRET` signs the session cookie, so a shared value lets anyone forge an admin session.

### Development (with auto-reload)

```bash
npm run dev
```

---

## 🔗 Available Routes

| Method | Route                    | Description                              |
| ------ | ------------------------ | ---------------------------------------- |
| GET    | `/`                      | Login / Landing page                     |
| GET    | `/dashboard`             | Dashboard with stats & charts            |
| GET    | `/applicants`            | Applicants list (filter/search/table)    |
| GET    | `/admin/farmers/new`     | Register a farmer (admin) — application record, optionally with a login |
| POST   | `/admin/farmers`         | Create the application record, and the account when one is asked for |
| GET    | `/applicants/:id`        | Applicant detail + 7-step accreditation tracker |
| GET    | `/documents`             | Document list & per-document review      |
| POST   | `/documents/submit`      | Submit new document                      |
| GET    | `/farms`                 | LSA farm grid with compliance scores     |
| GET    | `/farms/:id`             | Farm detail with geo-tagging             |
| GET    | `/compliance/farm/:id`   | Per-farm compliance checklist            |
| GET    | `/reports`               | Monitoring reports & analytics           |
| GET    | `/community`             | Community chat channels                  |
| GET    | `/messages`              | One-to-one direct messages               |
| GET    | `/directory`             | LSA directory with search & filters      |
| GET    | `/registry`              | Accredited LSA registry export (staff)   |
| GET    | `/api/chatbot?q=`        | AgriBot answer, grounded in the LSA reference data, with its source |
| GET    | `/api/export/lsa-registry` | Accredited LSA registry as JSON, `?format=csv`, or `?format=xml` (staff only) |

---

## ✨ Key Features Implemented

1. **Centralized Accreditation Database** — MySQL-backed CRUD for applicants, farms, documents and reports (prepared statements, connection pool)
2. **Digital Accreditation Workflow** — 7-step tracker with visual progress; on certification an applicant automatically becomes an LSA operator (no re-registration)
3. **Monitoring Dashboard** — Server-injected stat cards + Chart.js doughnut
4. **Role-Based Navigation** — Dynamic navbar, role-aware pages (admin, evaluator, operator, applicant)
5. **AI Chatbot (AgriBot)** — Draggable assistant grounded in the system's own LSA knowledge; answers from that knowledge and cites it, never from the model's own training (see below)
6. **Compliance & Service Monitoring** — 18 guideline-sourced requirements per farm; training/service records
7. **Community Chat & Direct Messages** — Channel-based and one-to-one messaging
8. **LSA Directory & Geo-tagging** — Searchable/filterable farm directory with recorded GPS locations
9. **Notifications** — In-app bell, optionally mirrored to email
10. **LSA Registry Export** — Staff-only JSON / CSV / XML for ATI integration (RSC-07)
11. **Security** — JWT in an `HttpOnly` cookie, bcrypt hashing, CSRF tokens, helmet CSP (no inline scripts), rate limiting

---

## 🤖 The Chatbot (RSC-06)

AgriBot is **optional and safe by default**. With no API key it answers from the
system's own LSA knowledge — definitions, document requirements, accreditation steps,
help topics and compliance rules — using keyword retrieval, at no cost. Set
`AI_API_KEY` (any OpenAI-compatible provider) and the same knowledge is handed to a
language model, which phrases the answer and copes with reworded questions. The model
is told to answer **only** from that knowledge and to cite it, and **no applicant data
is ever sent to it**. A missing, expired or out-of-credit key silently falls back to
keyword answers, so it is never an outage; chatbot requests are rate-limited to keep a
configured model from running up a bill.

---

## 🎓 Capstone Project

**Title:** Agri-AIMS: A Digital Accreditation and Information Management System  
**Team:** ETECHNICS  
**Subject Adviser:** JOCELYN T. LIPATA, Ph.D.  
**Capstone Adviser:** JONUEL REY N. COLLE, MIS  
**SDGs:** SDG 2 – Zero Hunger · SDG 4 – Quality Education · SDG 8 – Decent Work
