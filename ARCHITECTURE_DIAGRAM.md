# Footnote Architecture — Deployment Diagram

## Production Architecture (Vercel + Railway)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          INTERNET / USER BROWSERS                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                   ┌─────────┴──────────┐
                   │                    │
        ┌──────────▼──────────┐    ┌────▼──────────────┐
        │   VERCEL (Edge)     │    │  GITHUB (Repo)    │
        ├─────────────────────┤    ├───────────────────┤
        │  Frontend (React)    │    │  - Footnote code  │
        │  ✓ footnote.vercel. │    │  - Auto-triggers  │
        │    app              │    │    deploy on push │
        │  ✓ Built with Vite  │    └───────────────────┘
        │  ✓ Static HTML+JS+  │
        │    CSS              │
        │  ✓ TanStack Query   │
        │  ✓ D3.js graphs     │
        │  ✓ Tailwind CSS     │
        │  ✓ Global CDN       │
        │                     │
        │  ENV VARS:          │
        │  • VITE_API_URL     │
        └──────────┬──────────┘
                   │
                   │ API Calls
                   │ (https://your-railway-url.railway.app)
                   │
        ┌──────────▼──────────────────────┐
        │    RAILWAY (Backend)             │
        ├──────────────────────────────────┤
        │  Backend (FastAPI + Python)      │
        │  ✓ Claude Research Service       │
        │  ✓ Semantic Scholar API Client   │
        │  ✓ OpenAlex Citation Graph       │
        │  ✓ Supabase Session Storage      │
        │  ✓ Rate Limiting                 │
        │  ✓ CORS Handler                  │
        │                                  │
        │  Endpoints:                      │
        │  • POST /api/research            │
        │  • POST /api/export              │
        │  • GET /health                   │
        │  • GET /docs (Swagger)           │
        │                                  │
        │  ENV VARS:                       │
        │  • ANTHROPIC_API_KEY             │
        │  • SUPABASE_URL/KEY              │
        │  • FRONTEND_URL                  │
        │  • RATE_LIMIT_PER_MINUTE         │
        │  • LOG_LEVEL                     │
        └──────────┬─────────────────────┬┘
                   │                     │
        ┌──────────▼──────────┐   ┌─────▼──────────────┐
        │ SUPABASE DATABASE   │   │ EXTERNAL APIs      │
        ├─────────────────────┤   ├───────────────────┤
        │ • Session Storage   │   │ • Anthropic       │
        │ • Research History  │   │   Claude API      │
        │ • User Profiles     │   │ • Semantic Scholar│
        │ • Postgres 14       │   │   Paper Metadata  │
        │ • Real-time Sync    │   │ • OpenAlex        │
        │ • Row-Level         │   │   Citation Graph  │
        │   Security          │   │                   │
        └─────────────────────┘   └───────────────────┘
```

---

## Data Flow — Research Request

```
USER INTERACTION
     │
     ├─▶ User types research topic
     ├─▶ Clicks "Search"
     │
     ▼
FRONTEND (Vercel)
     │
     ├─▶ TanStack Query mutation
     ├─▶ POST /api/research
     │   └─▶ { topic, depth, customPrompt }
     │
     ▼
RAILWAY BACKEND (FastAPI)
     │
     ├─▶ Validate request (Pydantic)
     │
     ├─▶ Fetch papers (Semantic Scholar)
     │   └─▶ ~20 papers with metadata
     │
     ├─▶ Fetch citations (OpenAlex)
     │   └─▶ Citation relationships
     │
     ├─▶ Synthesize with Claude
     │   ├─▶ Executive Summary
     │   ├─▶ Key Findings (with confidence)
     │   ├─▶ Literature Review
     │   ├─▶ Methodology Table
     │   ├─▶ Research Gaps
     │   └─▶ Top Researchers
     │
     ├─▶ Store session in Supabase
     │
     ▼
RESPONSE (ResearchResponse JSON)
     │
     ├─▶ Frontend renders panels
     ├─▶ D3.js draws knowledge graph
     ├─▶ TanStack Query updates cache
     │
     ▼
USER SEES RESULTS
```

---

## Environment Isolation

### Local Development (docker-compose)

```
Your Machine
├─ localhost:5173 (Frontend Vite)
└─ localhost:8000 (Backend FastAPI)
   └─ Shared .env file
```

### Production (Vercel + Railway)

```
Frontend Container (Vercel)
├─ Node.js runtime
├─ React + Vite
├─ Built-in global CDN
└─ Env: VITE_API_URL

Backend Container (Railway)
├─ Python 3.10 runtime
├─ FastAPI application
├─ Automatic scaling
└─ Env: ANTHROPIC_API_KEY, SUPABASE_*, FRONTEND_URL
```

---

## Request/Response Cycle

```
USER BROWSER                 VERCEL FRONTEND                 RAILWAY BACKEND
     │
     │ 1. Search form               │
     │ shows "Loading..."           │
     │                              │
     │◄──────────────────────────────┤
     │                              │
     │                              │ 2. POST /api/research
     │                              │    with topic + depth
     │                              ├────────────────────────────┐
     │                              │                             │
     │                              │                       Fetch papers
     │                              │                       (Semantic Scholar)
     │                              │                       Fetch citations
     │                              │                       (OpenAlex)
     │                              │                       Call Claude API
     │                              │                       
     │                              │                       Synthesize results
     │                              │
     │                              │◄────────────────────────────┤
     │                              │ 3. 200 OK + JSON
     │                              │    {
     │                              │      summary,
     │                              │      findings[],
     │                              │      papers[],
     │                              │      citations[],
     │                              │      ...
     │                              │    }
     │                              │
     │◄──────────────────────────────┤
     │ 4. Display results            │
     │    Render panels              │
     │    Draw D3 graph              │
     │    Cache with TanStack        │
     │                              │
     ▼
USER SEES RESULTS
```

---

## Scaling & Performance

### Frontend (Vercel)

- **Global CDN**: Automatic caching at 200+ edge locations
- **Auto-scaling**: Unlimited concurrent users (serverless)
- **Build optimization**: Code splitting, tree-shaking, minification
- **Performance**: LCP < 2.5s, CLS < 0.1

### Backend (Railway)

- **Auto-scaling**: Automatically adds containers under load
- **Health checks**: Railway monitors `/health` endpoint every 30s
- **Logging**: Real-time access to stdout/stderr
- **Environment secrets**: Encrypted at rest, injected at runtime

### Database (Supabase)

- **Postgres**: Fully managed, auto-backups, point-in-time recovery
- **Connection pooling**: PgBouncer handles thousands of connections
- **Row-level security**: Data isolated per user without custom code

---

## Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        PUBLIC INTERNET                           │
└────────────┬──────────────────────────────────────────────┬─────┘
             │                                              │
             │ HTTPS Only                      HTTPS Only  │
             │                                              │
    ┌────────▼────────┐                          ┌─────────▼────┐
    │ Vercel (Edge)   │                          │ Railway API  │
    │                 │────────────CORS───────────│              │
    │ • Rate limited  │  Only allows requests    │ • API key    │
    │   at edge       │  from footnote.vercel.app│   in header  │
    │ • DDoS          │                          │ • Request    │
    │   protection    │                          │   validation │
    └────────┬────────┘                          └─────────┬────┘
             │                                              │
             │ env: VITE_API_URL                           │
             │ (public, in built HTML)                     │
             │                                              │
             │ All API communication is:                    │
             │ ✓ Over HTTPS                                │
             │ ✓ Using standard REST + JSON                │
             │ ✓ Stateless (no sessions)                   │
             │ ✓ Validated on both sides                   │
             │                                              │
    ┌────────▴────────┐                          ┌─────────▴────┐
    │ Supabase        │                          │ External APIs│
    │ (RLS + Postgres)│◄──────────────────────────│              │
    │                 │  Encrypted JWT tokens    │ • Claude API │
    │ • Row-level     │                          │ • Semantic   │
    │   security      │                          │   Scholar    │
    │ • Encrypted     │                          │ • OpenAlex   │
    │   at rest       │                          │              │
    │ • Backups       │                          │ All keys     │
    │                 │                          │ stored in    │
    │                 │                          │ Railway env  │
    └─────────────────┘                          └──────────────┘
```

---

## Deployment Checklist (Visual)

```
┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Railway Backend                                     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ☐ railway.app → New Project                            │ │
│ │ ☐ Deploy from GitHub                                   │ │
│ │ ☐ Add env vars (ANTHROPIC_API_KEY, SUPABASE_*)        │ │
│ │ ☐ Wait for ✅ green checkmark                         │ │
│ │ ☐ COPY Railway URL → 📋 somewhere safe                │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 2: Vercel Frontend                                     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ☐ vercel.com → New Project                            │ │
│ │ ☐ Import GitHub repo                                  │ │
│ │ ☐ Root Directory: frontend                            │ │
│ │ ☐ Add env var: VITE_API_URL = <RAILWAY_URL>          │ │
│ │ ☐ Deploy                                              │ │
│ │ ☐ COPY Vercel URL → 📋 somewhere safe                │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 3: Connect Services                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ☐ railway.app → Variables                            │ │
│ │ ☐ Set FRONTEND_URL = <VERCEL_URL>                    │ │
│ │ ☐ Save & wait for redeploy                           │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ STEP 4: Test                                                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ☐ Open Vercel URL in browser                         │ │
│ │ ☐ Search for a research topic                        │ │
│ │ ☐ See results load (10-20 seconds)                   │ │
│ │ ☐ Check browser console (F12) - no errors            │ │
│ │ ✅ DONE!                                              │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## File Locations

```
footnote/
├── vercel.json              ← Vercel config (in repo root)
├── railway.json             ← Railway config (in repo root)
├── frontend/
│   ├── .env.example         ← Copy to .env.local for local dev
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── SearchBar.tsx
│   │   │   ├── ResultsPanel.tsx
│   │   │   └── KnowledgeGraph.tsx
│   │   └── index.html
│   └── package.json
├── backend/
│   ├── Dockerfile           ← Docker image for Railway
│   ├── .env.example         ← Copy to .env for local dev
│   ├── requirements.txt
│   ├── main.py              ← FastAPI app entry
│   ├── claude_service.py    ← Claude synthesis
│   ├── scholar_service.py   ← Paper fetching
│   └── tests/
└── DEPLOYMENT_GUIDE.md      ← This guide (50 steps simplified to 3)
```

---

**Status**: Ready to deploy ✅  
**Estimated Time**: 20 minutes  
**Maintenance**: Auto-updates on GitHub push
