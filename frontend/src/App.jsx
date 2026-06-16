import { useState, useEffect, useCallback, useRef } from "react";

const ENERGY_OPTIONS = ["DEPLETED", "LOW", "NORMAL", "HIGH", "DIALED IN"];
const NOTABLE_OPTIONS = [
  "PR HIT",
  "FELT HEAVY",
  "GOOD PUMP",
  "CUT IT SHORT",
  "WENT LONGER",
  "NOTHING TO NOTE",
];
const NOTHING = "NOTHING TO NOTE";
const CONTEXT_OPTIONS = [
  "NORMAL WEEK",
  "DELOAD",
  "COMING BACK",
  "BUILDING TOWARD SOMETHING",
];
const FEEL_CAPTIONS = { 1: "ROUGH", 3: "OK", 5: "STRONG" };

const fmtHr = (v) => (v == null ? "—" : `${Math.round(v)} bpm`);
const fmtCal = (v) => (v == null ? "—" : `${Math.round(v)} cal`);
const fmtDate = (s) => (s ? s.replace(" at ", " · ").toUpperCase() : "");

export default function App() {
  const [activity, setActivity] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Inputs
  const [feelRating, setFeelRating] = useState(null);
  const [energyLevel, setEnergyLevel] = useState("");
  const [notable, setNotable] = useState([]);
  const [trainingContext, setTrainingContext] = useState("");
  const [setsText, setSetsText] = useState("");

  // Generation / posting
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(null); // { title, description }
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(null); // { strava_url }

  const titleRef = useRef(null);
  const descRef = useRef(null);

  const fetchActivity = useCallback(async (p) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/latest-activity?page=${p}`);
      if (!res.ok) throw new Error((await res.json()).detail || "Fetch failed");
      setActivity(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivity(1);
  }, [fetchActivity]);

  const loadPrevious = () => {
    const next = page + 1;
    setPage(next);
    setGenerated(null);
    setPosted(null);
    fetchActivity(next);
  };

  const resetForNew = () => {
    setFeelRating(null);
    setEnergyLevel("");
    setNotable([]);
    setTrainingContext("");
    setSetsText("");
    setGenerated(null);
    setPosted(null);
    setError(null);
    setPage(1);
    fetchActivity(1);
  };

  const toggleNotable = (opt) => {
    setNotable((prev) => {
      if (opt === NOTHING) return prev.includes(NOTHING) ? [] : [NOTHING];
      const without = prev.filter((o) => o !== opt && o !== NOTHING);
      return prev.includes(opt) ? without : [...without, opt];
    });
  };

  const callGenerate = async () => {
    if (!activity) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_id: activity.id,
          sets_text: setsText,
          feel_rating: feelRating,
          energy_level: energyLevel,
          notable,
          training_context: trainingContext,
          activity_stats: {
            elapsed_time_minutes: activity.elapsed_time_minutes,
            average_heartrate: activity.average_heartrate,
            max_heartrate: activity.max_heartrate,
            calories: activity.calories,
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Generation failed");
      const data = await res.json();
      setGenerated({ title: data.title, description: data.description });
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const postToStrava = async () => {
    if (!activity || !generated) return;
    setPosting(true);
    setError(null);
    const title = titleRef.current?.innerText.trim() || generated.title;
    const description =
      descRef.current?.innerText.trim() || generated.description;
    try {
      const res = await fetch("/api/patch-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activity_id: activity.id, title, description }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Post failed");
      const data = await res.json();
      setPosted({ strava_url: data.strava_url });
    } catch (e) {
      setError(e.message);
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return <div className="page loading">Finding your latest activity…</div>;
  }

  if (error && !activity) {
    return (
      <div className="page">
        <div className="error-banner">{error}</div>
        <button className="btn-primary" onClick={() => fetchActivity(page)}>
          Try again
        </button>
      </div>
    );
  }

  const canGenerate = feelRating != null && setsText.trim() !== "";

  return (
    <div className="page">
      <div className="wordmark">Lift Log</div>

      {error && <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>}

      {/* Activity block */}
      <div className="activity-block">
        <div className="activity-date">{fmtDate(activity.start_date)}</div>
        <div className="activity-name">{activity.name}</div>
        <div className="stats-row">
          <div>
            <div className="stat-value">{activity.elapsed_time_minutes}m</div>
            <div className="stat-label">Duration</div>
          </div>
          <div>
            <div className="stat-value">{fmtHr(activity.average_heartrate)}</div>
            <div className="stat-label">Avg HR</div>
          </div>
          <div>
            <div className="stat-value">{fmtCal(activity.calories)}</div>
            <div className="stat-label">Calories</div>
          </div>
        </div>
        <div className="link-dim" role="button" tabIndex={0} onClick={loadPrevious}>
          Not your workout?
        </div>
      </div>

      <hr className="divider" />

      {/* Q1 — feel */}
      <div className="question">
        <div className="question-label">How did this feel</div>
        <div className="feel-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <div className="feel-item" key={n}>
              <button
                className={`feel-btn${feelRating === n ? " selected" : ""}`}
                onClick={() => setFeelRating(n)}
              >
                {n}
              </button>
              <div className="feel-caption">{FEEL_CAPTIONS[n] || ""}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Q2 — energy */}
      <div className="question">
        <div className="question-label">Energy coming in</div>
        <div className="pills">
          {ENERGY_OPTIONS.map((opt) => (
            <button
              key={opt}
              className={`pill${energyLevel === opt ? " selected" : ""}`}
              onClick={() => setEnergyLevel((p) => (p === opt ? "" : opt))}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Q3 — notable */}
      <div className="question">
        <div className="question-label">Anything notable</div>
        <div className="pills">
          {NOTABLE_OPTIONS.map((opt) => (
            <button
              key={opt}
              className={`pill${notable.includes(opt) ? " selected" : ""}`}
              onClick={() => toggleNotable(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* Q4 — training context */}
      <div className="question">
        <div className="question-label">Training context</div>
        <div className="pills">
          {CONTEXT_OPTIONS.map((opt) => (
            <button
              key={opt}
              className={`pill${trainingContext === opt ? " selected" : ""}`}
              onClick={() => setTrainingContext((p) => (p === opt ? "" : opt))}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <hr className="divider" />

      {/* Sets and reps */}
      <div className="question" style={{ marginTop: 32 }}>
        <div className="sets-label">Sets and reps</div>
        <textarea
          className="sets"
          rows={5}
          value={setsText}
          onChange={(e) => setSetsText(e.target.value)}
          placeholder="bench 3x5 @ 185, incline db 3x10, tricep pushdowns"
        />
      </div>

      {/* Generate OR Preview */}
      {!generated ? (
        <button
          className="btn-primary"
          onClick={callGenerate}
          disabled={!canGenerate || generating}
        >
          {generating ? "Generating…" : "Generate"}
        </button>
      ) : (
        <>
          <hr className="divider" />
          <div
            className="gen-title"
            contentEditable
            suppressContentEditableWarning
            ref={titleRef}
            style={{ marginTop: 32 }}
          >
            {generated.title}
          </div>
          <div
            className="gen-description"
            contentEditable
            suppressContentEditableWarning
            ref={descRef}
          >
            {generated.description}
          </div>

          <div
            className="regenerate"
            role="button"
            tabIndex={0}
            onClick={callGenerate}
          >
            {generating ? "Regenerating…" : "Regenerate"}
          </div>

          {!posted ? (
            <button className="btn-primary" onClick={postToStrava} disabled={posting}>
              {posting ? "Posting…" : "Post to Strava"}
            </button>
          ) : (
            <div className="posted">
              Posted.
              <a
                className="posted-link"
                href={posted.strava_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Strava →
              </a>
              <div
                className="posted-again"
                role="button"
                tabIndex={0}
                onClick={resetForNew}
              >
                Log another
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
