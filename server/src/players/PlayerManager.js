import {
  BANKS,
  CREDIT_SCORE_DEFAULT,
  CREDIT_SCORE_MAX,
  CREDIT_SCORE_MIN,
  LOAN_AMOUNT,
  LOAN_INTEREST_HAND_INTERVAL,
  POKER_CONFIG,
  PROFILE_AVATARS,
  effectiveLoanRate,
  maxLoansForSwing
} from '../config/constants.js'

export class Player {
  constructor(id, ws, username = null) {
    this.id = id
    this.ws = ws
    // Issued on first connect and echoed back on every RECONNECT. The
    // client persists it in localStorage; when a fresh WS opens after a
    // reload/crash/temporary network drop, sending RECONNECT { sessionToken }
    // re-attaches the new socket to this Player object — same playerId,
    // same seat, same chips, same hole cards. Token rotates after each
    // successful reconnect to limit replay if the storage is ever leaked.
    this.sessionToken = null
    // True iff this player is currently in the grace window (WS closed but
    // we're holding their seat for `_graceExpiresAt`). MessageHandler skips
    // them for new actions; PokerRoom auto-checks/folds in their turn.
    this.disconnectedAt = null
    this.graceExpiresAt = null
    this.username = username || `Player_${id.substring(0, 6)}`
    this.chips = POKER_CONFIG.STARTING_CHIPS
    this.pokerBuyIn = POKER_CONFIG.STARTING_CHIPS
    // Off-table reserves. Chips the player has set aside — not at risk
    // in the current hand. The budget mechanic (see pokerBudget below)
    // moves chips between `this.chips` (live on the table) and
    // `this.pokerReserves` (off-table) so a billionaire can play a
    // small game with a small visible stack while keeping the rest
    // safe. Reserves auto-fund the rebuy when the player busts.
    this.pokerReserves = 0
    // Optional per-session "play with this much" cap. When set, the
    // player's chips at the table are clamped to this value; any
    // excess goes into pokerReserves. Auto-rebuy on bust pulls from
    // pokerReserves up to this value (and falls back to a minimum
    // grant if the reserves are dry, so a totally broke player can
    // keep playing). Null = no cap, behave like before — chips at
    // the table ARE the whole wallet, no separation.
    this.pokerBudget = null
    // No avatar by default — table rendering falls back to an initials
    // circle keyed off `username` (see ProfileAvatar on the client).
    // Picking a preset or uploading a custom image overrides this.
    this.avatarId = null
    this.avatarUrl = null
    this.currentRoom = null
    this.isSpectator = false
    this.isVoluntarySpectator = false
    this.isConnected = true
    this.lastActiveTime = Date.now()
    // Filled by AUTH_HELLO when a signed-in user opens this WS — gates
    // arena creation, bot creation, etc. Anonymous players never set it.
    this.userId = null
    this.userEmail = null
    // Cached profile snapshot from the users table, populated during
    // auth_hello. Used at join_game time when the client signals
    // playAsSelf — server reads from here instead of trusting whatever
    // username/avatar the client tried to send.
    this.userDisplayName = null
    this.userAvatarUrl = null
    // True iff this seat is being played as the signed-in account. Set
    // by handleJoin when the lobby's "Play as YOU" toggle was on AND a
    // userId is attached. Recording of hands, ELO updates, and broadcast
    // of `publicUserId` all gate on this. Joining with an alias keeps
    // the seat anonymous even when the WS is authenticated.
    this.playingAsSelf = false
    // Rated player flag — signed-in users participate in the same ELO
    // pool as bots. Loaded during auth_hello from the users table.
    // Anonymous seats stay at the default (500) but their results aren't
    // persisted, so this is purely an in-memory baseline.
    this.elo = 500
    // Lifetime hands the *user* has played (across all tables/sessions).
    // Used to size the K-factor for ELO updates — provisional ratings
    // move fast, settled ratings slowly. Loaded during auth_hello, kept
    // in sync by PokerRoom._recordHumanHandResults.
    this.userHandsPlayed = 0

    // Loan accounts. Each entry: { bankId, bankName, principal, interestRate,
    // owed, takenAtHand, lastInterestAtHand }
    this.loans = []
    this.loanedTotal = 0
    // Sticky high-water mark of |P/L| swings — used for bank unlock tiers.
    this.peakSwing = 0
    // Per-table session counter ticked once per hand the player observes.
    this.handsAtSession = 0
    // Bigyahu unlocks ✡️ and 🇮🇱 in the player's emote palette.
    this.bigYahuCalls = 0

    // Lifetime banking stats — accumulate across the session, not reset by
    // Big Yahu. Reset Money clears them.
    this.lifetimeBorrowed = 0
    this.lifetimeInterestPaid = 0
    this._creditScoreMin = null
    this._creditScoreMax = null

    // Chips currently parked in open side-bet positions. Mutated by the
    // SideBetEngine on placeBet / sellPosition / resolution. Added back
    // into the P/L formula so an unresolved bet doesn't show as a loss —
    // mark-to-market is hidden from the player until the position closes.
    this.openSideBetStake = 0

    // Per-session daily state. For signed-in users these mirror the DB
    // columns (loaded at auth_hello, written back on completion). For
    // anonymous users this is purely session-scoped — they still see the
    // daily and earn +1000 in-game chips for completing it, but it doesn't
    // persist after disconnect.
    this.dailyDateKey   = null   // UTC YYYY-MM-DD the progress applies to
    this.dailyProgress  = 0
    this.dailyCompleted = false  // true once they hit today's target
    this.dailiesCompleted = 0    // lifetime — only meaningful for signed-in
    this.achievements   = []     // array of achievement ids
    this.skinId         = 0      // 0 = default; 1-9 = presets; 10 = custom
    this.customSkin     = null   // {colors, direction} when skinId === 10

    // Peer-to-peer loans this player is party to AT THIS TABLE. Cleared on
    // table leave (the engine settles each one with the counterparty first
    // — see peerLoanEngine.handlePlayerLeave). Shape per entry:
    //   { id, lenderId, borrowerId, lenderName, borrowerName,
    //     principal, rate, owed, takenAtHand }
    this.peerLoans = []
  }

