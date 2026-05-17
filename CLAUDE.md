# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start here.** `STACK.md` (in this same directory) has the compact
architecture / stack / AWS context. Read it before doing any non-trivial
work on this repo — it'll save you 3-4 rounds of grep.

## Quick orientation

- Frontend: `client/` — Next.js 16, React 19, Tailwind 4. The two big
  files are `client/app/poker/page.jsx` (~5800 lines: WS, state, game
  render, action bar, panels) and `client/app/poker/bots/[id]/page.jsx`
  (bot editor + recalc flows). Everything else is component-scoped.
  These files grow — treat the line counts here as ballpark, not gospel.
- Backend: `server/` — Node 22 with native `--env-file-if-exists` (no
  dotenv). Express + `ws` share one listener. Postgres via `pg`. The
  fat file on this side is `server/src/rooms/PokerRoom.js` (~2400 lines:
  the game-state machine) and `server/src/network/MessageHandler.js`
  (~1400 lines: WS routing + per-message handlers).
- REST surface is mounted in `server/src/api/index.js` — auth, bots,
  uploads, users (me + public), dailies, notifications, dms, feed.
- Auth: dual-mode — Google Identity Services *and* native email/password
  (migration 022; `server/src/auth/{email,password,verificationRepository}.js`).
  Both paths issue the same JWT in an httpOnly cookie. `useAuth` (client)
  + `apiRouter` middleware (server). See STACK.md.
- Bot sandbox: `client/app/lib/botCodeRunner.js` (browser) and
  `server/src/bots/` (authoritative). Sandbox is not a security boundary —
  it's user-runs-user-code. Four bot kinds coexist: user-scripted JS,
  **neural** (`server/src/bots/neural/` — mlp, qlearning, reinforce,
  reinforce-baseline; weights persisted), **super** (`server/src/bots/super/`
  + migrations 026-027 — rule/transition driven, edited via `SuperBotForm`),
  and **oracle** (migration 028 — equity-driven baseline). Bot kind is
  stored on the row; the table router picks the right runner.
- AWS uploads: private S3 + CloudFront with OAC. Resource IDs are in
  `STACK.md` and the env files. Server issues presigned PUT URLs; client
  uploads direct to S3.

## Money model (read this first if you're touching anything financial)

The player has TWO independent wallets — keeping them straight is what
keeps the P/L badges and rebuy logic honest. Mixing them is the #1
source of bugs in this codebase.

- **`chips`** (`Player.chips`) — poker stack ON the table. Hard-capped
  at `POKER_CONFIG.CHIP_STACK_MAX = 1000`. The auto-sweep in
  `PokerRoom._sweepStackOverflow()` between hands moves any excess into
  the bank. Used by: poker bets, sidebets, item-engine chip transfers
  (hack / scam), peer loan settle-on-leave. `pokerBuyIn` tracks the
  cumulative buy-in for poker P/L = `chips + openSideBetStake - pokerBuyIn`.
- **`bankBalance`** (`Player.bankBalance`) — persistent OFF-table wallet.
  Starts at `POKER_CONFIG.BANK_START_BALANCE = 5000`. Auto-funds the
  next 1000-chip rebuy when the poker stack hits zero. Used by: stocks,
  options, crypto, assets, jobs, world yields, peer-loan principal/repay,
  bank-loan principal/repay. `bankStartBalance` is the snapshot for the
  Bank P/L badge.

Both fields are serialized everywhere — `Player.toJSON()` (used by
`room_update`) AND `PokerGame._buildPlayerSeat()` (used by `game_state`)
both expose `bankBalance` and `bankStartBalance`. If you add a new
broadcast path, expose both.

The popover P/L formula is `seat.profit ?? (seat.chips - (seat.pokerBuyIn
?? seat.buyIn ?? 0))` — never just `chips - pokerBuyIn`, because the
two broadcast shapes (gameState seat vs room_update player) name the
buy-in field differently (`buyIn` vs `pokerBuyIn`).

**Loan eligibility uses BANK balance, not chips.** `PeerLoanPanel`
picks Offer-vs-Request by comparing the viewer's `bankBalance` to the
target's `bankBalance`, with a tie-break on net worth (bank + chips).
The poker stack is volatile within a hand and isn't a sane "have
money to lend" signal — the bank is. If you wire a new loan-ish
surface, follow the same rule.

## Two seat-view shapes (subtle, has bitten us)

The seat object passed to UI components comes from one of two server
builders — same player, slightly different field names:

