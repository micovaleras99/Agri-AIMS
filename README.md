# 🌿 Agri-AIMS

### A Digital Accreditation and Information Management System with AI-Assisted Support for ATI Learning Sites

**Team:** ETECHNICS  
**Stack:** Node.js · Express.js · EJS · Bootstrap 5 · Chart.js  
**Methodology:** Agile

---

## 📁 Project Structure

```
agri-aims/
├── public/                   # Static Assets (served via Express middleware)
│   ├── css/
│   │   ├── style.css         # Main design system (colors, components)
│   │   └── ejs-styles.css    # EJS layout & page-specific styles
│   ├── js/
│   │   └── main.js           # Client-side JS (chatbot, notifications, drag)
│   └── images/               # Logo and image assets
│
├── views/                    # EJS Templates
│   ├── partials/             # DRY reusable components
│   │   ├── header.ejs        # HTML head, CSS imports
│   │   ├── navbar.ejs        # Top navigation bar (role-aware)
│   │   ├── sidebar.ejs       # Side navigation (optional)
│   │   ├── footer.ejs        # Site footer
│   │   ├── scripts.ejs       # Bootstrap, Chart.js, main.js
│   │   └── chatbot.ejs       # AgriBot AI assistant widget
│   │
│   └── pages/                # Full page views
│       ├── index.ejs         # Login / Register page
│       ├── dashboard.ejs     # Main dashboard with charts & stats
│       ├── applicants.ejs    # Applicants list with filters/search/table
│       ├── applicant-form.ejs# Add / Edit applicant form
│       ├── applicant-detail.ejs  # 7-step accreditation tracker
│       ├── documents.ejs     # Document management
│       ├── document-submit.ejs   # Document upload form
│       ├── farms.ejs         # LSA farms grid with compliance scores
│       ├── farm-detail.ejs   # Farm profile with GIS placeholder
│       ├── reports.ejs       # Monitoring & analytics reports
│       ├── community.ejs     # Community chat channels
│       ├── directory.ejs     # LSA directory with search & filters
│       └── error.ejs         # 404/500 error page
│
├── routes/                   # Express Router — one file per module
│   ├── index.js              # GET /  (landing/login)
│   ├── dashboard.js          # GET /dashboard
│   ├── applicants.js         # CRUD /applicants
│   ├── documents.js          # GET/POST /documents
│   ├── farms.js              # GET /farms
│   ├── reports.js            # GET /reports
│   ├── community.js          # GET /community
│   └── directory.js          # GET /directory
│
├── data/                     # JSON data (simulates database)
│   ├── applicants.json       # 8 applicant records
│   ├── documents.json        # 10 document records
│   ├── farms.json            # 5 accredited farm records
│   └── reports.json          # 5 semestral report records
│
├── app.js                    # Main server — middleware, routing, error handlers
├── package.json              # Dependencies
└── README.md                 # This file
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18 or higher
- npm

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
http://localhost:3000
```

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
| GET    | `/applicants/add`        | Retired — redirects to `/admin/farmers/new` |
| POST   | `/applicants/add`        | Retired — redirects to `/admin/farmers/new` |
| GET    | `/admin/farmers/new`     | Register a farmer (admin) — application record, optionally with a login |
| POST   | `/admin/farmers`         | Create the application record, and the account when one is asked for |
| GET    | `/applicants/:id`        | Applicant detail + accreditation tracker |
| GET    | `/applicants/edit/:id`   | Edit application form                    |
| POST   | `/applicants/edit/:id`   | Update application                       |
| POST   | `/applicants/delete/:id` | Delete application                       |
| GET    | `/documents`             | Document list                            |
| GET    | `/documents/submit`      | Document submission form                 |
| POST   | `/documents/submit`      | Submit new document                      |
| GET    | `/farms`                 | LSA farm grid with compliance scores     |
| GET    | `/farms/:id`             | Farm detail with GIS placeholder         |
| GET    | `/reports`               | Monitoring reports & analytics           |
| GET    | `/community`             | Community chat channels                  |
| GET    | `/directory`             | LSA directory with search & filters      |
| GET    | `/api/chatbot?q=`        | AgriBot answer, grounded in the LSA reference data, with its source |
| GET    | `/api/export/lsa-registry` | Accredited LSA registry as JSON or `?format=csv` (staff only) |

---

## ✨ Key Features Implemented

1. **Centralized Accreditation Database** — JSON-backed CRUD for applicants
2. **Digital Accreditation Workflow** — 7-step tracker with visual progress
3. **Monitoring Dashboard** — Server-injected stat cards + Chart.js doughnut

4. **Role-Based Navigation** — Dynamic navbar menu items
5. **AI Chatbot (AgriBot)** — Draggable floating assistant widget
6. **Community Chat** — Channel-based messaging interface
7. **LSA Directory** — Searchable/filterable farm directory
8. **GIS Module Placeholder** — Geo-tagging UI ready for production integration
9. **EJS Partials** — header, navbar, sidebar, footer, chatbot, scripts (DRY)
10. **Express Middleware** — Morgan logging, static files, form parsing, error handlers
11. **MVC-lite Structure** — Clean separation of routes, views, and data

---

## 🎓 Capstone Project

**Title:** Agri-AIMS: A Digital Accreditation and Information Management System  
**Team:** ETECHNICS  
**Subject Adviser:** JOCELYN T. LIPATA, Ph.D.  
**Capstone Adviser:** JONUEL REY N. COLLE, MIS  
**SDGs:** SDG 2 – Zero Hunger · SDG 4 – Quality Education · SDG 8 – Decent Work