  // --- Derived stats -------------------------------------------------------

  // Realized P/L only. `openSideBetStake` holds chips parked in unresolved
  // side-bet positions; treating them as "still in the bankroll" until the
  // bet settles keeps the displayed profit, peak-swing, and credit score
  // from yo-yoing whenever the player buys or sells a market mid-hand.
  getProfit() { return this.chips + (this.openSideBetStake || 0) - this.pokerBuyIn }

  // Apply a new poker budget. Moves chips between `chips` (on the
  // table) and `pokerReserves` (off-table) so the table stack matches
  // the requested ceiling. The split is conserved — chips that come
  // off the table go straight into reserves, and chips that go onto
  // the table come straight out of reserves. No chips are created or
  // destroyed by this call.
  //
  // amount === null  → clear cap entirely. Pulls every chip out of
  //                    reserves and puts them back at the table.
  // amount  >= 0     → set cap. Shelve excess to reserves OR top up
  //                    from reserves to reach (partial top-up if the
  //                    reserves can't cover).
  //
  // Returns the resolved budget (or null) and the deltas applied,
  // so the caller can broadcast or send an ack.
  setPokerBudget(amount) {
    if (amount === null || amount === undefined || amount === '') {
      // Cap cleared — reserves fold back into the table stack.
      const recovered = this.pokerReserves || 0
      this.chips = (this.chips || 0) + recovered
      this.pokerReserves = 0
      this.pokerBudget = null
      return { budget: null, chipsDelta: recovered, reservesDelta: -recovered }
    }
    const target = Math.max(0, Math.floor(Number(amount) || 0))
    const currentChips = Math.max(0, Math.floor(this.chips || 0))
    let chipsDelta = 0
    let reservesDelta = 0
    if (currentChips > target) {
      // Shelve the excess.
      const shelve = currentChips - target
      this.chips = target
      this.pokerReserves = (this.pokerReserves || 0) + shelve
      chipsDelta = -shelve
      reservesDelta = shelve
    } else if (currentChips < target) {
      // Top up from reserves — partial top-up if reserves are thin.
      const need = target - currentChips
      const pull = Math.min(this.pokerReserves || 0, need)
      this.chips = currentChips + pull
      this.pokerReserves = (this.pokerReserves || 0) - pull
      chipsDelta = pull
      reservesDelta = -pull
    }
    this.pokerBudget = target > 0 ? target : null
    return { budget: this.pokerBudget, chipsDelta, reservesDelta }
  }

