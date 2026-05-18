# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Start here.** `STACK.md` (in this same directory) has the compact
architecture / stack / AWS context. Read it before doing any non-trivial
work on this repo — it'll save you 3-4 rounds of grep.

## Quick orientation

- Frontend: `client/` — Next.js 16, React 19, Tailwind 4. The two big
  files are `client/app/poker/page.jsx` (~6500 lines: WS, state, game
  render, action bar, panels) and `client/app/poker/bots/[id]/page.jsx`
  (bot editor + recalc flows). Everything else is component-scoped.
  These files grow — treat the line counts here as ballpark, not gospel.
- Backend: `server/` — Node 22 with native `--env-file-if-exists` (no
  dotenv). Express + `ws` share one listener. Postgres via `pg`. The
  fat file on this side is `server/src/rooms/PokerRoom.js` (~2450 lines:
  the game-state machine) and `server/src/network/MessageHandler.js`
  (~1800 lines: WS routing + per-message handlers).
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

- **`chips`** (`Player.chips`) — poker stack ON the table.
  `POKER_CONFIG.CHIP_STACK_MAX = 1000` is the INITIAL buy-in / rebuy
  size only; it's no longer a runtime cap. `_sweepStackOverflow` in
  PokerRoom is a no-op kept for callsite parity — winners now keep
  excess at the table. Used by: poker bets, item-engine chip transfers
  (hack / scam), peer loan settle-on-leave. `pokerBuyIn` tracks the
  cumulative buy-in for poker P/L = `chips - pokerBuyIn`. (The legacy
  `+ openSideBetStake` correction is gone — side bets debit BANK now,
  not chips, see below.)
- **`bankBalance`** (`Player.bankBalance`) — persistent OFF-table wallet.
  Starts at `POKER_CONFIG.BANK_START_BALANCE = 5000`. Auto-funds the
  next 1000-chip rebuy when the poker stack hits zero. Used by: stocks,
  options, crypto, assets, jobs, world yields, peer-loan principal/repay,
  bank-loan principal/repay, **side bets** (the 1000-chip stack was too
  small for prop sizing), and the **pin_hack** item's drain. `openSideBetStake`
  still tracks principal locked in open props — it represents bank money
  out, not chips parked. `bankStartBalance` is the snapshot for the
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

## Windowing system

Five overlapping surfaces compete for screen space on `/poker`: floating
windows, the dock column (HUD / side-bets / chat anchored slots), the
docked Tools menu, the freeform Tools menu, and elevated tool panels.
They share **one z-band layout and one click-to-front counter** —
getting this hierarchy wrong is the #1 source of "why is X behind Y?"
bugs in the UI.

### z-band layout

| Surface                             | Default z      | Source                                                  |
|-------------------------------------|----------------|---------------------------------------------------------|
| Dock column (HUD/side-bets/chat)    | 30             | `dockColumnZ` state in `poker/page.jsx`                 |
| Floating windows (mount + raise)    | 901+           | `FloatingWindow.jsx` via `nextRaisedZ()`                |
| Docked Tools menu (anchored)        | 800 → 901+     | `toolsMenuZ`; bumps to `bumpRaisedZ()` on open          |
| Freeform Tools menu                 | 901+           | Itself a `FloatingWindow`                               |
| Elevated panels (`ELEVATED_PANEL_IDS`) | `z-[10000]` | Inline class on the `activePokerPanel` div              |

`FloatingWindow.jsx` exposes a single counter via `bumpRaisedZ()` (and
`nextRaisedZ()` internally). Every floating window, the docked Tools
menu, and the dock column share it — whichever surface most recently
received a `pointerdown` ends up on top. The counter is
session-monotonic; closing a surface releases nothing.

`BASE_Z = 260` exists for historical reasons but is no longer used —
new mounts seed in the raise band too, so a freshly-opened window
lands above every previously-opened one without needing a click.

### Click-to-front contracts

- **Floating windows**: `pointerdown` anywhere inside raises via
  `raise() → nextRaisedZ()`. New mounts also seed from the same
  counter. The `useLayoutEffect` on `[open]` re-seeds z AND re-cascades
  pos on every `open → true` transition — necessary because
  persistently-mounted windows (`PokerWindow`, `FeedWindow`) keep
  their state across close/open toggles and otherwise inherit a stale
  z and pos.
