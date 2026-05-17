// Jobs board — the "there's always a way to get money" floor for
// players who run out of chips. Every hand the engine rolls up to 3
// gigs: short, atomic tasks the player can claim for a chip reward.
// Gigs auto-expire after the next hand-end so the board stays fresh.
//
// This is intentionally simple: no real task validation, no skill
// gates, no rate limiting beyond one-claim-per-hand. The point is to
// give a broke player a reason to stay in the lobby instead of
// rage-quitting after going bust.
//
// Bots can't claim jobs (they don't have chips that matter to them).

// Jobs span 5 tiers so the board always has SOMETHING relevant
// regardless of net worth. Tier weights bias the roll so a player
// starting from zero sees cheap gigs and a trillionaire still has
// stretch goals.
//
// 2026-05: rewrote the catalog from "honest work" to satirical
// crime / gray-market gigs per user request — the tycoon game
// tone is already GTA-with-spreadsheets (engineered crises,
// pandemics, sabotage, etc.), so the jobs board matches.

// Placeholder image helper for jobs. Tier-coded colors so even
// before real images are wired in, the panel renders a visual
// hierarchy (zinc/blue for low tier, glowing amber for planetary).
// AssetImage falls back to a styled chip if these ever 404.
function jph(text, tier) {
  const colors = {
    starter:     '52525b/e4e4e7',   // zinc
    bluecollar:  '1d4ed8/dbeafe',   // blue
    whitecollar: '0d9488/ccfbf1',   // teal
    exec:        '6d28d9/ede9fe',   // violet
    sovereign:   'a21caf/fae8ff',   // fuchsia
    planetary:   'a16207/fef3c7',   // amber (with shadow in CSS)
  }
  const pal = colors[tier] || colors.bluecollar
  const enc = encodeURIComponent(text).replace(/%20/g, '+')
  return `https://placehold.co/240x160/${pal}.png?text=${enc}&font=lato`
}
// Success-rate by tier — every gig is now a luck roll on `apply`. Easy
// petty-crime jobs almost always pay; planetary-tier capers usually
// fail and leave the applicant with nothing. The template can also
// override with its own `successPercent` (a few notably-easy or notably-
// hard gigs do).
const TIER_SUCCESS = {
  starter:     0.88,
  bluecollar:  0.72,
  whitecollar: 0.55,   // 55/45 — coin-flip-ish, the sweet spot
  exec:        0.25,   // ~1 in 4 — high reward, real risk
  sovereign:   0.15,
  planetary:   0.08,
}

// Payout-keyed hard ceiling. Independent of tier — a "blue collar"
// gig that happens to roll a 600k reward should still feel like a
// long shot. Applied as a CAP via Math.min, so a job whose template
// already specifies a worse rate (e.g. a manually-tuned 5%) keeps the
// lower number. Sub-100k jobs aren't capped and run on the tier rate.
function rewardCappedSuccess(reward, baseSuccess) {
  let cap = 1
  if (reward > 10_000_000)     cap = 0.01   // > $10M — 1% lottery odds
  else if (reward > 1_000_000) cap = 0.05   // $1M-$10M
  else if (reward > 100_000)   cap = 0.10   // $100K-$1M
  return Math.min(baseSuccess, cap)
}