  getCreditScore() {
    const profit = this.getProfit()
    const debtOwed = this.loans.reduce((sum, l) => sum + l.owed, 0)
    let score = CREDIT_SCORE_DEFAULT
    score += Math.floor(profit / 100)
    score -= Math.floor(debtOwed / 100)
    score -= this.loans.length * 15
    score -= Math.floor(this.peakSwing / 1000)
    if (score < CREDIT_SCORE_MIN) score = CREDIT_SCORE_MIN
    if (score > CREDIT_SCORE_MAX) score = CREDIT_SCORE_MAX
    // Side-effect: track session min/max as the score is computed. Cheap and
    // gives the bank stats panel something interesting to show.
    if (this._creditScoreMin === null || score < this._creditScoreMin) this._creditScoreMin = score
    if (this._creditScoreMax === null || score > this._creditScoreMax) this._creditScoreMax = score
    return score
  }

  getMaxLoans() {
    this._refreshPeakSwing()
    return maxLoansForSwing(this.peakSwing)
  }

  _refreshPeakSwing() {
    const swing = Math.abs(this.getProfit())
    if (swing > this.peakSwing) this.peakSwing = swing
  }

  effectiveRateFor(bank) {
    return effectiveLoanRate(bank, this.getCreditScore())
  }

  // --- Loan flow -----------------------------------------------------------

  takeLoan(bankId) {
    const bank = BANKS.find(b => b.id === bankId)
    if (!bank) return { success: false, error: 'Unknown bank' }
    if (this.loans.some(l => l.bankId === bankId)) {
      return { success: false, error: `${bank.name} already gave you a line of credit` }
    }
    this._refreshPeakSwing()
    const maxLoans = maxLoansForSwing(this.peakSwing)
    if (this.loans.length >= maxLoans) {
      return {
        success: false,
        error: `Slots full: you're capped at ${maxLoans} active loans (swing more P/L to unlock more banks).`
      }
    }
    const interestRate = this.effectiveRateFor(bank)
    // Compound interest: each hand the owed balance is multiplied by
    // (1 + perTurnRate). `perTurnRate` is `interestRate / INTERVAL`, so a
    // 5% annualized-style rate becomes 0.5% per hand at default credit.
    // Worst credit (10× multiplier) drives that to 5% per hand → owed
    // doubles every 14 hands and blows past 100× principal in 100 hands.
    // perTurnInterest is kept on the loan record for the initial-tick
    // display ("you owe +$N this hand") but the engine reads perTurnRate.
    const perTurnRate = interestRate / LOAN_INTEREST_HAND_INTERVAL
    const perTurnInterest = Math.max(1, Math.round(LOAN_AMOUNT * perTurnRate))
    const loan = {
      bankId,
      bankName: bank.name,
      principal: LOAN_AMOUNT,
      originalPrincipal: LOAN_AMOUNT,
      interestRate,
      perTurnRate,
      perTurnInterest,
      owed: LOAN_AMOUNT,
      autoPay: 0,
      takenAtHand: this.handsAtSession
    }
    this.loans.push(loan)
    this.loanedTotal += LOAN_AMOUNT
    this.lifetimeBorrowed += LOAN_AMOUNT
    this.chips += LOAN_AMOUNT
    this.pokerBuyIn += LOAN_AMOUNT
    return { success: true, bank, loan, loanedTotal: this.loanedTotal, chips: this.chips }
  }