- **Docked Tools menu**: `pointerdown` on its outer portal div bumps
  `toolsMenuZ` via `bumpRaisedZ()`. A `useLayoutEffect` watching
  `[tableMenuOpen, toolsFreeform, activePokerPanel, pokerWindowOpen,
  feedWindowOpen, widgetPanels]` re-bumps after any panel-state change
  — so opening a tool from the menu reliably stacks as: old windows <
  new tool < docked menu. Closing the menu resets `toolsMenuZ` to 800.
- **Dock column** (`InvestmentHUD` / side-bets / chat anchored slots):
  each of the three wrappers has `onPointerDown={activateDockColumn}`;
  the column wrapper carries inline `style={{ zIndex: dockColumnZ }}`
  and `position: relative` so the z applies on both mobile and md+.
- **Elevated panels** (`ELEVATED_PANEL_IDS` — Actions / Profile / Basic
  Info / Guide / Daily Challenge / Bank): static `z-[10000]`. They're
  spec'd to always sit above menu/windows; the ~9100 headroom over the
  click-raise band is intentional — the counter would need thousands
  of bumps in one session to reach it. Non-elevated panels stay at
  `z-[600]` (below the menu and windows by design).

### Cascade for fresh windows

`pickCascadedPos(defaultPos, w, h)` in `FloatingWindow.jsx` walks
`_registry` of currently-open windows and offsets the proposed pos by
`TITLE_H` (32px) for each collision — so spam-opening windows from the
menu leaves every title bar visible in a stair-step the user can drag
apart. Wraps to the top of the cascade band if it'd run off-screen.
Two entry points:

