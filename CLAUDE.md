# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start here.** `STACK.md` (in this same directory) has the compact
architecture / stack / AWS context. Read it before doing any non-trivial
work on this repo — it'll save you 3-4 rounds of grep.

## Quick orientation

- Frontend: `client/` — Next.js 16, React 19, Tailwind 4. The big file is
  `client/app/poker/page.jsx` (~2800 lines: WS, state, game render, action
  bar, panels). Everything else is component-scoped.
- Backend: `server/` — Node 22 with native `--env-file-if-exists` (no
  dotenv). Express + `ws` share one listener. Postgres via `pg`.
- Bot sandbox: `client/app/lib/botCodeRunner.js` (browser) and
  `server/src/bots/` (authoritative). Sandbox is not a security boundary —
  it's user-runs-user-code.
- AWS uploads: private S3 + CloudFront with OAC. Resource IDs are in
  `STACK.md` and the env files. Server issues presigned PUT URLs; client
  uploads direct to S3.

## Commands

```bash
# server/  (Node 22, no dotenv — uses --env-file-if-exists)
npm run dev                                   # nodemon + .env
npm start                                     # node + .env
npm run start:prod                            # node + .env.production
npm run migrate                               # apply pending pg migrations (idempotent)
npm test                                      # node --test, runs server/test/*.test.js
node --env-file-if-exists=.env --test test/handEvaluator.test.js   # single file
node --env-file-if-exists=.env --test --test-name-pattern="straight flush"  # single case

# client/  (Next.js 16)
npm run dev                                   # :3000
npm run build                                 # also the type/syntax sanity check after edits
npm start
```

No linter is configured in either side; `next build` is the closest thing to one for the client.
The client has no test runner today.

## Conventions worth keeping

- **Comments**: only when the *why* is non-obvious. Don't narrate the
  code. Existing comments in this repo lean toward explaining a constraint
  or a past incident — match that bar.
- **Tests**: `node --test`, files under `server/test/*.test.js`. No jest.
- **Build verification**: after edits to `client/` run `npx next build` (or
  `npm run build`); it surfaces type/syntax issues in seconds.
- **Mobile-first**: `sm:` = 640px. Below that, mind safe-area-insets
  (`safe-bottom-offset`, `safe-bottom-offset-lg`, `spectator-stack-bottom`
  helpers live in `globals.css`).
- **Memory hygiene**: this repo has a memory dir under `.claude/`. Read
  `MEMORY.md` when relevant; persist non-obvious user preferences or
  cross-session context there.

## When you touch something risky

- **WebSocket lifecycle** in `poker/page.jsx` — there's no reconnect
  today; don't accidentally introduce dep churn on the `new WebSocket(WS_URL)`
  effect (grep for it — the file is ~3000 lines and line numbers drift).
- **Bot save / recalc flows** in `poker/bots/[id]/page.jsx` — there's a
  known stale-load race; if you guard one path, guard the other.
- **CORS / env**: `server/.env.production` must not include `localhost`
  in `CORS_ORIGINS`. The deployed frontend's *exact* scheme+host is what
  the server compares against.

## Setup

For a fresh checkout: `./scripts/setup-env.sh` generates placeholder
`.env*` files for both sides + both environments. Full walk-through is in
`README.md` at the repo root.
