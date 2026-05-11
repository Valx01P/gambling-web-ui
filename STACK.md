# pokerxyz — stack & architecture (compact)

Multiplayer Texas hold'em with user-scripted JS bots, ELO, clones, and a
spectator-friendly bot arena. **Frontend**: Next.js 16 + React 19 + Tailwind 4.
**Backend**: Node 22 + Express 4 + `ws` + Postgres. **Object storage**: private
S3 bucket fronted by CloudFront (OAC).

## Layout

```
client/                 # Next.js app router; "use client" everywhere
  app/
    poker/page.jsx          # ~2800-line table screen (state, WS, rendering)
    poker/components/       # LobbyView only
    poker/bots/             # bot list + per-bot editor
    poker/lib/seatLayout.js # seat geometry (5 seats on an ellipse)
    components/             # SpectatorPanel, StatsPanel, AccountMenu,
                            # AuthGateModal, ConfirmModal, ConfirmPopover,
                            # ChipStack, CardSprite, ZoomLayer, Achievement-
                            # Toast, PokerEmotes, ProfileSelector, BotAvatar,
                            # Simulator, JsCodeEditor, HomeBackLink, …
    lib/                    # pokerOdds, banks, botColors, ctxDocs,
                            # starterBotCode, botCodeRunner, useAuth, api,
                            # initials, profileAvatars
    globals.css             # Tailwind + a few custom keyframes/utilities
server/
  server.js               # express bootstrap, CORS, /health
  src/
    network/WebSocketServer.js  # WS hub
    api/                        # REST endpoints (auth, bots)
    poker/                      # game engine
    bots/                       # sandbox + ELO + clone generator
    db/                         # pg pool + migrations
scripts/
  setup-env.sh            # generates placeholder .env files
```

## Runtime

- Frontend: `next dev` on :3000, hits backend at `NEXT_PUBLIC_API_URL` (HTTP)
  and `NEXT_PUBLIC_WS_URL` (WebSocket).
- Backend: Node 22 with `--env-file-if-exists` (no dotenv). Single process,
  HTTP + WS share the listener. Postgres via `pg` pool.
- Migrations: `npm run migrate` in `server/`, idempotent.

## Env loading

| File | Loaded by | When |
|---|---|---|
| `client/.env.local`       | Next.js auto | `npm run dev` |
| `client/.env.production`  | Next.js auto | `next build` with `NODE_ENV=production`; also a paste-ref for Vercel |
| `server/.env`             | `node --env-file-if-exists` | `npm start` / `npm run dev` / `npm test` |
| `server/.env.production`  | `node --env-file-if-exists` | `npm run start:prod` (sets `NODE_ENV=production`); paste-ref for Render |

Every file is `chmod 600` and gitignored (root + per-side). New checkouts run
`./scripts/setup-env.sh` to get placeholders.

## Auth

Google Identity Services (One Tap + button) → server verifies ID token →
issues a JWT signed with `JWT_SECRET`, stored as an httpOnly cookie. JWT
lifetime = `JWT_TTL_SECONDS` (30 d). `useAuth` hook + `AccountMenu` on the
client; `apiRouter` validates on the server.

## Bots

User writes JS in `JsCodeEditor`. Code runs in `lib/botCodeRunner.js` —
`new Function('ctx', code)`; *not* a security boundary (it's the user's own
code). Server has its own sandbox in `server/src/bots/`. `ctx` shape is
documented in `lib/ctxDocs.js`. The "Simulator" component runs the bot
against fabricated `ctx` snapshots for testing.

Clones: tier-locked bot generated from a user's last N hands (`recalculate`
re-derives code, color, ELO). Permanent — can't be deleted, only recalc'd.

## AWS upload pipeline

Resources (all in `us-west-1`):

- **S3 bucket** `pokerxyz-uploads-93529b33` — Block Public Access on, SSE-S3,
  versioning on, lifecycle expires `tmp/` after 1 day and noncurrent versions
  after 30 days, CORS allows browser PUT from `localhost:3000`,
  `https://pokerxyz.io`, and `https://www.pokerxyz.io` only.
- **OAC** `E3R7JJUE8VEONR` — signs CloudFront → S3 with SigV4.
- **CloudFront distribution** `E2DSAS0AV1H77I` → `d1ja8qmo6dfwhw.cloudfront.net`.
  HTTPS-only, HTTP/2+3, brotli+gzip, AWS-managed `CachingOptimized` cache
  policy + `CORS-with-preflight` response-headers policy, PriceClass_100.
- **Bucket policy** allows `s3:GetObject` ONLY when `AWS:SourceArn` =
  the distribution ARN. Public endpoint stays blocked.
- **IAM user** `pokerxyz-uploader` — inline policy scoped to
  PutObject/GetObject/DeleteObject/AbortMultipartUpload on that one bucket,
  plus ListBucket. Keys live in `server/.env.*` only; the account root is
  never used for app credentials.

**Flow** (to implement when needed):

1. Client: `POST /api/uploads/presign` with `{ kind, contentType, size }`.
2. Server validates auth + content-type allow-list + `size <= UPLOAD_MAX_BYTES`,
   returns a presigned PUT URL (60 s expiry, `Content-Length-Range` condition)
   and the eventual public URL `${S3_PUBLIC_BASE_URL}/${objectKey}`.
3. Client uploads directly to S3 via that URL (no bytes through the app
   server).
4. Overwrites/deletes call CloudFront `create-invalidation` to evict cached
   copies.

Re-provisioning steps are in `README.md` under "AWS setup" — copy-paste-able.

## Deployment

- Frontend → Vercel @ **`https://pokerxyz.io`** (Root Directory = `client/`,
  env vars from `client/.env.production`). The `pokerxyz.vercel.app` URL
  still resolves but should not be used as the canonical origin.
- Backend → Render (Web Service @ `gambling-web-ui.onrender.com`, env vars
  from `server/.env.production`). If/when this moves to `api.pokerxyz.io`,
  both `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_API_URL` change together.
- Postgres → Railway.
- Uploads → AWS S3 + CloudFront.

Vercel/Render inject env vars directly into `process.env`, so `.env.production`
files are a paste-reference, not the source of truth in deployed envs.

## Testing

```
cd server && npm test    # node --test, no jest
```

Test files under `server/test/*.test.js`. Pure-function units (handEvaluator,
equity, pokerOdds, eloEngine) + integration (`poker-room.test.js`,
`botRoomIntegration.test.js`). Frontend has no test runner today.

## Common gotchas

- **CORS in prod**: `CORS_ORIGINS` on the server must include the exact
  scheme+host of the frontend. Missing entry → every `/api` call 403s.
- **`wss://` in prod**: HTTPS frontend can't open `ws://` — must be `wss://`.
- **Render free tier idle**: backend cold-starts, WS reconnects can take
  20–30 s; client doesn't reconnect on its own today (see review).
- **iOS Safari input zoom**: any input below 16px font triggers viewport
  zoom. `globals.css` has a `@media (max-width: 640px)` floor to prevent it.
- **CloudFront propagation**: distribution updates take 5–10 min to roll out
  globally. Cache invalidations also async.
- **Root AWS account in this project's CLI config**: the dev's `aws sts
  get-caller-identity` returns root. App keys are scoped (good); operator
  keys are not (bad — recommend rotating to a personal IAM user).
