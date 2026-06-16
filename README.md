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

You need two terminals — the FastAPI backend and the Vite dev server. The Vite server proxies `/api` to the backend, so the frontend talks to `localhost:5173` and requests reach the backend on `localhost:8000`.

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

## Deploy to Render

This repo includes `render.yaml`. Create a new **Web Service** from the repo (or use a Blueprint deploy). Render will:

- `pip install -r requirements.txt`
- build the frontend (`cd frontend && npm install && npm run build`)
- start the app with `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`

In production the FastAPI backend serves the built frontend from `frontend/dist`, so it runs as a single web service.

Set the four environment variables (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `ANTHROPIC_API_KEY`) in the Render dashboard — they are marked `sync: false` in `render.yaml`, meaning Render prompts you for them rather than reading them from the repo. Never commit real secrets.

## Notes

- **No database.** Every request is stateless.
- **No authentication.** This is a personal, single-user tool; Strava credentials live in `.env`.
- This app **patches existing Strava activities created via Apple Health sync — it does not create new ones.**