1. The pos `useState` initializer (first mount, no remembered layout).
2. The `useLayoutEffect` on `[open]` — feeds the *current* pos through
   `pickCascadedPos`. If nothing else is at that spot it returns
   unchanged (preserves the user's last drag); otherwise cascades.
   Critical for `PokerWindow` / `FeedWindow` since their pos
   initializer only fires on first mount.

Registry entries carry a live `pos` field via `updateWindowPos`,
updated on every drag / resize / clamp — so cascading always sees the
user's current positions, not stale ones.

### PiP windows

Three draggable, resizable, portal-rendered windows share the same
chrome and constraints:

- `client/app/components/FeedWindow.jsx` — social feed.
- `client/app/poker/components/PokerWindow.jsx` — PiP mini-table; reads
  the same `gameState` the main view does and routes actions through
  the same `send('poker_*')` callbacks, so a click in either surface
  moves the real game. Top-level derivations (`canAct`, `hasRaiseRoom`,
  `safeRaise`, `inHand`) are lifted out of the action-panel IIFE
  precisely so this window can share them.
- (The DmsPopup is similar but older.)

Position + size persist per-window in `_sessionLayouts` (module-level
Map keyed by `storageKey`) — survives close/reopen within a session
but doesn't follow you to another device. Re-clamp on viewport resize
keeps the window grabbable when the browser shrinks.

### Anchored vs freeform Tools menu

The Tools menu has two modes, toggled via the `↗ Pop out` / `↺ Anchor`
button in its header (`toolsFreeform` state, persisted in
`pokerxyz:tools:freeform`):

- **Anchored** (default): portaled to body, pinned just below the
  Tools button via `toolsMenuAnchorRect`. Has the manual × close
  button on the right of its header (matches the FloatingWindow
  title-bar × styling).
- **Freeform**: itself a `FloatingWindow`. Rides the standard
  click-raise rules — the docked-menu z-bumping logic is gated on
  `!toolsFreeform`.

### Tools menu — companion-surface exemptions

`poker/page.jsx` has a pointerdown handler that auto-closes the Tools
menu on any click outside its `tableMenuRef`. These surfaces are
exempted so a click inside them keeps the dropdown open:

- `chatDockRef` — chat-dock container.
- `sideBetsDockRef` — side-bets dock container.
- `hudDockRef` — InvestmentHUD anchored slot.
- `pokerPanelRef` — active tool panel (Bank / Bots / Blinds / etc.).
- `[data-tools-menu="1"]` — the portaled docked menu itself.
- `[data-pokerwin="1"]` — `PokerWindow`'s outer node (it portals to
  body, isn't inside any React ref hierarchy).

Any new companion surface (a future right-rail panel, etc.) that the
user expects to interact with WHILE the menu is open should either get
a ref+contains check or set its own `data-*` opt-in attribute and add
it to that handler.

## Private-room tool toggles

A host creating a private room can disable a subset of tools for
everyone in that room. Canonical list lives in two synced places:

- `client/app/lib/privateRoomTools.js` — `TOGGLEABLE_TOOLS` (full
  catalog with labels) and `TOGGLEABLE_TOOL_IDS` (validation set).
- `server/src/rooms/PokerRoom.js` — `TOGGLEABLE_TOOL_IDS` mirror.
  Constructor stores `this.disabledTools` (Set) for private rooms;
  `isToolDisabled(toolId)` returns false for general rooms (always
  the "wild west").

Enforcement is a single guard at the top of `MessageHandler.handle()`:
the `TOOL_FOR_TYPE` map maps each gated message type (`crypto:*`,
`stock:*`, `item:use`, etc.) to a tool id. The handler short-circuits
with a friendly error before any per-message handler runs.

On the client, `roomDisabledTools` state (populated from `room.disabledTools`
in `join_game` / `reconnect_ok` / `room_update`) gates BOTH the Tools-
menu buttons AND the actual UI for that tool (e.g. the chat dock and
side-bets dock render gates also check this set). Section headers in
the Tools menu are conditional on at least one of their children still
being visible — so disabling every Markets entry hides the "Markets"
header too.

## Site-wide felt color

`client/app/lib/feltColor.js` is the source of truth for the felt
palette + the user's current pick. Module-level pub/sub + a
`useFeltColor()` hook backed by `useSyncExternalStore`. The store is
hydrated by `FeltBootstrap` (mounted once in the root layout) from
localStorage on first paint, then from `/auth/me` when auth resolves
(DB column `felt_color_id` + `felt_custom_colors` — migration 031).
`FuzzyBackground` subscribes to the same store so the noise tint
follows the user across every route, not just `/poker`. Setters
debounce a `POST /api/auth/me/felt` for signed-in users.

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
- `server/src/casino/` — slots / craps / lottery on a stateless engine.
  Stands apart from the other market engines: no per-player position
  state, no hand-end hook. Every action settles immediately against
  the bank and replies with a per-player `casino:slots:result` /
  `casino:craps:result` / `casino:lottery:result` message; the panel
  reads those to drive its animations. See "Casino engine specifics"
  below.

Single-file world engines live next to those: `server/src/{influence,
items,jobs,stocks,world}/` are each one engine module (e.g.
`stocks/` has `stockEngine.js` + `optionsEngine.js`). No `*Routes.js`
of their own — they're wired in by the main API or world loop.

### Items engine specifics (`server/src/items/itemEngine.js`)

Three "shapes" of items share one engine + one cooldown map
(`ITEM_COOLDOWN_HANDS`):

1. **Chip/bank movers** — `hack` (immediate chip transfer), `scam`
   (two-step popup), `pin_hack` (two-phase PIN minigame, drains bank).
   Both `scam` and `pin_hack` use a server-side timer to auto-resolve
   on AFK (30s for scam, 12s for pin_hack: 2s memorize + 10s input).
   The pending state lives in `pendingScams` / `pendingPinHacks` Maps.
2. **Deck riggers** — `peek`, `swap`, `river_card`, `next_card`,
   `rig_hand`. These call into `PokerGame.set*` methods that stage
   the rig. Note: `setRiggedHand` has an `already_rigged` guard so a
   second `rig_hand` on the same hand rejects; `setRiggedRiverCard` /
   `setRiggedNextCard` do NOT — they overwrite. Two players using
   different deck-rig powers on the same hand can both apply.
3. **Market griefers** — `crash_coin` (95% tank on any market coin)
   and `crash_holdings` (95% wipe of a target's open crypto + stock
   SHARES — chart prices untouched). Each routes through the
   respective engine's `crashCoin` / `crashHoldingsFor` method.

The client renders multiple scam popups concurrently at different
screen corners (`scamPopups` array in `poker/page.jsx`); the first
keeps the centered backdrop, popups 2-5 peel to corners. The pin_hack
popup is always centered (only one in flight per target at a time).

### Gambler bot strategies (`server/src/bots/gambler/strategies.js`)

Five auto-provisioned bots (Splashy / Chaser / Maniac / Sticky / Hunter)
seeded for every new user. They're user-scripted JS bots like any other —
the script source lives here.

Each strategy is a `_decide(ctx)` function with a thin `decide(ctx)`
wrapper that post-processes the result. The wrapper checks
`streetBetLevel(ctx)` (in `SHARED_HELPERS`) — preflop counts the BB as
the opening "bet" so `level === 4` means the street has seen a 4-bet
already. If `_decide` returns `{ action: 'raise', ... }` at that level,
the wrapper swaps it to `{ action: 'all_in' }`. Rule: once the action
is past the 4-bet, the next raise is a shove, never another small
re-raise that drags the table into 5-bet / 6-bet territory.

Future edits to these five bots must preserve the wrapper OR move the
rule into each `_decide` body — otherwise the bots regress to
mini-raising each other indefinitely.

### Casino engine specifics (`server/src/casino/casinoEngine.js`)

Three mini-games on one engine. Different shape from every other
market in this repo:

- **Stateless on the server.** No per-player holdings, no hand-end
  tick. The engine's only persistent surface is `casinoEngine.buildSnapshot()`
  which returns a config payload (symbol weights, payout multipliers,
  craps bet ids, lottery prize tiers). Sent once on join + reconnect
  via `casino:state`. The client mirrors this — it doesn't keep a
  `casinoState` ledger between sessions, just the most recent
  `casinoLastSpin` / `casinoLastRoll` / `casinoLastBuy` from the WS
  reply.
- **Per-player result dispatch.** Unlike asset/stock/crypto trades
  which broadcast room-wide state, casino sends `casino:slots:result`,
  `casino:craps:result`, `casino:lottery:result` ONLY to the acting
  player. Other seats don't care what reels you spun. The handler
  still calls `broadcastRoomUpdate()` so the new bank balance shows
  up in the seat popovers — but the spin's outcome detail (which
  symbols, which dice, which prize tiers) is private.