const JOB_TEMPLATES = [
  // ─── STARTER (under $1K) ─────────────────────────────────────────
  // Petty-crime tier. For the bust-out player with literally zero
  // chips after a coin rug. There's always SOMETHING you can rob.
  { id: 'pickpocket',   tier: 'starter', title: 'Pickpocket on the subway',           reward: 250,  flavor: 'Tourist had a fat wallet.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'shoplift',     tier: 'starter', title: 'Shoplift from the drugstore',        reward: 300,  flavor: 'Self-checkout was unsupervised.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'mugging',      tier: 'starter', title: 'Mug a tourist in an alley',          reward: 400,  flavor: 'They\'re not from around here.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'catalytic',    tier: 'starter', title: 'Steal a catalytic converter',        reward: 600,  flavor: 'Hybrid Prius. Worth it.' , imageUrl: 'https://images.unsplash.com/photo-1583248379190-3f5c3b8c8e8e' },
  { id: 'fake_watches', tier: 'starter', title: 'Sell fake Rolexes on Canal St',      reward: 500,  flavor: 'Movement is real, the rest is plastic.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'scam_grandma', tier: 'starter', title: 'Gift-card scam an old lady',         reward: 350,  flavor: 'She thought you were her grandson.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'fake_id',      tier: 'starter', title: 'Print fake IDs in the basement',     reward: 450,  flavor: 'Teen prom season is peak.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'plasma',       tier: 'starter', title: 'Sell plasma twice in one day',       reward: 300,  flavor: 'Two arms, two donations.' , imageUrl: 'https://images.unsplash.com/photo-1584308666744-0a7a3c4c4e4e' },
  // ─── BLUE COLLAR ($1K-$50K) ──────────────────────────────────────
  // Working-class crime: corner work, sex work, fencing, scams.
  { id: 'corner_sling', tier: 'bluecollar', title: 'Sling on the corner all night',   reward: 3_000,  flavor: 'Foot traffic was steady.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'onlyfans',     tier: 'bluecollar', title: 'OnlyFans grind weekend',          reward: 8_000,  flavor: 'Subscriber count up 12%.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'stripping',    tier: 'bluecollar', title: 'Strip-club double shift',         reward: 5_500,  flavor: 'Bachelor party tipped in 20s.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'camming',      tier: 'bluecollar', title: 'Camming all night',               reward: 4_000,  flavor: 'One whale subscriber covered the night.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'car_boost',    tier: 'bluecollar', title: 'Boost a car for the chop shop',   reward: 12_000, flavor: 'Civic Type-R, parts go fast.' , imageUrl: 'https://images.unsplash.com/photo-1583248379190-3f5c3b8c8e8e' },
  { id: 'atm_skim',     tier: 'bluecollar', title: 'Run an ATM skimmer for a week',   reward: 15_000, flavor: 'Suburban grocery store, no cameras.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'charity_scam', tier: 'bluecollar', title: 'Run a fake-charity GoFundMe',     reward: 20_000, flavor: 'Sick puppy photos. 4-day campaign.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'pawn_fence',   tier: 'bluecollar', title: 'Fence a load of stolen iPads',    reward: 25_000, flavor: 'Pawn shop didn\'t ask questions.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'delivery_rob', tier: 'bluecollar', title: 'Rob a delivery truck',            reward: 30_000, flavor: 'Driver gave it up immediately.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'meth_batch',   tier: 'bluecollar', title: 'Cook a small batch in the RV',    reward: 40_000, flavor: 'No explosions this time.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'timeshare',    tier: 'bluecollar', title: 'High-pressure timeshare sales',   reward: 22_000, flavor: 'Closed the elderly couple in 90 mins.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'sugar_baby',   tier: 'bluecollar', title: 'Sugar-baby a divorcé',            reward: 35_000, flavor: 'Allowance + jewelry, sold the jewelry.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  // ─── WHITE COLLAR ($50K-$1M) ─────────────────────────────────────
  // Heist tier: bigger crimes with worse exit liability.
  { id: 'counterfeit',  tier: 'whitecollar', title: 'Print counterfeit hundreds',     reward: 150_000, flavor: 'The bleach + reprint method.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'art_forge',    tier: 'whitecollar', title: 'Forge a "lesser-known" Picasso', reward: 250_000, flavor: 'Provenance papers cost extra.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'ransomware',   tier: 'whitecollar', title: 'Deploy ransomware on a clinic',  reward: 400_000, flavor: 'Patient records hostage 6 days.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'identity_ring',tier: 'whitecollar', title: 'Identity theft ring',            reward: 500_000, flavor: 'Twelve SSNs, six fresh credit lines.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'jewel_heist',  tier: 'whitecollar', title: 'Smash-and-grab jewelry store',   reward: 650_000, flavor: 'Out in 90 seconds.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'bank_branch',  tier: 'whitecollar', title: 'Stick up a small bank branch',   reward: 800_000, flavor: 'Note over the counter, no weapon.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'pig_butcher',  tier: 'whitecollar', title: 'Crypto romance scam (pig butchering)', reward: 750_000, flavor: 'She "loved" you for 3 weeks.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'porn_studio',  tier: 'whitecollar', title: 'Run an indie adult studio',      reward: 350_000, flavor: 'Distribution deals signed.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  // ─── EXECUTIVE ($1M-$100M) ───────────────────────────────────────
  // White-collar mega-crime. Real prison time if caught.
  { id: 'ponzi',        tier: 'exec', title: 'Run a Ponzi scheme (a few hundred LPs)', reward: 5_000_000,  flavor: 'Returns "guaranteed" 22% a year.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'embezzle',     tier: 'exec', title: 'Embezzle from your own startup',         reward: 12_000_000, flavor: 'Auditors miss it for 2 years.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'insider',      tier: 'exec', title: 'Insider-trade off a leaked merger',      reward: 18_000_000, flavor: 'Cousin works at the law firm.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'pump_dump',    tier: 'exec', title: 'Pump-and-dump a microcap',               reward: 35_000_000, flavor: 'Discord group did the rest.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'ceo_kickback', tier: 'exec', title: 'Foreign-deal kickback',                  reward: 60_000_000, flavor: 'Sent through a Maltese shell.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'shell_wash',   tier: 'exec', title: 'Wash dirty money through shell cos',     reward: 75_000_000, flavor: '8 jurisdictions in 30 days.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'fda_bribe',    tier: 'exec', title: 'Bribe an FDA reviewer',                  reward: 45_000_000, flavor: 'Drug approved, side effects undisclosed.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  // ─── SOVEREIGN ($100M-$10B) ──────────────────────────────────────
  // Geopolitical crime. Sanctions evasion, dictator consulting,
  // arms-deal kickbacks. Cost of getting caught is being extradited.
  { id: 'cayman_setup', tier: 'sovereign', title: 'Set up a Caymans labyrinth',        reward: 300_000_000,   flavor: '6-layer offshore structure, opaque to FATF.' , imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503efbf' },
  { id: 'arms_broker',  tier: 'sovereign', title: 'Arms-deal broker (sanctioned buyer)',reward: 800_000_000,   flavor: 'Cyprus middleman took 8%.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'dictator_pr',  tier: 'sovereign', title: 'Consult a kleptocratic regime',     reward: 1_500_000_000, flavor: 'Image rehab via DC lobby firm.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'swiss_heist',  tier: 'sovereign', title: 'Heist a Swiss private bank',        reward: 2_000_000_000, flavor: 'Inside source in IT.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'crypto_mixer', tier: 'sovereign', title: 'Run a sanctioned crypto mixer',     reward: 4_000_000_000, flavor: 'Treasury added you to the SDN list.' , imageUrl: 'https://images.unsplash.com/photo-1558494949-ef0d38d3f2d4' },
  { id: 'pmc_contract', tier: 'sovereign', title: 'Private military contract abroad',  reward: 3_500_000_000, flavor: 'No-bid, cost-plus, plausible deniability.' , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  // ─── PLANETARY (Trillion-tier) ───────────────────────────────────
  // The "did you really just do that" tier. Should appear rarely.
  { id: 'coup',          tier: 'planetary', title: 'Stage a coup in a small country',   reward: 20_000_000_000,    flavor: 'Mercenaries on the ground in 48h.', weight: 0.25 , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'nuke_smuggle',  tier: 'planetary', title: 'Smuggle decommissioned warheads',    reward: 80_000_000_000,    flavor: 'Six trucks, three borders.', weight: 0.15 , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'war_contract',  tier: 'planetary', title: 'Sole-source contract for an oncoming war', reward: 120_000_000_000, flavor: 'Six countries, cost-plus.', weight: 0.15 , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'false_flag',    tier: 'planetary', title: 'Engineer a casus belli',             reward: 500_000_000_000,   flavor: 'Plausible enough for prime-time.', weight: 0.10 , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'foreign_asset', tier: 'planetary', title: 'Become a foreign asset',             reward: 250_000_000_000,   flavor: 'You\'re on the payroll of three intelligence services.', weight: 0.08 , imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64' },
  { id: 'megaheist',     tier: 'planetary', title: 'Acquire a sanctioned constellation', reward: 1_000_000_000_000, flavor: '40,000 birds in orbit. All yours.', weight: 0.05 , imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Satellite_constellation.jpg/800px-Satellite_constellation.jpg' },
]

// Decorate each template with a tier-coded placeholder imageUrl.
// Guard skips templates that already have a real `imageUrl: '...'`
// set inline, so once images-needed.md gets filled in those entries
// keep their real URLs and the rest stay on the placeholder.
for (const t of JOB_TEMPLATES) {
  if (!t.imageUrl) t.imageUrl = jph(t.title, t.tier)
}

// Tier weights for the per-hand reroll. We want the starter and
// blue-collar tiers to dominate so broke players always see a
// claimable gig; exec+ are rarer prestige picks.
const TIER_WEIGHTS = {
  starter:      30,
  bluecollar:   28,
  whitecollar:  18,
  exec:         12,
  sovereign:    8,
  planetary:    4,
}

const JOBS_PER_BOARD = 3

// Failure flavor text. Picked uniformly at random on every failed apply.
// Kept tier-agnostic — even a planetary-tier coup attempt that flops
// reads better with a goofy reason than a generic "failed" line.
const FAILURE_REASONS = [
  'Your "associate" forgot to bring the bag.',
  'A cop drove by at exactly the wrong moment.',
  'The mark recognized you from a wedding.',
  'Wi-Fi went out mid-transfer.',
  'Someone livestreamed it. Whole thing.',
  'You sneezed during the silent part.',
  'The accomplice screen-shared their bank app by accident.',
  'A pigeon shit on the getaway car windshield.',
  'Your VPN dropped for nine seconds.',
  'Karen showed up. Demanded the manager.',
  'You got a Slack notification at full volume.',
  'The mark had a "no thanks, I\'m good" energy.',
  '2FA. Why does everything have 2FA now.',
  'You used "Pa$$w0rd" again, didn\'t you.',
  'A K9 unit took a sudden interest.',
  'You left the receipt in the wrong pocket.',
  'The fixer ghosted you on Telegram.',
  'Background check came back faster than expected.',
  'You forgot it was a Tuesday.',
  'Someone\'s aunt is a journalist.',
  'You bragged about it on Twitter pre-execution.',
  'The Lyft driver had a body cam.',
  'You quoted Goodfellas mid-pitch.',
  'A nine-year-old saw the whole thing.',
  'Karma. Just karma.',
]

function pickFailureReason() {
  return FAILURE_REASONS[Math.floor(Math.random() * FAILURE_REASONS.length)]
}

export class JobEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast
    // Per-room available jobs — rotates each hand. Each job carries its
    // own per-player sets so multiple players can independently claim
    // or attempt the same gig in the same hand. 2026-05: removed the
    // global one-claim-per-hand cap and the "first person who tries
    // burns the gig" model — gigs are now a free chance for everyone
    // simultaneously.
    this.jobs = []
    this._jobSeq = 0
    this._rerollBoard()
  }

  _rerollBoard() {
    // Tier-weighted draw. We want each board to include a cheap gig
    // for the busted-out player + a mid-tier + sometimes a stretch
    // goal, rather than three random rolls that could all be
    // sovereign-level (unaffordable to most). Algorithm: weight each
    // template by its tier's TIER_WEIGHTS entry, then draw 3 distinct.
    const picks = []
    const used = new Set()
    const remaining = JOB_TEMPLATES.filter(t => !used.has(t.id))
    while (picks.length < JOBS_PER_BOARD && remaining.length > picks.length) {
      // Weighted random pick.
      const pool = JOB_TEMPLATES.filter(t => !used.has(t.id))
      if (pool.length === 0) break
      const totalWeight = pool.reduce(
        (sum, t) => sum + (TIER_WEIGHTS[t.tier] || 1) * (t.weight ?? 1),
        0
      )
      let roll = Math.random() * totalWeight
      let chosen = pool[0]
      for (const t of pool) {
        const w = (TIER_WEIGHTS[t.tier] || 1) * (t.weight ?? 1)
        if (roll < w) { chosen = t; break }
        roll -= w
      }
      used.add(chosen.id)
      picks.push(chosen)
    }
    // Vary the reward by ±15% so two consecutive boards don't feel
    // identical when the same template comes up.
    this.jobs = picks.map(t => {
      const reward = Math.floor(t.reward * (0.85 + Math.random() * 0.30))
      // Base rate: template-provided override wins, otherwise tier
      // default. Then apply the reward-keyed ceiling so a big-payout
      // job that fell into a "low-risk" tier still reads as the
      // long shot it should be.
      const baseSuccess = typeof t.successPercent === 'number'
        ? t.successPercent
        : (TIER_SUCCESS[t.tier] ?? 0.5)
      return {
        id: `job_${++this._jobSeq}`,
        jobId: t.id,
        title: t.title,
        flavor: t.flavor,
        tier: t.tier,
        reward,
        // Per-job success rate, capped against the rolled reward.
        // Stable for the life of this board roll so a player sees the
        // same odds the whole hand.
        successPercent: rewardCappedSuccess(reward, baseSuccess),
        imageUrl: t.imageUrl || null,
        // Per-player attempt history for THIS board only. Each player can
        // attempt every gig once: claimedByPlayers locks out re-applies on
        // a success; failedByPlayers locks out re-applies on a fail. Reset
        // on every reroll (hand-end). No more "first try burns it" model.
        claimedByPlayers: new Set(),
        failedByPlayers: new Set(),
      }
    })
  }

  // Apply for a gig. Rolls against `successPercent` per applicant — each
  // player gets their own independent roll on the same gig, so two people
  // can apply for the same job and one wins while the other gets a funny
  // rejection reason. A player can only attempt a given gig once per
  // hand (either result locks them out), but there's no global cap on
  // how many gigs a single player can pursue this hand.
  claim(playerId, instanceId) {
    const player = this.room.players?.get?.(playerId) || this.room.spectators?.get?.(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_claim' }
    const job = this.jobs.find(j => j.id === instanceId)
    if (!job) return { success: false, error: 'job_gone' }
    if (job.claimedByPlayers.has(playerId)) return { success: false, error: 'already_taken' }
    if (job.failedByPlayers.has(playerId)) return { success: false, error: 'already_failed' }
    const succeeded = Math.random() < (job.successPercent ?? 0.5)
    if (!succeeded) {
      job.failedByPlayers.add(playerId)
      const reason = pickFailureReason()
      this._broadcastState()
      return { success: true, applied: true, succeeded: false, title: job.title, reward: 0, reason }
    }
    job.claimedByPlayers.add(playerId)
    // Job rewards land in the bank — same as every other passive
    // money source (assets yield, stock proceeds, etc).
    player.bankBalance = (player.bankBalance || 0) + job.reward
    this._broadcastState()
    return { success: true, applied: true, succeeded: true, reward: job.reward, title: job.title }
  }

  onHandEnd() {
    this._rerollBoard()
    this._broadcastState()
  }

  buildSnapshot(playerId) {
    return {
      jobs: this.jobs.map(j => ({
        id: j.id,
        jobId: j.jobId,
        title: j.title,
        flavor: j.flavor,
        tier: j.tier || 'bluecollar',
        reward: j.reward,
        successPercent: j.successPercent ?? 0.5,
        imageUrl: j.imageUrl || null,
        // Per-player flags — only this viewer's outcome matters now.
        // Used by the panel to swap the Apply button into Done / Failed
        // for this specific user.
        claimedByMe: j.claimedByPlayers.has(playerId),
        failedByMe: j.failedByPlayers.has(playerId),
      })),
    }
  }

  _broadcastState() {
    const seats = this.room.players?.values?.() || []
    for (const p of seats) {
      if (p.isBot || !p.isConnected) continue
      p.send({ type: 'jobs:state', data: this.buildSnapshot(p.id) })
    }
    const specs = this.room.spectators?.values?.() || []
    for (const s of specs) {
      if (!s.isConnected) continue
      s.send({ type: 'jobs:state', data: this.buildSnapshot(s.id) })
    }
  }

  sendSnapshotTo(player) {
    if (!player || player.isBot) return
    player.send({ type: 'jobs:state', data: this.buildSnapshot(player.id) })
  }
}
