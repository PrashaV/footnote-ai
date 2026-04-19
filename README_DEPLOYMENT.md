# Footnote Deployment — Complete Package

**Everything you need to deploy Footnote to production is in this folder.**

---

## 📦 What's Included

### Configuration Files (Ready to use)
- `vercel.json` — Vercel frontend configuration
- `railway.json` — Railway backend configuration  
- `backend/Dockerfile` — Container image for FastAPI
- `frontend/.env.example` — Frontend environment template
- `backend/.env.example` — Backend environment template

### Documentation (Read in order)
1. **QUICK_REFERENCE.md** (2 min read) — One-page overview
2. **DEPLOYMENT_GUIDE.md** (10 min read) — Detailed step-by-step instructions
3. **DEPLOYMENT_CHECKLIST.md** (5 min ref) — Item-by-item checklist
4. **ARCHITECTURE_DIAGRAM.md** (5 min read) — Visual architecture & flow
5. **TROUBLESHOOTING.md** (ref as needed) — Fix common issues

---

## 🚀 Quick Start (5 minutes)

### Step 1: Deploy Backend to Railway
```
1. Go to railway.app → New Project → Deploy from GitHub
2. Select footnote repo
3. Add env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY
4. Wait for green checkmark
5. Copy your Railway URL
```

### Step 2: Deploy Frontend to Vercel
```
1. Go to vercel.com → New Project → Import Git Repo
2. Root Directory: frontend
3. Add env var: VITE_API_URL=<YOUR_RAILWAY_URL>
4. Deploy
5. Copy your Vercel URL
```

### Step 3: Connect Them
```
1. Back to Railway → Variables
2. Set FRONTEND_URL=<YOUR_VERCEL_URL>
3. Save & wait for redeploy
4. Done!
```

---

## 📋 Before You Deploy

Make sure you have:
- [ ] GitHub account with footnote repo pushed
- [ ] Vercel account (free at vercel.com)
- [ ] Railway account (free at railway.app)
- [ ] Supabase account (free at supabase.com)
- [ ] Anthropic API key from console.anthropic.com
- [ ] Supabase URL and anon key

---

## 🎯 Success Criteria

You'll know deployment succeeded when:

✅ **Frontend loads**: https://footnote.vercel.app (no blank page)  
✅ **Backend responds**: https://your-railway-url.railway.app/health → `{"status":"ok"}`  
✅ **API docs visible**: https://your-railway-url.railway.app/docs → Swagger UI  
✅ **Search works**: Type topic → click search → results load in 10-20 seconds  
✅ **No errors**: Open DevTools (F12) → Console tab → no red errors  

---

## 📚 File Guide

| File | Purpose | Read when |
|------|---------|-----------|
| `QUICK_REFERENCE.md` | One-page overview | First-time deployment |
| `DEPLOYMENT_GUIDE.md` | Complete step-by-step | Following along with deployment |
| `DEPLOYMENT_CHECKLIST.md` | Item-by-item tracker | Keeping track of progress |
| `ARCHITECTURE_DIAGRAM.md` | Visual architecture | Understanding how it works |
| `TROUBLESHOOTING.md` | Fix common errors | Something breaks |
| `vercel.json` | Vercel config | Already set up, no editing needed |
| `railway.json` | Railway config | Already set up, no editing needed |
| `backend/Dockerfile` | Container image | Already set up, no editing needed |
| `.env.example` files | Environment templates | Copy to `.env` for local dev |

---

## 🔧 Local Development (Optional)

To test locally before deploying:

```bash
# 1. Copy environment templates
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env

# 2. Fill in the .env files with your keys
# VITE_API_URL=http://localhost:8000 (frontend)
# ANTHROPIC_API_KEY=sk-ant-... (backend)
# etc.

# 3. Start everything
docker-compose up

# 4. Open app
open http://localhost:5173
```

---

## 🚨 Common Mistakes

❌ **Don't**: Deploy frontend before backend  
✅ **Do**: Deploy backend first, copy URL, then deploy frontend

❌ **Don't**: Forget to add `VITE_API_URL` to Vercel  
✅ **Do**: Set it to your Railway URL before deploying

❌ **Don't**: Forget to update `FRONTEND_URL` in Railway  
✅ **Do**: Set it to your Vercel URL after deploying frontend

❌ **Don't**: Commit your `.env` file to GitHub  
✅ **Do**: Keep it local, use environment variables on the platforms

---

## 📞 Support

If something goes wrong:

1. **Check the logs** (Railway → Logs, Vercel → Build Logs)
2. **Read TROUBLESHOOTING.md** for your specific error
3. **Search your error message** on GitHub/Stack Overflow
4. **Open a GitHub issue** with error details and screenshots
5. **Email**: goodvibepublishing@gmail.com

---

## ✨ After Deployment

Once live:

- **Auto-updates**: Push to GitHub → automatic deploy (1-2 min)
- **Monitoring**: Vercel Analytics & Railway Metrics
- **Custom domain**: Add in Vercel/Railway settings
- **SSL certificate**: Automatic (HTTPS included)
- **Scaling**: Automatic (Railway scales on demand)

---

## 📊 Deployment Architecture

```
┌────────────────────────────────────────────────────────┐
│                 INTERNET / USER BROWSER                │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
    ┌───▼─────────┐    ┌──────▼────────┐
    │ VERCEL      │    │ GITHUB REPO   │
    │ Frontend    │    │ (auto-trigger)│
    │ (React app) │    │               │
    └───┬─────────┘    └───────────────┘
        │
        │ API calls
        │
    ┌───▼──────────────┐
    │ RAILWAY          │
    │ Backend (FastAPI)│
    └───┬──────────────┘
        │
        │
    ┌───┴─────────────────────────────┐
    │                                 │
 ┌──▼──────┐                  ┌──────▼──────┐
 │SUPABASE │                  │EXTERNAL APIs│
 │Database │                  │ • Claude    │
 └─────────┘                  │ • Scholar   │
                              │ • OpenAlex  │
                              └─────────────┘
```

---

## 🎓 Learning Resources

If you want to understand more:

- **Vercel Docs**: https://vercel.com/docs
- **Railway Docs**: https://docs.railway.app
- **FastAPI**: https://fastapi.tiangolo.com
- **React**: https://react.dev
- **Vite**: https://vitejs.dev

---

## 📝 Next Steps

1. Read **QUICK_REFERENCE.md** (2 minutes)
2. Follow **DEPLOYMENT_GUIDE.md** (step by step)
3. Use **DEPLOYMENT_CHECKLIST.md** to track progress
4. Reference **TROUBLESHOOTING.md** if needed
5. Your site is live! 🎉

---

**Status**: Ready to deploy ✅  
**Estimated time**: 20 minutes  
**Difficulty**: Easy (all pre-configured)  
**Support**: goodvibepublishing@gmail.com