- **Bank-balance-only.** Every wager debits / credits `player.bankBalance`,
  never `player.chips`. The slot reels are not poker chips on the
  table — they're off-table gambling against the house. If you add a
  new game, follow the same rule (and the same MAX_*_BET caps to
  keep variance bounded against the trillion-scale economy).
- **House edges** (verified empirically over 2M+ trials):
  - Slots: ~96% RTP. 3-of-a-kind from cherry (3×) up to seven (4000×),
    plus a 0.5× two-cherry consolation. Virtual 64-stop reels weighted
    so the seven jackpot is 2 stops out of 64.
  - Craps: real Vegas one-roll edges. 6/8 are the player-friendly bets
    (~2.8%), corner bets (2/12, 3/11, 4/10) are 11-17%, 7 is 16.7%, the
    hard 6/8 hop bets are 72% (authentic Vegas hard-way trap — don't
    "fix" them).
  - Lottery: ~22% RTP. 12 prize tiers, $5 → $10B jackpot at 1-in-10¹⁵.
    Per-ticket sequential roll on the server (Math.random + a 12-entry
    cumulative-probability scan) — 1M tickets per click runs in a
    couple of frames.

### Casino slot animation lifecycle (`client/app/poker/components/CasinoPanel.jsx`)

The slot reels have a load-bearing rule: **only real new spins animate.**
Tab switches, panel reopens, and idle remounts must NOT replay the spin.
This required some care:

- `spinId` is owned by `CasinoPanel` (not `SlotsTab`) so it survives
  the SlotsTab unmount/remount when the user toggles to Craps/Lottery.
- `seenSpin` ref initializes to the CURRENT `lastSpin` at mount, not
  null. That way reopening the casino with a prior result in scope
  doesn't bump `spinId` and trigger a phantom animation — only a new
  ref (a fresh server reply) bumps it.
