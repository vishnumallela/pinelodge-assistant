# Pine Lodge Assistant

Sarah is the AI front desk receptionist for **Pine Lodge Assisted Living**. She answers every
incoming phone call over the OpenAI Realtime API, greets the caller, screens for spam and
emergencies, gathers the details a front desk needs, and then hands the call to a
**deterministic routing engine** that decides where it goes. When nobody is available, she
takes voicemail. Every call is transcribed, persisted, and summarized asynchronously into a
permanent Call Report.

## Core principle: AI is separated from business logic

| The model (Sarah) owns | The application owns |
| --- | --- |
| Conversation and tone | The routing table (`apps/api-gateway/src/lib/routing.ts`) |
| Intent understanding | Staff schedules and availability |
| Entity extraction | Spam/scam/emergency policy |
| Tool invocation | Transfer execution and voicemail |
| | Persistence, transcripts, reports |

Sarah's prompt contains **no business rules**. She emits exactly one route target
(`admissions`, `billing`, `escalation`, `onsite_care`, `routine_admin`, `general_question`,
`emergency`, `named_*`) through a tool; the routing engine resolves it against the live staff
table and tells her what happened.

## Architecture

```
apps/
  frontend       Vite + React console — simulated incoming calls (WebRTC voice),
                 call history & reports, staff administration
  api-gateway    Bun + oRPC — call lifecycle, routing engine, availability,
                 transcript persistence, async summarization, realtime token minting
  auth           Better Auth — console sign-in (separate Postgres)
packages/
  api-contracts  Type-only bridge from the gateway's router to the frontend
```

- **Voice pipeline** — the browser gets a short-lived ephemeral client secret from
  `POST /api/realtime/token`, opens a WebRTC call to the realtime model, and executes
  Sarah's tools client-side against the gateway. The provider API key never reaches the browser.
- **Routing** — `resolveRoute()` is a pure function over the staff table: department
  coverage, shift windows, fallback chains, nursing-line diversion, voicemail. Fully unit-tested.
- **Transfers** — simulated behind a `TransferProvider` interface
  (`apps/api-gateway/src/lib/transfer.ts`). Swapping in real SIP routing means implementing
  one interface; nothing else changes.
- **Summarization** — when a call completes, an in-process job runs a lower-cost model
  (`OPENAI_SUMMARY_MODEL`, never the realtime model) and stores the structured Call Report.
- **Staff management** — `/staff` edits names, departments, extensions, working days, shift
  windows, active status, and fallback destinations. Changes affect routing on the next call;
  no code changes required.

## Getting started

```bash
bun install
bun run db:up                  # start the two Postgres containers
cp apps/api-gateway/.env.example apps/api-gateway/.env   # add OPENAI_API_KEY
cp apps/auth/.env.example apps/auth/.env                 # set BETTER_AUTH_SECRET
cp apps/frontend/.env.example apps/frontend/.env
bun run dev                    # frontend :3000, auth :3001, api-gateway :3002
```

Sign up at `http://localhost:3000`, then start a simulated call from the console. The staff
directory (Sheri — Admissions, Mira — Billing, Richa — Administration, Dessa — Front Office,
and the 24/7 Main Nursing Line) is seeded on first boot.

## Commands

```bash
bun run dev          # all services, hot reload
bun run check        # typecheck + lint + tests + format check
bun run test         # unit tests (routing engine, shifts, call lifecycle, parsers)
bun run build        # production builds
docker compose up    # full stack in containers
```

## Proof-of-concept scope

Telephony (SIP/Twilio/LiveKit), CRM/EHR integration, email/SMS delivery, and production
authentication are intentionally out of scope. The console simulates the phone line; the
architecture isolates each of these behind a seam so they can be added without refactoring.
