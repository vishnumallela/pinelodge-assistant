# Pine Lodge Assistant

Sarah is the AI front desk receptionist for **Pine Lodge Assisted Living**. Sign in, place a
call, and speak with her: she answers over **xAI Grok realtime voice**, works out what the
caller needs, redirects to whoever is on shift, and hangs up. Every call lands in the call
log; when it ends the record locks and a **BullMQ** job writes up a summary with a Grok text
model. Staff, schedules, and the agent prompt itself are all editable in the UI.

## Architecture

```
apps/
  frontend       Vite + React — call log, live console, staff scheduling,
                 prompt editor, SIP setup (shadcn components + TanStack Table)
  auth           Better Auth — console sign-in (Postgres)
  api-gateway    Bun — sessions, xAI secrets, calls + staff + settings
                 (Postgres), BullMQ summaries (Redis), SIP webhook + agent
```

- **Voice pipeline** — the browser fetches a short-lived ephemeral client secret from
  `POST /api/realtime/token`, opens a WebSocket to `wss://api.x.ai/v1/realtime`, streams mic
  audio as 24 kHz PCM16, and plays the agent's audio back through an AudioWorklet player.
  The xAI API key never reaches the browser.
- **Staff & availability** — staff live in Postgres with weekly windows, time-off dates,
  and an active flag, evaluated in `FACILITY_TIMEZONE`. Exactly one person is the fallback:
  unplaceable and after-hours calls go there. Edited at `/staff`.
- **Prompt** — a template with `{{greeting}} {{staff_directory}} {{unavailable}} {{fallback}}`
  placeholders, stored in settings and edited live from the sidebar (Prompt). It renders
  fresh at the start of every call with current availability.
- **Call lifecycle** — "New call" creates a record; turns stream to the transcript; ending
  the call locks it forever (writes 409 afterwards) and enqueues the summary job.

## SIP (real phone calls)

Route a real number into Sarah from `/phone`:

1. Register your number (byo_trunk) there — the app calls xAI's `POST /v2/phone-numbers`
   with this deployment's `/api/sip/incoming` webhook and stores the signing secret it
   returns (shown once; `XAI_SIP_WEBHOOK_SECRET` overrides it per environment).
2. Point your carrier (Twilio / Telnyx / Plivo / PBX) at
   `sip:{number}@sip.voice.x.ai;transport=tls`.
3. Inbound calls hit the signed webhook; the gateway joins
   `wss://api.x.ai/v1/realtime?call_id=…` with the API key, runs the same prompt and
   `end_call` tool server-side, hangs up via `POST /v1/realtime/calls/{id}/hangup`, and the
   call is logged and summarized exactly like a console call.

## Getting started

```bash
bun install
bun run infra:up               # postgres (app + auth) and redis containers
cp apps/api-gateway/.env.example apps/api-gateway/.env   # add XAI_API_KEY
cp apps/auth/.env.example apps/auth/.env                 # set BETTER_AUTH_SECRET
cp apps/frontend/.env.example apps/frontend/.env
bun run dev                    # frontend :3000, auth :3001, api-gateway :3002
```

Sign up at `http://localhost:3000`, then start a call from the call log.

## Commands

```bash
bun run dev          # all services, hot reload
bun run check        # typecheck + lint + format check
bun run build        # production builds
docker compose up    # full stack in containers
```
