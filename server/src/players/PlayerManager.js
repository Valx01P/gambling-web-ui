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
  }

  // --- Derived stats -------------------------------------------------------

  getProfit() { return this.chips - this.pokerBuyIn }

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
    // Interest accrues every turn at 1/10 of the locked-in rate, against the
    // original principal — so even after partial payback the per-turn drag
    // stays the same. That's the joke: scammy fixed amount that never shrinks.
    const perTurnInterest = Math.max(1, Math.round(LOAN_AMOUNT * interestRate / LOAN_INTEREST_HAND_INTERVAL))
    const loan = {
      bankId,
      bankName: bank.name,
      principal: LOAN_AMOUNT,
      originalPrincipal: LOAN_AMOUNT,
      interestRate,
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
    this.pokerBuyIn = this.chips
    this.bigYahuCalls = (this.bigYahuCalls || 0) + 1
    return { success: true, cleared, firstCall: this.bigYahuCalls === 1 }
  }

  resetMoney() {
    this.loans = []
    this.loanedTotal = 0
    this.peakSwing = 0
    this.chips = POKER_CONFIG.STARTING_CHIPS
    this.pokerBuyIn = POKER_CONFIG.STARTING_CHIPS
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
      loan.owed += loan.perTurnInterest
      events.push({ kind: 'interest', bankName: loan.bankName, amount: loan.perTurnInterest, owedAfter: loan.owed })

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
      creditScoreMax: this._creditScoreMax ?? this.getCreditScore()
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
