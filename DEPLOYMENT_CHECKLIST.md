# Deployment Checklist — Footnote to Vercel + Railway

Use this checklist to track your deployment progress. Check off each item as you complete it.

---

## Pre-Deployment Setup (5 min)

- [ ] Have a GitHub account with your `footnote` repo pushed
- [ ] Created Vercel account at [vercel.com](https://vercel.com) (free)
- [ ] Created Railway account at [railway.app](https://railway.app) (free)
- [ ] Created Supabase account at [supabase.com](https://supabase.com) (free)
- [ ] Have your **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com)
- [ ] Have your **Supabase URL** and **anon key** from Supabase dashboard
- [ ] Verified all files are committed to GitHub

---

## Step 1: Deploy Backend to Railway (10 min)

### Create & Configure Railway Project

- [ ] Go to [railway.app](https://railway.app) and click **"New Project"**
- [ ] Select **"Deploy from GitHub"** and authorize Railway
- [ ] Select your `footnote` repository
- [ ] Click **"Create project"** and wait for initial deployment

### Add Environment Variables to Railway

In Railway dashboard → **Variables** tab, add:

- [ ] `ANTHROPIC_API_KEY` = `sk-ant-xxxx...` (from Anthropic)
- [ ] `SUPABASE_URL` = `https://xxxx.supabase.co` (from Supabase)
- [ ] `SUPABASE_KEY` = your anon key (from Supabase)
- [ ] `LOG_LEVEL` = `INFO`
- [ ] Leave `FRONTEND_URL` empty for now (you'll add it later)

### Verify Backend is Running

- [ ] Deployment shows **green checkmark** in Railway dashboard
- [ ] Go to **Settings** → **Domains** and **copy your Railway URL**
  - Example: `https://footnote-backend-prod.railway.app`
- [ ] Test in browser: `https://your-railway-url.railway.app/docs`
  - You should see Swagger UI (FastAPI documentation) ✅

---

## Step 2: Deploy Frontend to Vercel (10 min)

### Create & Configure Vercel Project

- [ ] Go to [vercel.com](https://vercel.com) and click **"New Project"**
- [ ] Click **"Import Git Repository"**
- [ ] Select your `footnote` repository
- [ ] Set **Root Directory** to `frontend`
- [ ] Leave build settings as default (auto-detected as Vite)

### Add Environment Variables to Vercel

While deploying, Vercel will ask for environment variables. Add:

- [ ] `VITE_API_URL` = `https://your-railway-url.railway.app`
  - Replace `your-railway-url` with the URL from Railway

### Deploy

- [ ] Click **"Deploy"**
- [ ] Wait for deployment to complete (1-2 minutes)
- [ ] Deployment shows **green "Ready"** status ✅
- [ ] Click **"Visit"** to open your live site
- [ ] **Copy your Vercel URL**
  - Example: `https://footnote.vercel.app`

---

## Step 3: Connect Services (5 min)

### Update Railway with Frontend URL

- [ ] Go back to [railway.app](https://railway.app)
- [ ] Select your `footnote` project
- [ ] Click **Variables** tab
- [ ] Set `FRONTEND_URL` = `https://your-vercel-url.vercel.app`
- [ ] Click **"Save changes"**
- [ ] Railway will automatically redeploy

---

## Step 4: Test End-to-End (5 min)

### Frontend Test

- [ ] Open your Vercel URL: `https://footnote.vercel.app`
- [ ] Page loads without errors (check browser console)
- [ ] Search bar is visible and interactive

### Backend Test

- [ ] Go to `https://your-railway-url.railway.app/health`
- [ ] See response: `{"status":"ok"}` ✅

### Full Integration Test

- [ ] Enter a research topic (e.g., "machine learning")
- [ ] Click search
- [ ] Results load (may take 10-20 seconds)
- [ ] See panels: Executive Summary, Key Findings, Papers, etc.
- [ ] **No CORS errors** in browser console ✅

---

## Step 5: Verify Logs (5 min)

### Check Vercel Logs

- [ ] Go to [vercel.com](https://vercel.com) → select `footnote` project
- [ ] Click **Deployments** → latest deployment
- [ ] Click **Logs** — no build errors
- [ ] Open the live site and check browser console (F12) — no errors

### Check Railway Logs

- [ ] Go to [railway.app](https://railway.app) → select your project
- [ ] Click **Logs** tab
- [ ] Search a topic on your Vercel frontend
- [ ] See log entries appear in Railway — confirms backend is receiving requests
- [ ] No error messages in logs ✅

---

## Step 6: Optional Setup

### Custom Domain (Vercel)

- [ ] Vercel project → **Settings** → **Domains**
- [ ] Add your custom domain (e.g., `footnote.mycompany.com`)
- [ ] Update DNS records per Vercel's instructions

### Custom Domain (Railway)

- [ ] Railway project → **Settings** → **Domains**
- [ ] Add custom domain for backend (e.g., `api.footnote.mycompany.com`)

### Enable Auto-Deployments

- [ ] Both Vercel and Railway auto-deploy on push to GitHub
- [ ] No additional setup needed!
- [ ] Push to `main` → automatic deployment within 1-2 minutes

---

## Troubleshooting

### ❌ Frontend shows "Cannot reach backend"

**Steps**:
1. Check `VITE_API_URL` in Vercel environment variables
2. Verify it matches your Railway URL exactly
3. Go to Vercel → **Deployments** → redeploy (click the three-dot menu)
4. Wait 2 minutes for redeploy to complete

### ❌ CORS error in browser console

**Steps**:
1. Check `FRONTEND_URL` in Railway environment variables
2. Verify it matches your Vercel URL exactly
3. Go to Railway → **Logs** and trigger a search
4. Look for CORS error message
5. Redeploy Railway (click **Trigger Deployment** in Settings)

### ❌ Backend won't start

**Steps**:
1. Go to Railway → **Logs** and look for error message
2. Check all environment variables are set:
   - `ANTHROPIC_API_KEY` is present and valid
   - `SUPABASE_URL` and `SUPABASE_KEY` are correct
3. Verify `requirements.txt` exists in `backend/` folder
4. Check `Dockerfile` exists in `backend/` folder

### ❌ Frontend build fails on Vercel

**Steps**:
1. Vercel → **Deployments** → latest → **Build Logs**
2. Look for error (usually missing dependency)
3. Add missing package to `frontend/package.json`
4. Push to GitHub → auto-redeploy

---

## Summary

| Layer | Provider | Status | URL |
|-------|----------|--------|-----|
| Frontend | Vercel | ✅ | `https://footnote.vercel.app` |
| Backend | Railway | ✅ | `https://your-railway-url.railway.app` |
| Database | Supabase | ✅ | Managed by Supabase |

**You're done!** Your app is now live. Updates to GitHub automatically deploy.

---

**Time elapsed**: _____ min | **Date deployed**: ___________ | **Deployed by**: ___________
