# Troubleshooting Guide — Footnote Deployment

Reference this guide if something goes wrong during or after deployment.

---

## 🔴 Frontend Issues (Vercel)

### Issue: "Cannot reach backend" message in UI

**Symptom**: User sees an error toast saying "Failed to connect to backend"

**Root cause**: Frontend cannot reach the backend API endpoint (either URL is wrong, backend is down, or CORS is blocked)

**Fix**:
1. Open browser DevTools (`F12`)
2. Go to **Console** tab — look for errors starting with `CORS` or `Failed to fetch`
3. Note the URL it's trying to reach (e.g., `https://wrong-url.railway.app`)
4. Go to Vercel dashboard → your project → **Settings** → **Environment Variables**
5. Check `VITE_API_URL` — does it match your actual Railway URL?
6. If wrong:
   - Edit the value to your correct Railway URL
   - Go to **Deployments** tab, find the latest deployment
   - Click the three-dot menu → **Redeploy**
   - Wait 2 minutes for redeploy to complete
7. Refresh your Vercel site in browser

**Verify**: Open your browser's Network tab (DevTools → Network). Search for a topic. You should see:
- `POST` request to `https://your-railway-url.railway.app/api/research`
- Status: `200` (not 404, 500, or network error)

---

### Issue: Blank page or "Vite app is not defined"

**Symptom**: Vercel site loads a blank page or shows a JavaScript error

**Root cause**: Build failed, missing files, or Node version mismatch

**Fix**:
1. Go to Vercel dashboard → **Deployments** → latest
2. Click **Build Logs** tab
3. Look for red error text (usually near the bottom)
4. Common errors:
   - `Cannot find module 'react'` → Missing dependency in `frontend/package.json`
   - `Unexpected token '}'` → Syntax error in source code
   - `ENOENT: no such file or directory` → Missing file referenced in import

5. If found, fix the issue locally:
   - Update `frontend/package.json` or fix the code
   - Commit to GitHub
   - Vercel auto-redeploys (or manually redeploy)

**Verify**: No errors in Vercel build logs, and opening the Vercel URL shows the app

---

### Issue: Search works but results are blank/empty

**Symptom**: No results appear after searching, or panels show "Loading..." forever

**Root cause**: Backend is not returning data (API error)

**Fix**:
1. Open DevTools → **Network** tab
2. Search for a topic
3. Look for the `POST` request to `/api/research`
4. Click it and look at the **Response** tab
5. If you see an error message, read it carefully (e.g., `{"detail":"ANTHROPIC_API_KEY not set"}`)

6. **Common response errors**:
   - `"ANTHROPIC_API_KEY not set"` → Go to Railway → Variables, verify `ANTHROPIC_API_KEY` is set
   - `"401 Unauthorized"` → API key is wrong; check it's correct in Anthropic console
   - `"500 Internal Server Error"` → Check Railway logs for details

7. Fix the issue and restart:
   - Update Railway environment variable → Railway auto-redeploys
   - Wait 30 seconds
   - Try searching again

**Verify**: Search returns results without errors

---

### Issue: Build hangs or times out

**Symptom**: Vercel build is stuck for >10 minutes, or says "Build timeout"

**Root cause**: Large dependency, network issue, or infinite loop

**Fix**:
1. Go to Vercel → **Deployments** → latest
2. Click the three-dot menu → **Redeploy**
3. If it happens again:
   - Check `frontend/package.json` for unusually large packages
   - Try removing unused dependencies
   - Push to GitHub
   - Vercel auto-redeploys

**Verify**: Build completes in <5 minutes

---

## 🔴 Backend Issues (Railway)

### Issue: "Health check failed" or "Service crashed"

**Symptom**: Railway shows red status, or deployment keeps restarting

**Root cause**: Python error, missing environment variable, or invalid import

**Fix**:
1. Go to Railway dashboard → your project
2. Click **Logs** tab
3. Scroll to the bottom and look for error messages (red text)
4. Read the error carefully:
   - `ModuleNotFoundError: No module named 'fastapi'` → Missing in `requirements.txt`
   - `KeyError: 'ANTHROPIC_API_KEY'` → Env var not set
   - `json.JSONDecodeError` → Code is trying to parse invalid JSON

5. Fix locally:
   - Update `backend/requirements.txt` if missing a package
   - Add missing environment variable in Railway → Variables
   - Fix code bug
   - Commit to GitHub
   - Railway auto-redeploys (or manually trigger: click **Trigger Deployment** in Settings)