- Each `Reel` has its own `animatedRef = useRef(spinId)`. The effect
  watching `[spinId]` bails when `spinId === animatedRef.current` — so
  a fresh Reel mount with an unchanged spinId skips the animation.
- The Reel's drum uses a **single CSS transition with cubic-bezier
  ease-out**, not an infinite-loop animation + snap-to-result. The
  strip is rebuilt per spinId with the final three cells = (filler,
  result, filler); `translateY(0) → translateY(finalOffset)` over the
  duration with `requestAnimationFrame` x2 between the snap and the
  spin to force a paint between the two transform writes (otherwise
  the browser collapses them into a teleport).
- Win highlight (`isWinning`) lives on the **payline div** (z-10),
  NOT the whole reel viewport. The symbol strip is z-20, vignettes
  z-30. Result: the amber glow shines through the SVG's transparent
  gutters around the fruit but doesn't tint the fruit pixels themselves
  — the user explicitly called this out as wanted behavior.

The same `lastSpin`-ref-on-mount pattern applies to craps + lottery
P/L tallies (`seenRoll`, `seenBuy`) so reopens don't double-count.

### Jobs board success rates

`server/src/jobs/jobsEngine.js` — success rates are computed at
board-roll time from the rolled reward via `successForReward(reward,
baseSuccess)`. The function is the source of truth for "this big a
payout has these odds"; the tier-default `TIER_SUCCESS` map is now
just the floor before the reward-keyed cap is applied (Math.min).
Buckets currently: ≤$10K → 70%, climbing down through $100K → 10%,
$1M → 1%, ≥$10M → 0.1%. Edit one map to change them all.

Client mirrors: `client/app/feed/`, `client/app/users/`, plus components
like `DmsPopup`, `NotificationsBell`, `FeedWindow`, `PostCard`,
`PostComposer`, `SideBetsPanel`, `PeerLoanPanel`, `InvestmentHUD`,
`StocksPanel`, `CryptoMarketPanel`, `AssetsPanel`, `WorldPanel`,
`CasinoPanel`.

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
  effect (grep for it — the file is ~6500 lines and line numbers drift).
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
  `options:*`, `job:claim`, `casino:*`, etc.) must call
  `room.broadcastRoomUpdate()` after a successful mutation. The
  client's `room_update` handler applies the bundled `gameState`,
  which is the only way live bank balance updates flow back to the
  seat-click popover between hands. If you skip the broadcast, the
  player will see stale bank numbers until the next poker action.
- **Persistent client state** (localStorage): `poker_blind_level_pref`
  was the source of the "auto-jam on the post" bug — it silently
  re-proposed a saved high-stakes blind level on every join. New
  blinds-related persistence should be opt-in only.
- **Item refresh cadence** lives in `server/src/items/itemEngine.js`
  (`ITEM_COOLDOWN_HANDS` per item; `SCAM_COOLDOWN_*` for the legacy
  randomized scam cooldown — currently fixed at 2/2). The UI reads
  the value off the `items:state` snapshot (`state.refreshHands`) —
  don't hard-code the cadence client-side or the "Recharges every N
  hands" label in `ItemsPanel` will drift out of sync. The exception
  is the `ItemsPanel.jsx` description string, which spells out the
  cooldown in user-facing copy — update it when you change the map.
- **Branding**: the app is **PokerXYZ** (capitalized in user-visible
  copy + SEO metadata) but internal event names + localStorage keys
  use the legacy lowercase `pokerxyz` / `pokerxyz:*` prefix. Don't
  rename those — there's no migration path for keys already in users'
  localStorage. New visible copy should say "PokerXYZ".
- **Blinds proposal payload** carries per-voter arrays
  (`approvedBy: [...ids]`, `rejectedBy: [...ids]`) in addition to the
  counts. The proposer's own view of the banner relies on these to
  list who's still pending. New consumers should read them; new
  server-side proposal events should keep emitting them.

## Setup

For a fresh checkout: `./scripts/setup-env.sh` generates placeholder
`.env*` files for both sides + both environments. Full walk-through is in
`README.md` at the repo root.
