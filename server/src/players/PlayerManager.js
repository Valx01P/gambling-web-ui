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
    this.username = username || `Player_${id.substring(0, 6)}`
    this.chips = POKER_CONFIG.STARTING_CHIPS
    this.pokerBuyIn = POKER_CONFIG.STARTING_CHIPS
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
  // `avatarId` is cleared (set to null) so consumers know to render
  // straight from `avatarUrl` instead of looking up a preset.
  setCustomAvatarUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 512) return false
    let parsed
    try { parsed = new URL(url) } catch { return false }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    const baseRaw = process.env.S3_PUBLIC_BASE_URL || ''
    if (!baseRaw) return false
    let baseHost
    try { baseHost = new URL(baseRaw).hostname } catch { return false }
    if (parsed.hostname !== baseHost) return false
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

export class PlayerManager {
  constructor() {
    this.players = new Map()
  }

  addPlayer(id, ws, username = null) {
    const player = new Player(id, ws, username)
    this.players.set(id, player)
    return player
  }

  getPlayer(id) {
    return this.players.get(id)
  }

  deletePlayer(id) {
    this.players.delete(id)
  }

  getConnectedPlayers() {
    return [...this.players.values()].filter(p => p.isConnected)
  }
}