6. Watch the logs as it redeploys — you should see successful startup messages

**Verify**: Railway shows green status, logs show `INFO: Uvicorn running on...`

---

### Issue: API returns 500 Internal Server Error

**Symptom**: Request to `/api/research` returns `500` with error message

**Root cause**: Code bug, external API failure, or invalid request

**Fix**:
1. Go to Railway → **Logs**
2. Look for the error message (usually in red, with a Python traceback)
3. Read the traceback to find the issue:
   - `requests.exceptions.ConnectionError` → Cannot reach Semantic Scholar or OpenAlex
   - `anthropic.APIError` → Claude API call failed (check API key)
   - `json.JSONDecodeError` → Your code is parsing invalid JSON

4. Check external APIs are working:
   ```bash
   # Test Semantic Scholar
   curl -s "https://api.semanticscholar.org/graph/v1/paper/search?query=machine+learning&limit=1"
   
   # Test OpenAlex
   curl -s "https://api.openalex.org/works?search=machine+learning&per_page=1"
   ```
   If these return data, external APIs are fine.

5. Common fixes:
   - If Claude API error: Verify `ANTHROPIC_API_KEY` is correct in Railway → Variables
   - If Semantic Scholar error: API might be rate-limited; wait a few minutes
   - If custom code error: Review the traceback, fix the bug, push to GitHub, redeploy

**Verify**: `/api/research` returns `200` with valid JSON response

---

### Issue: Backend won't start on Railway

**Symptom**: Deployment shows red status immediately after creation

**Root cause**: Missing `Dockerfile`, missing `requirements.txt`, or Python version issue

**Fix**:
1. Verify files exist:
   - Is `backend/Dockerfile` present in your repo? (Check GitHub)
   - Is `backend/requirements.txt` present?

2. If missing:
   - Add the files to your local repo
   - Commit and push to GitHub
   - Railway auto-detects changes and redeploys

3. Check Railway → **Settings** → **Build**:
   - **Builder**: Should say "Dockerfile"
   - **Root Directory**: Should be empty or blank (Railway infers from Dockerfile)

4. If not set correctly:
   - Click **Edit** on the Build settings
   - Set **Builder** to "Dockerfile"
   - Save
   - Click **Trigger Deployment**

**Verify**: Railway deployment shows green status after 2-3 minutes

---

### Issue: "CORS error" in browser console

**Symptom**: DevTools shows `"Access to XMLHttpRequest blocked by CORS policy"`

**Root cause**: `FRONTEND_URL` in Railway doesn't match your Vercel URL

**Fix**:
1. Go to Railway → your project → **Variables** tab
2. Find `FRONTEND_URL`
3. Does it exactly match your Vercel URL? (e.g., `https://footnote.vercel.app`)
4. If wrong or empty:
   - Update it
   - Click **Save changes**
   - Railway auto-redeploys (watch the Deployments tab)
5. After redeploy, refresh your Vercel site

**Verify**: Search in Vercel site — DevTools console shows no CORS errors

---

### Issue: Rate limit error (429 Too Many Requests)

**Symptom**: `429` error appears after ~10 searches

**Root cause**: Rate limiter is working (intentional, but limit is too low)

**Fix**:
1. Go to Railway → **Variables** tab
2. Find `RATE_LIMIT_PER_MINUTE` (default: 30)
3. Increase it (e.g., to 60 or 100)
4. Save
5. Railway auto-redeploys

**Verify**: Can search more than 10 times without hitting rate limit

---

## 🔴 Database Issues (Supabase)

### Issue: Session data not saving

**Symptom**: After searching and closing the browser, results don't appear again

**Root cause**: Supabase credentials are wrong, or session table doesn't exist

**Fix**:
1. Go to Supabase dashboard → select your project
2. Go to **Settings** → **API** → copy your Project URL and Anon Key
3. Go to Railway → **Variables** tab
4. Check `SUPABASE_URL` and `SUPABASE_KEY`:
   - Do they match Supabase dashboard?
   - No extra spaces?
5. If different:
   - Update them
   - Save
   - Railway auto-redeploys
6. Check Supabase has a `sessions` table:
   - Supabase → **SQL Editor** → look for `sessions` in the list
   - If missing, you need to create it (contact project maintainer)

**Verify**: Sessions table has data in Supabase → **Table Editor**

---

## 🔴 Network & Connectivity Issues

