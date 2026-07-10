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
                 prompt editor, phone setup (shadcn components + TanStack Table)
  auth           Better Auth — console sign-in (Postgres)
  api-gateway    Bun — sessions, xAI secrets, calls + staff + settings
                 (Postgres), BullMQ summaries + transfer briefs (Redis),
                 Twilio bridge webhook + agent
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
- **Transfer briefs** — the instant Sarah transfers a caller (console or the Twilio
  bridge), a BullMQ job summarizes the transcript-so-far with the Grok text model and
  emails the receiving staff member a React Email brief over SMTP, so they pick up already
  knowing the caller and the ask. Staff emails are edited at `/staff`; the sender is
  configured with `SMTP_*` + `EMAIL_FROM` (unset = feature off). Preview the template with
  `bun run email:preview` in `apps/api-gateway`.

## Phone (real phone calls via Twilio)

Route a real number into Sarah from `/phone`:

1. Buy a voice number in the Twilio Console and set the account's Auth Token as
   `TWILIO_AUTH_TOKEN` on the api-gateway.
2. Point the number's "A call comes in" webhook (HTTP POST) at this deployment's
   `/api/twilio/incoming`.
3. Inbound calls hit the signed webhook; TwiML `<Connect><Stream>` pipes the caller's
   audio to the gateway, which bridges it 1:1 into `wss://api.x.ai/v1/realtime` and runs
   the same prompt with the `transfer_call` + `end_call` tools. A transfer stashes the
   target, the stream closes, and Twilio's `<Redirect>` → `<Dial>` connects the caller to
   the staff member's phone. Every call is logged and summarized exactly like a console
   call.

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