  repayLoan(bankId) {
    const idx = this.loans.findIndex(l => l.bankId === bankId)
    if (idx === -1) return { success: false, error: 'No loan from that bank' }
    const loan = this.loans[idx]
    if (this.chips < loan.owed) {
      return { success: false, error: `Need $${loan.owed.toLocaleString()} to pay back; you only have $${this.chips.toLocaleString()}.` }
    }
    const principal = Math.max(0, loan.principal)
    const interestPortion = Math.max(0, loan.owed - principal)
    this.chips -= loan.owed
    this.pokerBuyIn -= principal
    // The (owed - principal) interest portion came out of chips without a
    // matching pokerBuyIn deduction, so it correctly hits P/L as an expense.
    this.loans.splice(idx, 1)
    this.loanedTotal -= loan.originalPrincipal ?? principal
    this.lifetimeInterestPaid += interestPortion
    return { success: true, loan, repaid: loan.owed }
  }

  // Bigyahu: forgive all loans, restore credit, zero P/L. Player keeps chips
  // and earns the ✡️ + 🇮🇱 additions to their emote palette.
  bigYahu() {
    const cleared = this.loans.length
    this.loans = []
    this.loanedTotal = 0
    this.peakSwing = 0
    // P/L = chips + openSideBetStake − buyIn, so resetting buyIn to the
    // current full bankroll (chips + stake) makes the displayed profit 0.
    // Any open bets settle later with their realized delta landing in
    // chips, which then shows as the post-yahu realized profit/loss.
    this.pokerBuyIn = this.chips + (this.openSideBetStake || 0)
    this.bigYahuCalls = (this.bigYahuCalls || 0) + 1
    return { success: true, cleared, firstCall: this.bigYahuCalls === 1 }
  }

  resetMoney() {
    this.loans = []
    this.loanedTotal = 0
    this.peakSwing = 0
    this.chips = POKER_CONFIG.STARTING_CHIPS
    this.pokerBuyIn = POKER_CONFIG.STARTING_CHIPS
    // resetMoney is gated by MessageHandler to only run between hands, when
    // the engine has already drained all open positions. We zero defensively
    // anyway so a buggy reset path can't leave a phantom stake hanging.
    this.openSideBetStake = 0
    this.handsAtSession = 0
    this.bigYahuCalls = 0
    this.lifetimeBorrowed = 0
    this.lifetimeInterestPaid = 0
    this._creditScoreMin = null
    this._creditScoreMax = null
  }

  // Called by PokerRoom when a new hand starts at this player's table. Each
  // turn: (1) accrue per-turn interest, (2) run auto-pay if set. Auto-pay
  // is interest-portion-first so principal melts last and the player keeps
  // owing on the bank's chips even after sustained payments.
  tickHandCounter() {
    this.handsAtSession += 1
    const events = []
    for (const loan of [...this.loans]) {
      // Compound interest. New balance = owed × (1 + perTurnRate). For
      // legacy loans (taken before this code change) perTurnRate may be
      // missing — fall back to deriving it from interestRate / INTERVAL.
      // The minimum-1-chip guard catches floors where the rate is so low
      // that floor(owed × rate) rounds to 0; without it small loans at
      // good credit would never accrue anything.
      const rate = (typeof loan.perTurnRate === 'number' && loan.perTurnRate >= 0)
        ? loan.perTurnRate
        : (loan.interestRate || 0) / LOAN_INTEREST_HAND_INTERVAL
      const before = loan.owed
      const grown = Math.max(loan.owed + 1, Math.floor(loan.owed * (1 + rate)))
      loan.owed = grown
      const delta = loan.owed - before
      events.push({ kind: 'interest', bankName: loan.bankName, amount: delta, owedAfter: loan.owed })

      if (loan.autoPay > 0 && this.chips > 0) {
        const pay = Math.min(loan.autoPay, loan.owed, this.chips)
        if (pay > 0) {
          const interestPortion = Math.min(pay, Math.max(0, loan.owed - loan.principal))
          const principalPortion = pay - interestPortion
          this.chips -= pay
          this.pokerBuyIn -= principalPortion
          loan.owed -= pay
          loan.principal -= principalPortion
          this.lifetimeInterestPaid += interestPortion
          events.push({
            kind: 'autopay',
            bankName: loan.bankName,
            amount: pay,
            principalPortion,
            interestPortion,
            owedAfter: loan.owed
          })
          if (loan.owed <= 0 || loan.principal <= 0) {
            // Fully paid off — remove the loan, refund any leftover principal
            // accidentally over-paid (shouldn't happen with the min above).
            this.loanedTotal -= loan.originalPrincipal
            const idx = this.loans.indexOf(loan)
            if (idx !== -1) this.loans.splice(idx, 1)
            events.push({ kind: 'cleared', bankName: loan.bankName })
          }
        }
      }
    }
    return events
  }

