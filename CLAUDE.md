# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start here.** `STACK.md` (in this same directory) has the compact
architecture / stack / AWS context. Read it before doing any non-trivial
work on this repo — it'll save you 3-4 rounds of grep.

## Quick orientation

- Frontend: `client/` — Next.js 16, React 19, Tailwind 4. The two big
  files are `client/app/poker/page.jsx` (~4000 lines: WS, state, game
  render, action bar, panels) and `client/app/poker/bots/[id]/page.jsx`
  (bot editor + recalc flows). Everything else is component-scoped.
- Backend: `server/` — Node 22 with native `--env-file-if-exists` (no
  dotenv). Express + `ws` share one listener. Postgres via `pg`. The
  fat file on this side is `server/src/rooms/PokerRoom.js` (~2000 lines:
  the game-state machine) and `server/src/network/MessageHandler.js`
  (~840 lines: WS routing + per-message handlers).
- REST surface is mounted in `server/src/api/index.js` — auth, bots,
  uploads, users (me + public), dailies, notifications, dms, feed.
- Auth: dual-mode — Google Identity Services *and* native email/password
  (migration 022; `server/src/auth/{email,password,verificationRepository}.js`).
  Both paths issue the same JWT in an httpOnly cookie. `useAuth` (client)
  + `apiRouter` middleware (server). See STACK.md.
- Bot sandbox: `client/app/lib/botCodeRunner.js` (browser) and
  `server/src/bots/` (authoritative). Sandbox is not a security boundary —
  it's user-runs-user-code. Three bot kinds coexist: user-scripted JS,
  **neural** (`server/src/bots/neural/` — mlp, qlearning, reinforce,
  reinforce-baseline; weights persisted) and **super** (`server/src/bots/super/`
  + migrations 026-027 — rule/transition driven, edited via `SuperBotForm`).
- AWS uploads: private S3 + CloudFront with OAC. Resource IDs are in
  `STACK.md` and the env files. Server issues presigned PUT URLs; client
  uploads direct to S3.

## Subsystems (where to grep)

Beyond core poker + bots, the server hosts several self-contained features.
Each lives in its own dir with `<feature>Repository.js` + `<feature>Routes.js`
(or engine) — when a request touches one of these, start there:

- `server/src/dms/` — direct messages (migration 024).
- `server/src/feed/` — social posts/comments (migration 025).
- `server/src/notifications/` — bell + dispatcher (migration 023).
- `server/src/users/followsRepository.js` — follow graph (migration 011).
- `server/src/sidebets/` — in-hand prop bets (oddsCalc, propCatalog, engine).
- `server/src/peerLoans/` — player-to-player loans.
- `server/src/dailies/` + `server/src/achievements/` — daily challenges,
  unlocks, skin progression (migrations 014, 020, 021).
- `server/src/crypto/` — meme-coin sim used in the markets UI.

Client mirrors: `client/app/feed/`, `client/app/users/`, plus components
like `DmsPopup`, `NotificationsBell`, `FeedWindow`, `PostCard`,
`PostComposer`, `SideBetsPanel`, `PeerLoanPanel`.

## Commands

```bash
# server/  (Node 22, no dotenv — uses --env-file-if-exists)
npm run dev                                   # nodemon + .env, listens on :3001
npm start                                     # node + .env
npm run start:prod                            # node + .env.production
npm run migrate                               # apply pending pg migrations (idempotent)
npm test                                      # node --test, runs server/test/*.test.js
node --env-file-if-exists=.env --test test/handEvaluator.test.js   # single file
node --env-file-if-exists=.env --test --test-name-pattern="straight flush"  # single case

# client/  (Next.js 16)
npm run dev                                   # :3000, expects API on :3001
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
  effect (grep for it — the file is ~4000 lines and line numbers drift).
- **Migration ordering**: `server/src/db/migrations/` is numeric and
  idempotent. New migrations get the next free `0NN_*.sql` slot — never
  renumber existing ones; `npm run migrate` tracks applied versions.
- **Bot save / recalc flows** in `poker/bots/[id]/page.jsx` — there's a
  known stale-load race; if you guard one path, guard the other.
- **CORS / env**: `server/.env.production` must not include `localhost`
  in `CORS_ORIGINS`. The deployed frontend's *exact* scheme+host is what
  the server compares against.
- **CloudFront overwrites**: when replacing an object at the same key,
  issue a `create-invalidation` — propagation is 5–10 min and async.

## Setup

For a fresh checkout: `./scripts/setup-env.sh` generates placeholder
`.env*` files for both sides + both environments. Full walk-through is in
`README.md` at the repo root.
