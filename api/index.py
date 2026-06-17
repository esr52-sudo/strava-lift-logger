"""strava-lift-logger backend.

A single-user, stateless FastAPI service that:
  1. Finds the most recent Strava activity (created via Apple Health sync).
  2. Generates an AI title + description from a free-text note using Claude.
  3. Patches the existing Strava activity with that title + description.

No database. No new activity is ever created.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import List, Optional

import anthropic
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

STRAVA_CLIENT_ID = os.getenv("STRAVA_CLIENT_ID")
STRAVA_CLIENT_SECRET = os.getenv("STRAVA_CLIENT_SECRET")
STRAVA_REFRESH_TOKEN = os.getenv("STRAVA_REFRESH_TOKEN")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"
CLAUDE_MODEL = "claude-sonnet-4-6"

app = FastAPI(title="strava-lift-logger")


# ---------------------------------------------------------------------------
# Strava helpers
# ---------------------------------------------------------------------------
def get_access_token() -> str:
    """Exchange the long-lived refresh token for a fresh access token.

    Strava access tokens are short-lived, so we refresh before every API
    session rather than persisting anything.
    """
    if not (STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET and STRAVA_REFRESH_TOKEN):
        raise HTTPException(
            status_code=500,
            detail="Strava credentials are not configured. Check your .env file.",
        )

    resp = httpx.post(
        STRAVA_TOKEN_URL,
        data={
            "client_id": STRAVA_CLIENT_ID,
            "client_secret": STRAVA_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "refresh_token": STRAVA_REFRESH_TOKEN,
        },
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Strava token refresh failed: {resp.text}",
        )
    return resp.json()["access_token"]


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _format_start_date(iso_local: str | None) -> str:
    """Format Strava's local start date as e.g. 'Monday Jun 16 at 9:41am'."""
    if not iso_local:
        return ""
    from datetime import datetime

    # Strava returns local time like '2026-06-16T09:41:00Z' in start_date_local.
    dt = datetime.fromisoformat(iso_local.replace("Z", "+00:00"))
    day_part = dt.strftime("%A %b %d at ")
    # %-I is non-zero-padded hour on macOS/Linux.
    time_part = dt.strftime("%-I:%M%p").lower()
    return day_part + time_part


# ---------------------------------------------------------------------------
# Anthropic helper
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You generate short Strava activity descriptions for \
weightlifting sessions. Your output should read like a text message — \
specific, direct, no filler. 1-3 sentences maximum. First person.

Use the inputs to write something that sounds like a real person dashed it \
off after a workout:
- Reference what they actually did (sets/reps/weights)
- Let the feel rating and energy level inform the tone without stating them \
explicitly ("felt heavy" not "I rated this 2/5")
- Mention something notable only if it's specific and earned — never generic
- Do not editorialize. Do not use words like: intense, rewarding, \
accomplished, challenging, pushed, grind, beast, crush, killed it
- If HR or calorie data exists, you may weave in one number naturally — do \
not list stats
- The last sentence can give training context if the user provided it, \
otherwise omit it

Return ONLY valid JSON, no preamble, no markdown:
{
  "title": "max 6 words, specific to what they did, no generic phrases like \
'weight training' or 'gym session'",
  "description": "1-3 sentences, text message tone"
}"""


def generate_with_claude(req: "GenerateRequest") -> dict:
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not configured. Check your .env file.",
        )

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    stats = req.activity_stats
    notable_text = ", ".join(req.notable) if req.notable else "nothing to note"
    energy_text = req.energy_level or "not specified"
    context_text = req.training_context or "not specified"

    user_message = (
        f"Sets/reps/weights: {req.sets_text}\n"
        f"How it felt (1=Rough, 5=Strong): {req.feel_rating}/5\n"
        f"Energy coming in: {energy_text}\n"
        f"Notable: {notable_text}\n"
        f"Training context: {context_text}\n"
        f"Duration: {stats.elapsed_time_minutes} minutes\n"
        f"Avg HR: {stats.average_heartrate if stats.average_heartrate is not None else 'not recorded'}\n"
        f"Calories: {stats.calories if stats.calories is not None else 'not recorded'}"
    )

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    text = next((b.text for b in response.content if b.type == "text"), "").strip()

    # Be forgiving if the model wraps the JSON in a code fence despite the prompt.
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        data = json.loads(text)
        return {"title": data["title"], "description": data["description"]}
    except (json.JSONDecodeError, KeyError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not parse Claude response as JSON: {exc}",
        )


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------
class ActivityStats(BaseModel):
    elapsed_time_minutes: int
    average_heartrate: Optional[float] = None
    max_heartrate: Optional[float] = None
    calories: Optional[float] = None


class GenerateRequest(BaseModel):
    activity_id: int
    sets_text: str
    feel_rating: int
    energy_level: str = ""
    notable: List[str] = []
    training_context: str = ""
    activity_stats: ActivityStats


class PatchRequest(BaseModel):
    activity_id: int
    title: str
    description: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/latest-activity")
def latest_activity(page: int = 1):
    """Return the most recent Strava activity (or an older one by page offset).

    The list endpoint omits calories and description, so we resolve the
    activity ID from the list, then fetch its detail for the full stats.
    """
    token = get_access_token()

    list_resp = httpx.get(
        f"{STRAVA_API_BASE}/athlete/activities",
        headers=_auth_headers(token),
        params={"per_page": 1, "page": page},
        timeout=30,
    )
    if list_resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"Strava activities fetch failed: {list_resp.text}"
        )

    activities = list_resp.json()
    if not activities:
        raise HTTPException(status_code=404, detail="No activities found.")

    activity_id = activities[0]["id"]

    detail_resp = httpx.get(
        f"{STRAVA_API_BASE}/activities/{activity_id}",
        headers=_auth_headers(token),
        params={"include_all_efforts": "false"},
        timeout=30,
    )
    if detail_resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"Strava activity detail failed: {detail_resp.text}"
        )

    a = detail_resp.json()
    return {
        "id": a["id"],
        "name": a.get("name"),
        "type": a.get("type"),
        "elapsed_time_minutes": int(a.get("elapsed_time", 0) // 60),
        "average_heartrate": a.get("average_heartrate"),
        "max_heartrate": a.get("max_heartrate"),
        "calories": a.get("calories"),
        "start_date": _format_start_date(a.get("start_date_local")),
        "existing_description": a.get("description"),
    }


@app.post("/api/generate-description")
def generate_description(req: GenerateRequest):
    result = generate_with_claude(req)
    return {"title": result["title"], "description": result["description"]}


@app.post("/api/patch-activity")
def patch_activity(req: PatchRequest):
    token = get_access_token()

    resp = httpx.put(
        f"{STRAVA_API_BASE}/activities/{req.activity_id}",
        headers=_auth_headers(token),
        json={"name": req.title, "description": req.description},
        timeout=30,
    )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"Strava patch failed: {resp.text}"
        )

    return {
        "success": True,
        "strava_url": f"https://www.strava.com/activities/{req.activity_id}",
    }


# ---------------------------------------------------------------------------
# Serve the built frontend (production / Render). In local dev the Vite server
# handles the UI and proxies /api here, so this block is a no-op until a build
# exists at frontend/dist.
# ---------------------------------------------------------------------------
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/")
    def _index():
        return FileResponse(_DIST / "index.html")