  setAutoPay(bankId, amount) {
    const loan = this.loans.find(l => l.bankId === bankId)
    if (!loan) return { success: false, error: 'No loan from that bank' }
    const n = Math.max(0, Math.floor(Number(amount) || 0))
    loan.autoPay = n
    return { success: true, loan }
  }

  updateActivity() {
    this.lastActiveTime = Date.now()
  }

  setProfileAvatar(avatarId) {
    const avatar = PROFILE_AVATARS.find(item => item.id === avatarId)
    if (!avatar) return false

    this.avatarId = avatar.id
    this.avatarUrl = avatar.url
    return true
  }

  // Set a custom uploaded avatar (URL). Validates the URL against the
  // configured CDN base so we don't broadcast an arbitrary attacker-
  // controlled image URL to every player at the table.
  //
  // 2026-05: anon uploads were silently failing here because the strict
  // hostname-equality check rejected any URL not exactly matching
  // S3_PUBLIC_BASE_URL — including the bucket's direct regional host
  // when the CDN base wasn't configured. The validation now accepts:
  //   • The configured CloudFront/CDN base (S3_PUBLIC_BASE_URL)
  //   • The bucket's regional S3 host (S3_BUCKET_NAME.s3*.amazonaws.com)
  // and logs (not silently drops) any rejection so the failure surfaces
  // in server logs. Still no arbitrary URLs allowed.
  //
  // `avatarId` is cleared (set to null) so consumers know to render
  // straight from `avatarUrl` instead of looking up a preset.
  setCustomAvatarUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 512) return false
    let parsed
    try { parsed = new URL(url) } catch {
      console.warn('[avatar] setCustomAvatarUrl: unparseable URL')
      return false
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

    const allowedHosts = new Set()
    const baseRaw = process.env.S3_PUBLIC_BASE_URL || ''
    if (baseRaw) {
      try { allowedHosts.add(new URL(baseRaw).hostname) } catch {}
    }
    // Bucket-direct fallback. Covers cases where the presign issuer
    // returns the regional S3 URL (e.g., dev without CloudFront) or
    // the operator hasn't set S3_PUBLIC_BASE_URL. The pattern check
    // also avoids accepting an arbitrary other bucket as our own.
    const bucket = process.env.S3_BUCKET_NAME || ''
    if (bucket && parsed.hostname.startsWith(`${bucket}.s3`) && parsed.hostname.endsWith('.amazonaws.com')) {
      allowedHosts.add(parsed.hostname)
    }
    if (allowedHosts.size === 0) {
      console.warn('[avatar] setCustomAvatarUrl: no S3_PUBLIC_BASE_URL or S3_BUCKET_NAME configured; rejecting all custom URLs')
      return false
    }
    if (!allowedHosts.has(parsed.hostname)) {
      console.warn('[avatar] setCustomAvatarUrl: host not allowed:', parsed.hostname, '(allowed:', [...allowedHosts].join(','), ')')
      return false
    }
    this.avatarId = null
    this.avatarUrl = url
    return true
  }

  send(data) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(data))
    }
  }

  // Send a pre-stringified payload. Used by broadcast fan-out: building the
  // game-state JSON once and reusing it across N recipients is ~3x faster
  // than stringifying per recipient.
  sendRaw(text) {
    if (this.ws?.readyState === 1) {
      this.ws.send(text)
    }
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      avatarId: this.avatarId,
      avatarUrl: this.avatarUrl,
      chips: this.chips,
      pokerBuyIn: this.pokerBuyIn,
      // Off-table reserves + active budget cap. The client renders
      // both in the self-popover so the player can see what they've
      // shelved and what the auto-rebuy ceiling is. Server is the
      // source of truth — the client never owns these numbers.
      pokerReserves: this.pokerReserves || 0,
      pokerBudget: typeof this.pokerBudget === 'number' ? this.pokerBudget : null,
      // Public-account fields are only exposed when the seat is playing
      // as itself — joining anonymously keeps the user fully hidden on
      // the wire. The seat-click popover branches on `publicUserId`:
      // present → fetch the public profile, absent → anonymous view.
      publicUserId: this.playingAsSelf ? (this.userId || null) : null,
      publicElo: this.playingAsSelf ? (this.elo ?? null) : null,
      isSpectator: this.isSpectator,
      isConnected: this.isConnected,
      loans: this.loans?.map(l => ({ ...l })) ?? [],
      loanedTotal: this.loanedTotal ?? 0,
      creditScore: this.getCreditScore(),
      maxLoans: this.getMaxLoans(),
      peakSwing: this.peakSwing ?? 0,
      handsAtSession: this.handsAtSession ?? 0,
      bigYahuCalls: this.bigYahuCalls ?? 0,
      lifetimeBorrowed: this.lifetimeBorrowed ?? 0,
      lifetimeInterestPaid: this.lifetimeInterestPaid ?? 0,
      creditScoreMin: this._creditScoreMin ?? this.getCreditScore(),
      creditScoreMax: this._creditScoreMax ?? this.getCreditScore(),
      // Daily / cosmetic state that the client renders (challenge progress,
      // skin background on the nameplate, achievements grid). Always
      // emitted so spectators get their daily-tool data the same way
      // seated players do.
      dailyProgress: this.dailyProgress || 0,
      dailyCompleted: !!this.dailyCompleted,
      dailiesCompleted: this.dailiesCompleted || 0,
      achievements: Array.isArray(this.achievements) ? this.achievements : [],
      skinId: this.skinId || 0,
      customSkin: this.customSkin || null,
      // Active peer loans this player is party to (both sides — borrowed
      // and lent — show up here). The client filters by lenderId/borrowerId
      // for display in the profile popover and loan UI.
      peerLoans: Array.isArray(this.peerLoans) ? this.peerLoans : [],
      // Chips parked in unresolved side-bet positions. Surfaced so the
      // spectator bankroll badge can fold them into the P/L display
      // (unresolved bets aren't realized losses, see luckStats.js).
      openSideBetStake: this.openSideBetStake || 0
    }
  }
}