| Broadcast | Builder | Buy-in field | Has `profit`? |
|---|---|---|---|
| `game_state`   | `PokerGame._buildPlayerSeat` | `buyIn` + `pokerBuyIn` alias | yes (live, mid-hand-aware) |
| `room_update`  | `Player.toJSON`              | `pokerBuyIn`                | no (derive from `chips - pokerBuyIn`) |

When rendering financial UI, prefer the server's `profit` when present
and fall back to `chips - (pokerBuyIn ?? buyIn ?? 0)`. `PlayerProfilePopover`
re-derives its seat from `gameState.players.find(p => p.id === popoverSeatId)`
every render so it picks up fresh bank/chip updates after a money-mutating
action — without that, a job-claim 26k payout never shows up in the
popover until the next poker action.

## Long/short markets

Both `StockEngine` and `CryptoEngine` enforce a **long-XOR-short
invariant** per symbol/coin. Engines expose four actions: `buy`, `sell`,
`short`, `cover`. Trying to open a long while a short is open returns
`{ success: false, error: 'has_short' }` (and vice versa with `has_long`).
The clients (`StocksPanel`, `CryptoMarketPanel/CoinRow`) detect the
existing opposite-side position and pop a `window.confirm` to close-
then-flip in two messages. Shorts settle into the bank wallet just like
longs do. `getStatePayload` / `buildSnapshot` expose `myShorts` alongside
`myPositions`.

## Earnings + IV pump

`server/src/stocks/stockEngine.js` — every hand-end resolves the
previous batch and queues 2–6 new tickers from a no-repeat rotation
(`_refillEarningsRotation` reshuffles when empty). Each event carries
`beatOdds` + `ivUp` + `ivDown` (drawn from per-kind `IV_BANDS` — main /
meme / penny — with a surprise-scaling factor so priced-in events
produce smaller candles). `optionsEngine._volatilityFor` checks the
upcoming-earnings list and applies `EARNINGS_VOL_PUMP = 1.85x` to the
chain — that's the IV pump, with crush happening implicitly when the
slot rolls to the next batch.

## Top-right chrome — two trees, one viewport edge

`AccountDock` is mounted in `client/app/layout.jsx` at body level, OUTSIDE
`ZoomLayer`. `RouteNavCluster` (Tools/Lobby/Home) is mounted by each
route INSIDE `ZoomLayer`. The CSS `zoom` property on ZoomLayer (even at
`100%`) establishes a new containing block for `position: fixed`
descendants in Chromium — so the two trees' `top-3` and `right-*`
values resolve against *different* reference frames and pixel-level
alignment between them can't be trusted.

Layout protocol that keeps the right gutter consistent:

- The signed-out **Sign-in chip** is rendered INSIDE `RouteNavCluster`
  as a flex sibling of Tools/Lobby — same row, guaranteed centerline.
  `AccountDock` suppresses its own chip on RouteNavCluster routes via
  `hideSignedOutChip` (see `routeHasNavCluster` in `AccountDock.jsx`).
- `RouteNavCluster`'s `right` offset is **auth-aware**: signed-out
  drops to the viewport gutter (0.75rem/1rem) because the dock has
  nothing to render in that state on those routes; signed-in reserves
  3.5rem/4rem to clear the avatar. Any other right-side floating
  widget (e.g. the equity HUD in `poker/page.jsx`) must mirror this
  exact split or it'll drift out of alignment on sign-in.
- Avatar / DMs / Notifications / BotSpeed stay in `AccountDock`. The
  dock is only fully hidden when nothing in it would render.

## Bot-speed dock bridge

The bot-speed slider icon is rendered inside the global `AccountDock`
(which lives in `app/layout.jsx`) but its state lives on the poker
page (it talks to the arena WS). The two are wired via a module-level
pub/sub in `client/app/components/AccountDock.jsx` — `setDockBotSpeed`
exported there is called from `client/app/poker/page.jsx`'s effect.
`AccountDock` subscribes via `useSyncExternalStore` AND guards on
`usePathname() === '/poker'` so a stale singleton can never paint the
icon on a non-poker route.

When adding similar dock items (icons that need poker-page state but
must position correctly in the global stack), follow this same
pattern — direct prop-drilling won't work since `AccountDock` is mounted
above the route tree.

## Subsystems (where to grep)

Beyond core poker + bots, the server hosts several self-contained features.
Each lives in its own dir with `<feature>Repository.js` + `<feature>Routes.js`
(or engine) — when a request touches one of these, start there:

