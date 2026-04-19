# Footnote Deployment — Quick Reference

**One-page summary for deployment day.**

---

## What You're Deploying

```
Footnote — AI-powered Research Intelligence
├── Frontend: React + TypeScript + Vite
├── Backend: FastAPI + Python
└── Database: Supabase (Postgres)
```

---

## Platform Map

| Component | Deployer | URL | Setup Time |
|-----------|----------|-----|------------|
| **Frontend** | Vercel | `https://footnote.vercel.app` | 5 min |
| **Backend** | Railway | `https://your-railway-url.railway.app` | 5 min |
| **Database** | Supabase | Managed | Already set up |

---

## Environment Variables Needed

### Frontend (Vercel)
```
VITE_API_URL=https://your-railway-url.railway.app
```

### Backend (Railway)
```
ANTHROPIC_API_KEY=sk-ant-xxxx...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your-anon-key
FRONTEND_URL=https://footnote.vercel.app
```

---

## Deployment Order

1. **Deploy Backend First** (Railway) — get URL
2. **Deploy Frontend** (Vercel) — pass Railway URL as env var
3. **Update Railway** with Vercel URL for CORS

---

## Files Already Created

✅ `vercel.json` — Vercel configuration  
✅ `railway.json` — Railway configuration  
✅ `backend/Dockerfile` — Backend containerization  
✅ `frontend/.env.example` — Frontend env template  
✅ `backend/.env.example` — Backend env template  
✅ `DEPLOYMENT_GUIDE.md` — Full step-by-step guide  
✅ `DEPLOYMENT_CHECKLIST.md` — Item-by-item checklist  

---

## Quick Steps

### Railway (Backend)

```
1. railway.app → New Project → Deploy from GitHub
2. Select footnote repo
3. Add env vars (ANTHROPIC_API_KEY, SUPABASE_*)
4. Wait for green checkmark
5. Copy your Railway URL
```

### Vercel (Frontend)

```
1. vercel.com → New Project → Import Git Repo
2. Select footnote repo
3. Root Directory: frontend
4. Add env var: VITE_API_URL=<YOUR_RAILWAY_URL>
5. Deploy
6. Copy your Vercel URL
```

### Connect Them

```
1. Back to Railway
2. Set FRONTEND_URL=<YOUR_VERCEL_URL>
3. Save & wait for redeploy
4. Done!
```

---

## Test URLs

| What | URL |
|------|-----|
| **Frontend** | `https://footnote.vercel.app` |
| **Backend Health** | `https://your-railway-url.railway.app/health` |
| **API Docs** | `https://your-railway-url.railway.app/docs` |

---

## Common Issues

| Problem | Solution |
|---------|----------|
| "Cannot reach backend" | Check `VITE_API_URL` in Vercel matches Railway URL |
| "CORS error" | Check `FRONTEND_URL` in Railway matches Vercel URL |
| "Backend won't start" | Check all env vars set in Railway; check logs |
| "Build fails on Vercel" | Check Vercel logs; likely missing npm dependency |

---

## Useful Links

- **Vercel Dashboard**: https://vercel.com/dashboard
- **Railway Dashboard**: https://railway.app/dashboard
- **Supabase Dashboard**: https://supabase.com/dashboard
- **Anthropic Console**: https://console.anthropic.com/

---

**Last Updated**: 2026-04-19  
**Total Deployment Time**: ~20 minutes  
**Auto-Updates**: Yes (push to GitHub = auto-deploy)