// Grace window between WS close and full player teardown. Long enough to
// survive a page reload + cold start of the next WS connect (~5-15s in
// practice), short enough that a player who quit doesn't tie up a seat
// for a meaningful fraction of a hand. Tunable via env so we can dial it
// down in arena/tournament rooms later without redeploying.
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 45_000

export class PlayerManager {
  constructor() {
    this.players = new Map()
    // sessionToken → playerId. Indexed alongside `players` so a returning
    // socket can be re-attached in O(1). Entries are cleared when the
    // grace window expires or the player explicitly leaves.
    this._tokensByPlayer = new Map()  // playerId → sessionToken
    this._playerByToken = new Map()   // sessionToken → playerId
    // playerId → { timer, expiresAt }. Holds the player object alive
    // after WS close until the grace window elapses.
    this._graceTimers = new Map()
    // Optional callback fired when a grace timer fires without a
    // reconnect — used by WebSocketServer to do the final cleanup
    // (leaveGame, untrackPresence, deletePlayer). Plumbed via
    // setOnGraceExpire so PlayerManager doesn't reach into networking.
    this._onGraceExpire = null
  }

  setOnGraceExpire(fn) { this._onGraceExpire = typeof fn === 'function' ? fn : null }

  addPlayer(id, ws, username = null) {
    const player = new Player(id, ws, username)
    this.players.set(id, player)
    // Mint a fresh session token. Two layers of randomness because the
    // playerId is also a UUID — a leaked playerId alone shouldn't be
    // enough to hijack a seat. The token is stored client-side in
    // localStorage and never broadcast.
    const token = randomToken()
    player.sessionToken = token
    this._tokensByPlayer.set(id, token)
    this._playerByToken.set(token, id)
    return player
  }

