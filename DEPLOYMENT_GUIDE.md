# Footnote Deployment Guide — Vercel + Railway

This guide walks you through deploying Footnote to production:
- **Frontend**: Vercel (React app)
- **Backend**: Railway (FastAPI server)
- **Database**: Supabase (Postgres + sessions)

**Estimated time: 30 minutes**

---

## Prerequisites

Before you start, make sure you have:

- A GitHub account with your Footnote repo pushed
- A Vercel account (free at [vercel.com](https://vercel.com))
- A Railway account (free at [railway.app](https://railway.app))
- A Supabase account (free at [supabase.com](https://supabase.com))
- Your API keys ready:
  - `ANTHROPIC_API_KEY` (from [console.anthropic.com](https://console.anthropic.com))
  - Supabase URL and anon key (from Supabase dashboard)

---

## Part 1: Deploy Backend to Railway (10 minutes)

### 1.1 Create a Railway project

1. Go to [railway.app](https://railway.app)
2. Click **"New Project"**
3. Click **"Deploy from GitHub"**
4. Authorize Railway to access your GitHub account
5. Select your `footnote` repository
6. Click **"Create project"**

### 1.2 Configure Railway deployment

1. You'll see the Railway dashboard. Click on the **deployment** that's starting.
2. On the **Settings** tab, verify:
   - **Root Directory**: `backend`
   - **Build Command**: Should auto-detect `pip install -r requirements.txt`
   - **Start Command**: Already set in `railway.json`

### 1.3 Add environment variables to Railway

Still in the Railway dashboard:

1. Click the **Variables** tab
2. Add these environment variables (click **Add Variable**):

| Key | Value | Notes |
|-----|-------|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-xxxx...` | From Anthropic console |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | From Supabase dashboard → Settings → API |
| `SUPABASE_KEY` | Your anon key | Supabase dashboard → Settings → API |
| `FRONTEND_URL` | Leave blank for now | You'll update this after deploying frontend |
| `LOG_LEVEL` | `INFO` | For debugging |

3. Click **"Save changes"**

### 1.4 Get your Railway backend URL

1. In the Railway dashboard, click the **Deployments** tab
2. Wait for the deployment to finish (you'll see a green checkmark)
3. Click the **Environment** tab → look for `RAILWAY_STATIC_URL` or click **"View logs"**
4. Or go to **Settings** → **Domains** and note your auto-generated URL
   - It will look like: `https://footnote-backend-prod.railway.app`

**Save this URL** — you'll need it for the frontend.

### 1.5 Test the backend

Open your browser and navigate to:
```
https://your-railway-url.railway.app/docs
```

You should see FastAPI's interactive API documentation (Swagger UI). If you see this, your backend is working! ✅

---

## Part 2: Deploy Frontend to Vercel (10 minutes)

### 2.1 Create a Vercel project

1. Go to [vercel.com](https://vercel.com)
2. Click **"New Project"**
3. Click **"Import Git Repository"**
4. Select your `footnote` repository
5. Click **"Continue"**

### 2.2 Configure Vercel settings

On the **Import Project** screen:

- **Project Name**: `footnote` (or whatever you prefer)
- **Framework Preset**: `Vite`
- **Root Directory**: Set to `frontend` (click **Edit** next to the folder icon)
- **Build Command**: Should auto-populate as `npm run build`
- **Output Directory**: Should auto-populate as `dist`
- **Install Command**: `npm install`

Leave everything else as default and click **"Deploy"**.

### 2.3 Add environment variables to Vercel

While the deployment is running, Vercel will ask for environment variables:

1. In the **Environment Variables** section, add:

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://your-railway-url.railway.app` |

Replace `your-railway-url` with the URL you saved from Railway.

2. Click **"Deploy"**

3. Wait for the deployment to finish (typically 1-2 minutes). You'll see a green checkmark.

### 2.4 Get your Vercel frontend URL

Once deployed:
1. Click **"Visit"** to open your live site
2. The URL will be something like: `https://footnote.vercel.app`

**Save this URL** — you need to add it back to Railway.

---

## Part 3: Update CORS and Connect the Services (5 minutes)

### 3.1 Update Railway with your Vercel URL

1. Go back to [railway.app](https://railway.app)
2. Select your Footnote project
3. Click the **Variables** tab
4. Find `FRONTEND_URL` and set it to your Vercel URL:
   ```
   https://footnote.vercel.app
   ```
5. Click **"Save changes"**

Railway will automatically redeploy with the updated CORS settings.

### 3.2 Test the connection

1. Go to your Vercel URL: `https://footnote.vercel.app`
2. Try searching for a research topic (e.g., "machine learning")
3. If you see results and panels loading, **it's working!** ✅

---

## Part 4: Verify and Monitor (5 minutes)

### 4.1 Check frontend logs (Vercel)

1. Go to [vercel.com](https://vercel.com) and select your `footnote` project
2. Click **"Deployments"**
3. Click the latest deployment
4. Click **"Logs"** to see any errors

### 4.2 Check backend logs (Railway)

1. Go to [railway.app](https://railway.app) and select your `footnote` project
2. Click **"Logs"** to watch real-time server activity
3. Look for any error messages when you search

### 4.3 Test the API directly

Open a new browser tab and paste (replacing with your Railway URL):
```
https://your-railway-url.railway.app/health
```

If you see `{"status":"ok"}`, the backend is healthy. ✅

---

## Troubleshooting

### ❌ Frontend shows "Cannot reach backend" or CORS error

**Solution**: 
1. Check that `VITE_API_URL` in Vercel is set to your Railway URL
2. Check that `FRONTEND_URL` in Railway is set to your Vercel URL
3. Redeploy both (Vercel will auto-redeploy, Railway needs manual trigger)

### ❌ Backend won't start (Railway shows error)

**Solution**:
1. Check Railway logs for the error
2. Verify all required env vars are set: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`
3. Make sure `requirements.txt` exists in the `backend` folder
4. Check that the Dockerfile is in the `backend` folder

### ❌ API returns 500 error

**Solution**:
1. Check Railway logs for the exact error
2. Verify your `ANTHROPIC_API_KEY` is valid
3. Verify Supabase URL and key are correct
4. Check that all external APIs (Semantic Scholar, OpenAlex) are accessible

### ❌ Frontend build fails on Vercel

**Solution**:
1. Check Vercel logs: **Deployments** → latest → **Build Logs**
2. Verify `vite.config.ts` exists and is correct
3. Ensure all npm dependencies are in `frontend/package.json`
4. Check that Node version is ≥ 18

---

## Next Steps

### Optional: Set up custom domain

**For Vercel**:
1. Go to your Vercel project → **Settings** → **Domains**
2. Add your domain (e.g., `footnote.yourcompany.com`)
3. Follow the DNS setup instructions

**For Railway**:
1. Go to your Railway project → **Settings** → **Domains**
2. Add a custom domain for your backend

### Optional: Set up monitoring

**Vercel**: Built-in analytics at **Analytics** tab
**Railway**: Click **Monitoring** to watch CPU, memory, and request rates

### Optional: Enable auto-deploy on push

Both Vercel and Railway automatically redeploy when you push to `main` (or your default branch). No additional setup needed!

---

## Summary

| Component | Platform | URL Pattern |
|-----------|----------|-------------|
| Frontend | Vercel | `https://footnote.vercel.app` |
| Backend | Railway | `https://your-railway-url.railway.app` |
| Database | Supabase | Managed by Supabase |
| APIs | External | Claude, Semantic Scholar, OpenAlex |

Once deployed, updates are automatic:
- Push to GitHub → Vercel auto-deploys frontend
- Push to GitHub → Railway auto-deploys backend
- No manual steps needed!

---

**Questions?** Check the logs first, then open an issue on GitHub or email [goodvibepublishing@gmail.com](mailto:goodvibepublishing@gmail.com).
