# Galaxy Watch health dashboard

A private dashboard for Galaxy Watch 7 data, plus an AI assistant that answers questions about it.
Everything runs on your own computer; health data never leaves it, except the rows the assistant
reads while answering a question, which are sent to Anthropic (via Claude Code or the API).

```
Galaxy Watch → Samsung Health → Health Connect → android/ (Watch Sync app)
                                                     │  POST /api/ingest (home Wi-Fi, bearer token)
                                                     ▼
                     web/ (Next.js) ── SQLite (data/health.db) ── dashboard  /
                                                              └── assistant  /chat
```

## 1. Run the dashboard

Requires Node 22.5+ (it uses the built-in `node:sqlite`).

```sh
cd web
npm install
cp .env.example .env.local   # then fill in INGEST_TOKEN (openssl rand -hex 24)
npm run dev                  # http://localhost:4747, also reachable from your phone on the LAN
```

To try it before importing anything: `npm run seed:demo && npm run dev:demo`. This uses a separate
`data/demo.db` with 120 days of generated data.

## 2. Import your history (Samsung Health export)

1. On the phone: Samsung Health → ⋮ → Settings → **Download personal data** → Download.
2. Copy the `Download/Samsung Health/samsunghealth_*` folder to this computer.
3. `npm run import:shealth -- /path/to/samsunghealth_xxx`

The importer lists which files it used and which it skipped. Re-running it is safe because rows are
upserted. Samsung's CSV columns aren't formally documented, so if a metric you expected is missing,
add a handler in `web/scripts/import-shealth.ts`.

## 3. Keep it in sync (Android app)

1. In Samsung Health: Settings → **Health Connect** → enable syncing.
2. Build and install: `cd android && ./gradlew installDebug` (phone connected over USB with debugging on),
   or copy `android/app/build/outputs/apk/debug/app-debug.apk` to the phone.
3. In **Watch Sync**: enter `http://<this computer's LAN IP>:4747` and the `INGEST_TOKEN`, then tap
   **Grant access** and **Sync now**. Turn on hourly auto-sync if you want.

The app never reads more than 30 days back: the first sync (and **Re-sync last 30 days**) starts
there, and later syncs read from the last sync, with a 2-day overlap to catch data the watch
delivered late. Older history comes from the Samsung Health export above. Background
sync runs only on unmetered Wi-Fi, and quietly retries when the computer is off.

## 4. Use it as an app on your phone (Tailscale)

The dashboard installs from Chrome as a standalone app with its own icon and no address bar. Chrome only
installs it from an HTTPS address. Tailscale gives you one, and it also lets the phone reach the dashboard
away from home. Traffic goes directly between your own devices; nothing is hosted in the cloud.

1. On this computer: `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up` and log in.
2. In the Tailscale admin console → **DNS**: make sure MagicDNS is on and enable **HTTPS Certificates**.
3. Run the dashboard (`npm run build && npm start` in `web/`, or `npm run dev`), then
   `sudo tailscale serve --bg 4747`. It prints the address: `https://<machine>.<tailnet>.ts.net`.
   It only works inside your tailnet. Don't use `tailscale funnel`, which would put it on the internet.
4. On the phone: install the Tailscale app and log in with the same account.
5. Open the `https://….ts.net` address in Chrome → ⋮ → **Add to Home screen** → **Install**.

Pull down on a page to refresh it. The app still needs this computer to be on, since that's where the data
and the assistant live. If you like, use the `.ts.net` address in **Watch Sync** too, so it can also sync
on Wi-Fi away from home. The HTTPS certificate puts the machine and tailnet names in public
certificate-transparency logs; nothing else about the dashboard is exposed.

## Pages