  getPlayer(id) {
    return this.players.get(id)
  }

  // Look up a player by their issued session token. Used by the RECONNECT
  // handler to find the seat we held during the grace window.
  getPlayerByToken(token) {
    if (typeof token !== 'string' || token.length === 0) return null
    const id = this._playerByToken.get(token)
    if (!id) return null
    return this.players.get(id) || null
  }

  deletePlayer(id) {
    const token = this._tokensByPlayer.get(id)
    if (token) this._playerByToken.delete(token)
    this._tokensByPlayer.delete(id)
    this.clearGrace(id)
    this.players.delete(id)
  }

  // Begin the grace window for a player whose WS just closed. Doesn't
  // remove them from any room — that's what the grace is for. If the
  // window elapses without RECONNECT, `_onGraceExpire(playerId)` is
  // fired so the network layer can tear them down properly.
  beginGrace(id) {
    const player = this.players.get(id)
    if (!player) return
    if (this._graceTimers.has(id)) return  // already in grace
    const now = Date.now()
    player.disconnectedAt = now
    player.graceExpiresAt = now + RECONNECT_GRACE_MS
    player.isConnected = false
    const timer = setTimeout(() => {
      this._graceTimers.delete(id)
      const p = this.players.get(id)
      if (!p) return
      // Still disconnected at expiry → terminal teardown.
      if (!p.isConnected) {
        try { this._onGraceExpire?.(id) } catch (err) {
          console.warn('[grace] onGraceExpire threw:', err.message)
        }
      }
    }, RECONNECT_GRACE_MS)
    // Don't keep the event loop alive just for the grace timer (node
    // would block shutdown for up to RECONNECT_GRACE_MS otherwise).
    if (typeof timer.unref === 'function') timer.unref()
    this._graceTimers.set(id, { timer, expiresAt: player.graceExpiresAt })
  }

  // Cancel a pending grace timer — called when the client reconnects in
  // time or explicitly leaves. Safe to call when no timer is active.
  clearGrace(id) {
    const entry = this._graceTimers.get(id)
    if (entry) {
      clearTimeout(entry.timer)
      this._graceTimers.delete(id)
    }
    const p = this.players.get(id)
    if (p) {
      p.disconnectedAt = null
      p.graceExpiresAt = null
    }
  }

  isInGrace(id) { return this._graceTimers.has(id) }

  // Swap a player's WS reference for a freshly-arrived one. Used by the
  // RECONNECT handler: same Player object, same chips/cards/seat, new
  // socket. Token rotates so the old token can't be reused.
  attachSocket(id, ws) {
    const player = this.players.get(id)
    if (!player) return null
    player.ws = ws
    player.isConnected = true
    this.clearGrace(id)
    // Rotate the token. Old token is invalidated immediately.
    const oldToken = this._tokensByPlayer.get(id)
    if (oldToken) this._playerByToken.delete(oldToken)
    const newToken = randomToken()
    player.sessionToken = newToken
    this._tokensByPlayer.set(id, newToken)
    this._playerByToken.set(newToken, id)
    return player
  }

  getConnectedPlayers() {
    return [...this.players.values()].filter(p => p.isConnected)
  }

  // Every WS connection a given userId has open right now. A user may
  // have multiple (laptop + phone, two tabs) so we return an array.
  // Used by notification + DM push paths so a fresh message lights up
  // every open client in real time.
  getPlayersByUserId(userId) {
    if (!userId) return []
    const out = []
    for (const p of this.players.values()) {
      if (p.userId === userId && p.isConnected) out.push(p)
    }
    return out
  }
}

// 24-byte random token, URL-safe base64. crypto.randomUUID would be fine
// security-wise but base64-of-randomBytes is shorter on the wire and
// avoids confusion with the playerId (also a UUID).
function randomToken() {
  // Node 22 has webcrypto on globalThis.crypto. Falling back to
  // Math.random would gut the security guarantee, so just import.
  const buf = new Uint8Array(24)
  globalThis.crypto.getRandomValues(buf)
  // Base64-url: replace +/= with -_, drop padding. Output ≈ 32 chars.
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