### Issue: Deployment works locally but not on Vercel/Railway

**Symptom**: `docker-compose up` works fine, but production is broken

**Root cause**: Local `.env` and production env vars are different

**Fix**:
1. Compare your local `.env` files with what's set in Vercel and Railway
2. Check especially:
   - `VITE_API_URL` (Frontend)
   - `ANTHROPIC_API_KEY` (Backend)
   - `FRONTEND_URL` (Backend)
   - All Supabase values
3. Update any mismatches
4. Redeploy both services

**Verify**: Production behaves same as local

---

### Issue: "Cannot reach https://..." (DNS or network error)

**Symptom**: Browser shows a timeout or DNS error

**Root cause**: URL is wrong, typo, or service is down

**Fix**:
1. Verify the URL is correct:
   - Vercel: `https://footnote.vercel.app` (no `http://`, no trailing slash)
   - Railway: Check your Railway domain (Settings → Domains)
2. Test the URL:
   ```bash
   curl -I https://your-url.vercel.app
   # Should return 200
   ```
3. Check service status:
   - Is Vercel working? Go to https://vercel.com/status
   - Is Railway working? Go to https://railway.app (should load)
4. If a service is down, wait 5-10 minutes and retry

**Verify**: `curl` returns `200` response code

---

## 🟡 Performance Issues

### Issue: Search takes >30 seconds, or times out

**Symptom**: Results load very slowly, or you see a timeout error

**Root cause**: Claude API is slow, Semantic Scholar is slow, or backend is overloaded

**Fix**:
1. Check external API status:
   - Anthropic: https://status.anthropic.com
   - Semantic Scholar: http://semanticscholar.org (try searching there)
2. Check Railway → **Metrics** → look for high CPU or memory
   - If consistently high, Railway may auto-scale (add more containers)
   - This is automatic and takes 1-2 minutes
3. Try again after a minute
4. If it's still slow, it's likely external API slowness (not your fault)

**Verify**: Search completes within 20 seconds after external APIs are responsive

---

### Issue: Lighthouse performance score is low

**Symptom**: Vercel Analytics show red performance score

**Root cause**: Large JavaScript bundle, unoptimized images, or slow API calls

**Fix**:
1. Run Lighthouse locally:
   ```bash
   cd frontend
   npm run build
   npm run preview
   # Open http://localhost:4173 in Chrome
   # DevTools → Lighthouse → Analyze page load
   ```
2. Lighthouse report will show which assets are slow
3. Common fixes:
   - Remove unused dependencies from `package.json`
   - Use lazy-loading for heavy components (React.lazy)
   - Compress images
   - Upgrade to latest React/Vite versions
4. Commit changes and push to GitHub
5. Vercel auto-redeploys and re-measures performance

**Verify**: Lighthouse Performance score ≥ 90 desktop, ≥ 80 mobile

---

## 🟢 Quick Diagnostic Checklist

Use this when something is broken and you're not sure what:

```
Frontend not loading?
□ Check Vercel build logs for errors
□ Check browser console (DevTools → Console) for JavaScript errors
□ Verify VITE_API_URL env var is set in Vercel

Backend not responding?
□ Check Railway logs for Python errors
□ Test endpoint: curl https://your-railway-url.railway.app/health
□ Verify all env vars are set in Railway → Variables

CORS error?
□ Check FRONTEND_URL in Railway matches Vercel URL exactly
□ Redeploy Railway after changing FRONTEND_URL

API returns 500 error?
□ Check Railway logs for detailed error message
□ Verify ANTHROPIC_API_KEY is set and correct
□ Test external APIs are working (Semantic Scholar, OpenAlex)

Results are blank?
□ Check Network tab in DevTools for /api/research response
□ Is the response valid JSON or an error?
□ Check Railway logs while searching

Can't find where to add env vars?
□ Vercel: Project → Settings → Environment Variables
□ Railway: Select project → Variables tab
□ Supabase: Project → Settings → API

```

---

## Getting Help

If you're still stuck:

1. **Check the logs first** (90% of issues show up in logs)
2. **Search the exact error message** on GitHub Issues or Stack Overflow
3. **Open a GitHub issue** with:
   - Exact error message
   - Which service is failing (Vercel/Railway/Supabase)
   - Steps to reproduce
   - Screenshots of logs
4. **Email**: goodvibepublishing@gmail.com with details

---

**Last updated**: 2026-04-19  
**Status**: Ready to troubleshoot ✅