| Page | What's on it |
|---|---|
| **Today** `/` | Goal rings (steps, sleep, exercise), a body check against your 30-day usual, key numbers with 7-day sparklines, heart rate through the day, last night's sleep. Step through days or pick one from the calendar (`/day/YYYY-MM-DD`). |
| **Activity** `/activity` | Steps calendar, daily steps with 7-day average, best days, steps by weekday, distance, calories, weekly/monthly averages |
| **Sleep** `/sleep` | Time asleep, bed/wake-time consistency, sleep debt, stages by night and stage balance, weeknights vs weekends, every night |
| **Heart & body** `/heart` | Daily heart-rate range, resting HR, VO₂ max, blood oxygen, respiratory rate, skin temperature, weight, body fat |
| **Workouts** `/workouts` | Weekly training load, time in heart-rate zones, by activity, personal bests; each workout has its own page |
| **Trends** `/trends` | Last 30 days against the 30 before and a year earlier, a month-by-month table shaded by your better months, monthly steps, sleep, resting HR and workout time |
| **Ask** `/chat` | The assistant (below) |

Light, dark or system theme from the sidebar. Optional settings in `.env.local`: `STEPS_GOAL`,
`SLEEP_GOAL_HOURS`, `EXERCISE_GOAL_MIN` (ring goals), `MAX_HR` (heart-rate zones; default is the
highest HR recorded in a workout) and `HEIGHT_CM` (stride length for distance).

Samsung Health only shares workout distance with Health Connect, so daily distance is the larger
of that and steps × stride (0.415 × height, or 0.76 m). Workouts the watch detected on its own
(short walks and "other" activities) are hidden on the Workouts page by default; they still count
as exercise. The Android app sends each workout's recording method; tap **Re-sync last 30 days**
once after updating the app so recent workouts get it too.

## The assistant

`/chat` uses Claude (`claude-opus-5-5`) with three read-only tools: data coverage, a per-day summary,
and SQL over a **read-only** connection to the database. Each lookup it makes is shown under its answer.

By default it runs through the Claude Code installed on this machine (`claude` must be logged in), so
your Claude subscription covers it and no API key is needed. Claude Code's own tools, settings,
plugins and MCP servers are switched off for these requests. Set `ANTHROPIC_API_KEY` in
`web/.env.local` to call the Anthropic API directly instead, or `AGENT_BACKEND=api|claude-code` to force one.

## Data model

| Table | Holds |
|---|---|
| `samples` | heart rate, resting HR, HRV, SpO₂, weight, body composition, BP, VO₂ max, steps and distance in short intervals, speed / cadence / power / elevation during workouts, hydration, nutrition, … (one row per measurement) |
| `daily_metrics` | steps, distance, calories, floors as per-day totals (de-duplicated across phone + watch) |
| `sleep_sessions` / `sleep_stages` | nights and their deep / light / REM / awake segments |
| `exercise_sessions` | workouts with duration, distance, calories, avg / max HR; laps, segments and effort in `meta` |
| `exercise_routes` | GPS points recorded during workouts |

## Notes

- `npm run dev` listens on all interfaces so the phone can reach `/api/ingest`. The dashboard and
  assistant aren't password-protected, so anyone on your home network can open them.
  Ingest requires the token.
- Some Samsung-only metrics (Energy Score, antioxidant index, vascular load, ECG) are not shared
  with Health Connect; a few may appear in the CSV export.

## Scores

All three are 0-100 (85+ excellent, 70-84 good, 55-69 fair, below 55 low) and are weighted
averages of named parts, each scored 0-100, so the dashboard can always show why a score is what
it is. Personal parts compare against your own 30-day usual. The rules live in
`web/src/lib/scores.ts`; they are this dashboard's heuristics, not Samsung's or medical measures.

| Score | Parts (weight) |
|---|---|
| **Sleep** (per night) | duration vs goal (35), efficiency (15), deep sleep share (15), REM share (15), bedtime regularity (20) |
| **Energy** (each morning) | last night's sleep (30), resting HR vs usual (25), 7-night sleep balance (15), recovery from training load (20), bedtime consistency (10). A resting HR 5+ bpm above usual caps the score. |
| **Activity** (per day) | steps vs goal (60), exercise over the last 7 days vs 150 min (30), exercise today (10) |

Resting heart rate is derived from sleep: the lowest 30-minute average while asleep. Samsung
Health doesn't share resting HR or HRV with Health Connect, so there is no HRV anywhere.
