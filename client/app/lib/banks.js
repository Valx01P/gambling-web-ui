// Mirror of server/src/config/constants.js — kept in sync so the client can
// render rates and unlock tiers without a round-trip.
export const LOAN_AMOUNT = 10_000
export const LOAN_INTEREST_HAND_INTERVAL = 10
export const CREDIT_SCORE_DEFAULT = 700
export const CREDIT_SCORE_MIN = 300
export const CREDIT_SCORE_MAX = 850

export const BANK_UNLOCK_TIERS = [
  { swingAtLeast: 0,       maxLoans: 2  },
  { swingAtLeast: 10_000,  maxLoans: 4  },
  { swingAtLeast: 20_000,  maxLoans: 8  },
  { swingAtLeast: 40_000,  maxLoans: 16 },
  { swingAtLeast: 80_000,  maxLoans: 20 }
]

export const BANKS = [
  { id: 'chase',          name: 'Chase',                tagline: '$200 just for opening',                 baseRate: 0.045 },
  { id: 'boa',            name: 'Bank of America',      tagline: 'Erica is judging you',                  baseRate: 0.05  },
  { id: 'wells_fargo',    name: 'Wells Fargo',          tagline: 'New account, who dis?',                 baseRate: 0.06  },
  { id: 'citi',           name: 'Citi',                 tagline: 'Citi never sleeps',                     baseRate: 0.05  },
  { id: 'capital_one',    name: 'Capital One',          tagline: "What's in your wallet?",                baseRate: 0.07  },
  { id: 'us_bank',        name: 'U.S. Bank',            tagline: 'Possibility starts here',               baseRate: 0.045 },
  { id: 'pnc',            name: 'PNC Bank',             tagline: 'Yes, we can do that',                   baseRate: 0.05  },
  { id: 'truist',         name: 'Truist',               tagline: 'Built on trust',                        baseRate: 0.055 },
  { id: 'td',             name: 'TD Bank',              tagline: "America's most convenient",             baseRate: 0.06  },
  { id: 'hsbc',           name: 'HSBC',                 tagline: 'Together we thrive',                    baseRate: 0.07  },
  { id: 'barclays',       name: 'Barclays',             tagline: 'Forward-thinking',                      baseRate: 0.08  },
  { id: 'amex',           name: 'American Express',     tagline: "Don't leave home without it",           baseRate: 0.085 },
  { id: 'discover',       name: 'Discover',             tagline: 'Cashback overlords',                    baseRate: 0.10  },
  { id: 'sofi',           name: 'SoFi',                 tagline: 'The bank for the YOLO generation',      baseRate: 0.12  },
  { id: 'ally',           name: 'Ally Bank',            tagline: 'Do it right',                           baseRate: 0.06  },
  { id: 'goldman',        name: 'Goldman Sachs',        tagline: 'Definitely not predatory',              baseRate: 0.085 },
  { id: 'morgan_stanley', name: 'Morgan Stanley',       tagline: 'Capital created here',                  baseRate: 0.09  },
  { id: 'jpmorgan',       name: 'J.P. Morgan',          tagline: 'Old money energy',                      baseRate: 0.075 },
  { id: 'schwab',         name: 'Charles Schwab',       tagline: 'Through the cycle',                     baseRate: 0.08  },
  { id: 'fidelity',       name: 'Fidelity',             tagline: 'Smart move, big bet',                   baseRate: 0.07  }
]

export function creditScoreRateMultiplier(score) {
  const clamped = Math.max(CREDIT_SCORE_MIN, Math.min(CREDIT_SCORE_MAX, score))
  if (clamped >= CREDIT_SCORE_DEFAULT) {
    const t = (clamped - CREDIT_SCORE_DEFAULT) / (CREDIT_SCORE_MAX - CREDIT_SCORE_DEFAULT)
    return 1.0 - 0.5 * t
  }
  const t = (CREDIT_SCORE_DEFAULT - clamped) / (CREDIT_SCORE_DEFAULT - CREDIT_SCORE_MIN)
  return 1.0 + 2.0 * t
}

export function effectiveLoanRate(bank, creditScore) {
  return Math.round(bank.baseRate * creditScoreRateMultiplier(creditScore) * 1000) / 1000
}

export function maxLoansForSwing(peakSwing) {
  let result = 2
  for (const tier of BANK_UNLOCK_TIERS) {
    if (peakSwing >= tier.swingAtLeast) result = tier.maxLoans
  }
  return result
}

export function nextUnlockTier(peakSwing) {
  return BANK_UNLOCK_TIERS.find(t => t.swingAtLeast > peakSwing) || null
}

export function creditScoreLabel(score) {
  if (score >= 800) return 'Elite'
  if (score >= 740) return 'Excellent'
  if (score >= 670) return 'Good'
  if (score >= 580) return 'Fair'
  if (score >= 500) return 'Poor'
  return 'Subprime'
}

export function creditScoreColorClass(score) {
  if (score >= 800) return 'text-emerald-200'
  if (score >= 740) return 'text-emerald-300'
  if (score >= 670) return 'text-zinc-100'
  if (score >= 580) return 'text-amber-300'
  if (score >= 500) return 'text-orange-300'
  return 'text-red-300'
}