- `server/src/dms/` — direct messages (migration 024).
- `server/src/feed/` — social posts/comments (migration 025).
- `server/src/notifications/` — bell + dispatcher (migration 023).
- `server/src/users/followsRepository.js` — follow graph (migration 011).
- `server/src/sidebets/` — in-hand prop bets (oddsCalc, propCatalog, engine).
- `server/src/peerLoans/` — player-to-player loans. Caps interest at
  10%/hand; overdraft is allowed (bank balance can go negative) and the
  client surfaces a "Take a bank loan →" CTA in that state.
- `server/src/dailies/` + `server/src/achievements/` — daily challenges,
  unlocks, skin progression (migrations 014, 020, 021). Trophy ladder
  display now lives in `client/app/lib/trophies.js` (Bronze → Legend at
  1/5/10/15/20/25/30/35/40/50 dailies).
- `server/src/crypto/` — meme-coin sim used in the markets UI. Auto-mints
  1–3 anonymous "scam" coins per hand from `cryptoEngine.onHandEnd` and
  caps the population at `SCAM_COIN_CAP = 18` (oldest retire). Player-
  minted coins are routed through `tickScamCoin` and stripped of owner
  metadata in `getStatePayload` for non-owner viewers so they're
  indistinguishable from auto-mints.
- Hand history: migration 029 (`anonymous_hand_archive`) — separate from
  the per-user hand log; used for training data and anonymous review.

Single-file world engines live next to those: `server/src/{influence,
items,jobs,stocks,world}/` are each one engine module (e.g.
`stocks/` has `stockEngine.js` + `optionsEngine.js`). No `*Routes.js`
of their own — they're wired in by the main API or world loop.

Client mirrors: `client/app/feed/`, `client/app/users/`, plus components
like `DmsPopup`, `NotificationsBell`, `FeedWindow`, `PostCard`,
`PostComposer`, `SideBetsPanel`, `PeerLoanPanel`, `InvestmentHUD`,
`StocksPanel`, `CryptoMarketPanel`, `AssetsPanel`, `WorldPanel`.

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
- **Cursor + 404**: `client/app/globals.css` has a global `:where(...)`
  rule that applies `cursor: pointer` to every conventionally-clickable
  element (`button`, `a[href]`, ARIA roles, clickable inputs). Specificity
  is zero so explicit Tailwind utilities (`cursor-default`, `cursor-grab`,
  etc.) still win. Custom 404 is `client/app/not-found.jsx` — Next.js App
  Router convention; one Home button, robots `noindex`.
- **Memory hygiene**: this repo has a memory dir under `.claude/`. Read
  `MEMORY.md` when relevant; persist non-obvious user preferences or
  cross-session context there.

## When you touch something risky

- **WebSocket lifecycle** in `poker/page.jsx` — there's no reconnect
  today; don't accidentally introduce dep churn on the `new WebSocket(WS_URL)`
  effect (grep for it — the file is ~5800 lines and line numbers drift).
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
- **Money-mutating WS handlers** (`stock:*`, `crypto:*`, `asset:*`,
  `options:*`, `job:claim`, etc.) must call `room.broadcastRoomUpdate()`
  after a successful mutation. The client's `room_update` handler
  applies the bundled `gameState`, which is the only way live bank
  balance updates flow back to the seat-click popover between hands.
  If you skip the broadcast, the player will see stale bank numbers
  until the next poker action.
- **Persistent client state** (localStorage): `poker_blind_level_pref`
  was the source of the "auto-jam on the post" bug — it silently
  re-proposed a saved high-stakes blind level on every join. New
  blinds-related persistence should be opt-in only.
- **Item refresh cadence** lives in `server/src/items/itemEngine.js`
  (`ITEM_COOLDOWN_HANDS` per item; `SCAM_COOLDOWN_*` for the legacy
  randomized scam cooldown). The UI reads the value off the
  `items:state` snapshot (`state.refreshHands`) — don't hard-code
  the cadence client-side or the "Recharges every N hands" label
  in `ItemsPanel` will drift out of sync.
- **Blinds proposal payload** carries per-voter arrays
  (`approvedBy: [...ids]`, `rejectedBy: [...ids]`) in addition to the
  counts. The proposer's own view of the banner relies on these to
  list who's still pending. New consumers should read them; new
  server-side proposal events should keep emitting them.

## Setup

For a fresh checkout: `./scripts/setup-env.sh` generates placeholder
`.env*` files for both sides + both environments. Full walk-through is in
`README.md` at the repo root.
