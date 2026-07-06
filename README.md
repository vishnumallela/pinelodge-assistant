# Pine Lodge Assistant

Sarah is the AI front desk receptionist for **Pine Lodge Assisted Living**. Sign in, start a
simulated call, and speak with her: she answers over **xAI Grok realtime voice**, asks what
you need, matches it against a small staff directory in her prompt, announces
*"I'm redirecting you to … now"*, and hangs up. That is the entire app — a proof of concept
for login + voice agent, nothing more.

## Architecture

```
apps/
  frontend       Vite + React console — the call UI and the Grok voice hook
  auth           Better Auth — console sign-in (Postgres)
  api-gateway    Bun — verifies the session, mints the xAI realtime client secret
```

- **Voice pipeline** — the browser fetches a short-lived ephemeral client secret from
  `POST /api/realtime/token`, opens a WebSocket to `wss://api.x.ai/v1/realtime`
  (`grok-voice-latest`), streams mic audio as 24 kHz PCM16, and plays the agent's audio
  back through a scheduled player. The xAI API key never reaches the browser.
- **Agent** — a few-line prompt plus a staff-directory JSON (Sheri — Admissions,
  Mira — Billing, Richa — Administration, Dessa — Front Office). Her only tool is
  `end_call`, which hangs up after she finishes speaking.

## Getting started

```bash
bun install
bun run db:up                  # start the auth Postgres container
cp apps/api-gateway/.env.example apps/api-gateway/.env   # add XAI_API_KEY
cp apps/auth/.env.example apps/auth/.env                 # set BETTER_AUTH_SECRET
cp apps/frontend/.env.example apps/frontend/.env
bun run dev                    # frontend :3000, auth :3001, api-gateway :3002
```

Sign up at `http://localhost:3000`, then start a call from the console.

## Commands

```bash
bun run dev          # all services, hot reload
bun run check        # typecheck + lint + format check
bun run build        # production builds
docker compose up    # full stack in containers
```
