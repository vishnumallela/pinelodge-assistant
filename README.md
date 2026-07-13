# Pine Lodge Assistant

Sarah is the AI front desk receptionist for **Pine Lodge's centers**. Sign in, pick a
center, place a call, and speak with her: she answers over **xAI Grok realtime voice**,
works out what the caller needs, redirects to whoever is on shift, and hangs up. Every call
lands in the center's call log; when it ends the record locks and a **BullMQ** job writes
up a summary with a Grok text model. Centers, staff, schedules, and each center's agent
prompt are all editable in the UI.

## Architecture

```
apps/
  frontend       Vite + React — center switcher, call log, live console, staff
                 scheduling, prompt editor, centers + phone setup
                 (shadcn components + TanStack Table)
  auth           Better Auth — console sign-in (Postgres)
  api-gateway    Bun — sessions, xAI secrets, centers + calls + staff +
                 settings (Postgres), BullMQ summaries + transfer briefs
                 (Redis), Twilio bridge webhook + agent + number management
```

- **Centers (multi-tenant)** — every center is a row in Postgres with its own name,
  timezone, inbound phone number, staff roster, and prompt. The sidebar dropdown picks the
  active center; the call log, staff page, prompt editor, and new console calls all scope
  to it. Manage centers at `/centers`. First boot creates a default center from
  `FACILITY_NAME`/`FACILITY_TIMEZONE` and migrates any pre-centers data onto it.
- **Voice pipeline** — the browser fetches a short-lived ephemeral client secret from
  `POST /api/realtime/token`, opens a WebSocket to `wss://api.x.ai/v1/realtime`, streams mic
  audio as 24 kHz PCM16, and plays the agent's audio back through an AudioWorklet player.
  The xAI API key never reaches the browser.
- **Staff & availability** — a person (name, phone, email) is stored once; each center they
  work at gets its own assignment (section, weekly window, time-off dates, active flag),
  evaluated in that center's timezone. The staff editor's "Person" picker attaches someone
  who already works at another center without retyping them. Exactly one person per center
  is the fallback: unplaceable and after-hours calls go there. Edited at `/staff`.
- **Prompt** — a template with `{{greeting}} {{staff_directory}} {{unavailable}} {{fallback}}`
  placeholders, stored per center and edited live from the sidebar (Prompt). It renders
  fresh at the start of every call with that center's current availability.
- **Call lifecycle** — "New call" creates a record under the selected center; turns stream
  to the transcript; ending the call locks it forever (writes 409 afterwards) and enqueues
  the summary job.
- **Transfer briefs** — the instant Sarah transfers a caller (console or the Twilio
  bridge), a BullMQ job summarizes the transcript-so-far with the Grok text model and
  emails the receiving staff member a React Email brief over SMTP, so they pick up already
  knowing the caller and the ask. Staff emails are edited at `/staff`; the sender is
  configured with `SMTP_*` + `EMAIL_FROM` (unset = feature off). Preview the template with
  `bun run email:preview` in `apps/api-gateway`.

## Phone (real phone calls via Twilio)

Each center gets its own inbound number; the dialed number (`To`) routes the call to that
center's prompt and roster. Unmatched numbers land on the default (first) center.

**Managed from the app** — set `TWILIO_AUTH_TOKEN` + `TWILIO_ACCOUNT_SID` on the
api-gateway, then on `/centers` → edit a center: assign a number the account already owns,
or search by area code and buy one. Buying and attaching point the number's voice webhook
at this deployment automatically; re-sync, detach, and release are one click each.

**Manual** — with only `TWILIO_AUTH_TOKEN` set:

1. Buy a voice number in the Twilio Console.
2. Point the number's "A call comes in" webhook (HTTP POST) at this deployment's
   `/api/twilio/incoming` (shown on `/phone`).
3. Enter the number on the center at `/centers` so inbound calls route to it.

Inbound calls hit the signed webhook; TwiML `<Connect><Stream>` pipes the caller's audio to
the gateway, which bridges it 1:1 into `wss://api.x.ai/v1/realtime` and runs the center's
prompt with the `transfer_call` + `end_call` tools. A transfer stashes the target, the
stream closes, and Twilio's `<Redirect>` → `<Dial>` connects the caller to the staff
member's phone. Every call is logged and summarized exactly like a console call.

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
