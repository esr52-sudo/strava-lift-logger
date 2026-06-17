# strava-lift-logger

A mobile-optimized web app that finds your most recent Strava activity (the one Strava already created from an Apple Health sync), generates an AI title and description for your weightlifting session from a quick free-text note, and patches that existing activity with the result. It never creates a new activity — it only updates the one Strava already has.

## How it works

1. On load, it fetches your latest Strava activity and shows its stats (duration, heart rate, calories).
2. You confirm it's the right workout (or cycle back to an earlier one), then type what you did.
3. Claude (`claude-sonnet-4-6`) generates a punchy title and a casual first-person description, which you can edit inline.
4. "Post to Strava" patches the existing activity via the Strava API.

## Prerequisites

Create a `.env` file in the project root (copy `.env.example`) with:

```
STRAVA_CLIENT_ID=        # from https://www.strava.com/settings/api
STRAVA_CLIENT_SECRET=    # from the same page
STRAVA_REFRESH_TOKEN=    # an OAuth refresh token with activity:read_all + activity:write scopes
ANTHROPIC_API_KEY=       # from https://console.anthropic.com/
```

The `ANTHROPIC_API_KEY` is used only server-side and is never exposed to the browser.

> The Strava refresh token must be authorized for the `activity:read_all` and `activity:write` scopes — the app reads your latest activity and writes the new title/description back to it. The backend exchanges the refresh token for a short-lived access token before every Strava call.

## Local development

You need two terminals — the FastAPI backend and the Vite dev server. The frontend dev server runs on `localhost:5173` and the backend on `localhost:8000`. (Note: the Vite dev proxy was removed for the Vercel setup — in production `/api/*` is handled by the serverless function, so frontend→backend calls aren't proxied during `npm run dev`.)

**Backend:**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Then open the Vite URL it prints (http://localhost:5173).

## Deploy to Vercel

This repo is configured for Vercel via `vercel.json`:

- The React frontend is built with `cd frontend && npm install && npm run build` and served statically from `frontend/dist` (`outputDirectory`).
- The FastAPI app in `api/index.py` runs as a Vercel Python serverless function (dependencies from the root `requirements.txt`). All `/api/*` requests are rewritten to it, with the original path preserved, so the existing endpoints work unchanged.
- All other routes fall back to `index.html` (single-page app).

To deploy: import the repo at [vercel.com](https://vercel.com) (**Add New → Project**). Before deploying, add the four environment variables in the Vercel project settings:

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- `STRAVA_REFRESH_TOKEN`
- `ANTHROPIC_API_KEY`

These are not in the repo (only `.env.example` is). After changing environment variables, trigger a redeploy for them to take effect.

> `render.yaml` and the original `backend/` directory remain in the repo as a fallback Render/FastAPI deployment option, but Vercel is the active deployment target.

## Notes

- **No database.** Every request is stateless.
- **No authentication.** This is a personal, single-user tool; Strava credentials live in `.env`.
- This app **patches existing Strava activities created via Apple Health sync — it does not create new ones.**
