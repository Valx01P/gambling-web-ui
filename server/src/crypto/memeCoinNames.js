// Meme/scam-coin name generator. Picks deterministically from a flat
// 200+ entry pool mixing real-sounding L1/DeFi names, classic meme
// tickers, and outright shitcoin parodies. Combined with the existing
// adjective+root compound fallback this gives ~30,000 distinct names.
//
// Player-minted coins use the same pool: a user who doesn't type a
// name lands on a random entry indistinguishable from the auto-mints
// generated every hand by the engine. That's the design ask — the
// market mixes "fake" auto-coins with real player launches and a
// would-be buyer can't tell which is which from the name alone.

// ── Flat curated pool ──────────────────────────────────────────────
// Each row is [SYMBOL, NAME]. Symbol stays <= 7 chars so the ticker
// fits the table cells uniformly. Names are loose-cased; the engine
// uppercases the symbol on display, the name stays mixed-case.
const POOL = [
  // ── classic crypto-meme tier (the originals) ────────────────────
  ['DOGE',   'Dogecoin'],
  ['SHIB',   'Shiba Inu'],
  ['PEPE',   'Pepe'],
  ['BONK',   'Bonk'],
  ['WIF',    'dogwifhat'],
  ['FLOKI',  'Floki Inu'],
  ['BABYDGE','Baby Doge'],
  ['SAFEMN', 'SafeMoon'],
  ['MYRO',   'Myro'],
  ['BOOK',   'Book of Meme'],
  ['POPCAT', 'Popcat'],
  ['MOG',    'Mog Coin'],
  ['TURBO',  'Turbo'],
  ['BRETT',  'Brett'],
  ['NEIRO',  'Neiro'],
  ['HARRY',  'Harry'],
  ['PNUT',   'Peanut the Squirrel'],
  ['GOAT',   'Goatseus Maximus'],
  ['CHILL',  'Chill Guy'],
  ['FARTC',  'Fartcoin'],
  ['MOODENG','Moo Deng'],
  ['DADDY',  'Daddy Tate'],
  // ── L1 / L2 / DeFi sounding (looks "real") ──────────────────────
  ['ETH',    'Etherion'],
  ['SOL',    'Solaris'],
  ['AVAX',   'Avalan'],
  ['ARB',    'Arbital'],
  ['OP',     'Optix'],
  ['MATIC',  'Polygnostic'],
  ['NEAR',   'Nearfield'],
  ['ATOM',   'Cosmoscan'],
  ['SUI',    'Suisei'],
  ['APT',    'Aptoria'],
  ['DOT',    'Polkadat'],
  ['ADA',    'Cardona'],
  ['XTZ',    'Tezotik'],
  ['ALGO',   'Algorhythm'],
  ['FTM',    'Phantompay'],
  ['HBAR',   'Hashgrid'],
  ['ICP',    'Internet Compute'],
  ['SEI',    'Seinet'],
  ['INJ',    'Inject Protocol'],
  ['KAS',    'Kasparian'],
  ['STX',    'Stackspine'],
  ['MNT',    'Mantleworks'],
  ['BASE',   'BasePool'],
  ['BLAST',  'Blastnet'],
  ['MERLIN', 'Merlin Layer'],
  ['LINEA',  'Linea Roll'],
  ['ZK',     'ZKProvably'],
  ['LRC',    'Loopfold'],
  ['IMX',    'Immutable X'],
  ['STRK',   'Starknetting'],
  // ── DeFi staples ────────────────────────────────────────────────
  ['UNI',    'UniSwapper'],
  ['SUSHI',  'Sushimaki'],
  ['CRV',    'Curvature'],
  ['BAL',    'Balanced'],
  ['CAKE',   'Pancake Bake'],
  ['AAVE',   'Aaveform'],
  ['COMP',   'Compounder'],
  ['MKR',    'Makerline'],
  ['SNX',    'Synthpath'],
  ['1INCH',  'OneInchSwap'],
  ['DYDX',   'DerivDexx'],
  ['GMX',    'GMXperp'],
  ['LDO',    'Liquidaut'],
  ['RPL',    'Rocketsplit'],
  ['ETHFI',  'Ethereon'],
  ['EIGEN',  'Eigenstake'],
  ['PENDLE', 'Pendulum'],
  // ── AI-coin tier (the 2024 mania) ───────────────────────────────
  ['FET',    'FetchOracle'],
  ['AGIX',   'SingularNet'],
  ['RNDR',   'Renderfarm'],
  ['TAO',    'Bittensaur'],
  ['ARKM',   'Arkahmist'],
  ['WLD',    'Worldorb'],
  ['CTXC',   'CortexAI'],
  ['NMR',    'Numeraxon'],
  ['IO',     'IOnet Compute'],
  ['NEAR',   'NearAI Stack'],
  ['AIO',    'AIO Protocol'],
  ['GPT',    'GPTokens'],
  ['LLM',    'LLMcoin'],
  ['GROK',   'Grokchain'],
  ['CLAUDE', 'Claudechain'],
  ['MIDJ',   'Midjernet'],
  ['NEURO',  'NeuralCash'],
  ['SYNAPS', 'Synapsen'],
  ['ASI',    'ASIStack'],
  // ── Real-asset / RWA / utility tier ─────────────────────────────
  ['USDX',   'USDXchange'],
  ['GOLD',   'GoldChain'],
  ['SILVER', 'SilverNet'],
  ['OIL',    'OilFutures'],
  ['CO2',    'CarbonCred'],
  ['REIT',   'TokenREIT'],
  ['HOUSE',  'HouseToken'],
  ['ART',    'ArtChain'],
  ['MUSIC',  'MusicCoin'],
  ['EVT',    'EventPass'],
  ['VOTE',   'VotingCoin'],
  ['IDX',    'IndexBundle'],
  ['ETF',    'ETFwrapper'],
  ['T',      'TimeCash'],
  ['HEX',    'Hexagonal'],
  ['BTT',    'Bitfetti'],
  // ── shitcoin / rug-bait parodies ────────────────────────────────
  ['EXITSC', 'Exit Scam'],
  ['RUGM',   'RugMe'],
  ['RUGPLL', 'Rug Pull Plus'],
  ['HONEY',  'Honeypotcoin'],
  ['SQUID',  'Squid Game Cash'],
  ['PYRA',   'Pyramidcoin'],
  ['NOTAS',  'Definitely Not A Scam'],
  ['LAST',   'Last Buyer'],
  ['BAGZ',   'Bagholder'],
  ['REKT',   'Rektcoin'],
  ['LIQ',    'Liquidated'],
  ['MARGIN', 'Margin Call'],
  ['POOR',   'PoorCoin'],
  ['BROKE',  'BrokeBoyz'],
  ['HOPIUM', 'Hopium Inc'],
  ['COPE',   'Copecoin'],
  ['JEET',   'Jeet Industries'],
  ['BAGS',   'Empty Bag DAO'],
  ['BLEED',  'BleedSlow'],
  ['ZEROC',  'ZeroCoin'],
  ['ZRO',    'Zerosum'],
  ['SCAM',   'Scam Token'],
  ['PONZI',  'Ponzi Finance'],
  ['MADOFF', 'Madoff DAO'],
  ['ENRON',  'Enron Energy'],
  ['LEHMAN', 'Lehman Bros'],
  ['MTGOX',  'MtGox Recovery'],
  ['CELSIUS','Celsius Burn'],
  ['LUNA',   'Lunaclassic'],
  ['UST',    'USTabilized'],
  ['FTX',    'FTXyz'],
  ['SBF',    'SBF Refund'],
  ['CZ',     'Detained Coin'],
  // ── animal memes (deep cut) ─────────────────────────────────────
  ['CAT',    'Catcoin'],
  ['SHARK',  'SharkBait'],
  ['FROG',   'Frogchain'],
  ['BUNNY',  'Bunnychain'],
  ['HORSE',  'Hayburner'],
  ['DUCK',   'DuckSwap'],
  ['MONK',   'Monkeycoin'],
  ['SLOTH',  'SlothFi'],
  ['HIPPO',  'Hippocoin'],
  ['PANDA',  'PandaFinance'],
  ['CORGI',  'Corgicoin'],
  ['HUSKY',  'Huskypaws'],
  ['WHALE',  'Whalewatch'],
  ['DOLPHN', 'Dolphinex'],
  ['OCTO',   'Octochain'],
  ['CRAB',   'Crabnet'],
  ['LOBST',  'Lobstcoin'],
  ['CHICK',  'Chickenbeak'],
  ['GOOSE',  'Goose Honk'],
  ['ALPACA', 'Alpacafinance'],
  ['LLAMA',  'Llamaprotocol'],
  ['CAMEL',  'Camelchain'],
  ['MAMMTH', 'Mammoth Memes'],
  ['DINO',   'Dinocoin'],
  // ── pop-culture tickers ─────────────────────────────────────────
  ['ELON',   'Elon Inc'],
  ['DOGEFATHER','Dogefather'],
  ['MUSK',   'MuskMemes'],
  ['XAI',    'XAiCorp'],
  ['ROGAN',  'Roganchain'],
  ['DRAKE',  'Drakecoin'],
  ['KSHN',   'Kardashain'],
  ['TAYLOR', 'Swiftcoin'],
  ['MARVL',  'Marvelverse'],
  ['DRWHO',  'DrWhoCoin'],
  ['MARIO',  'Mariotoken'],
  ['PIKACU', 'Pikacoin'],
  ['LINK',   'Linkverse'],
  ['ZELDA',  'Zeldacoin'],
  ['NPC',    'NPCcoin'],
  ['CHAD',   'Chadtoken'],
  ['BASED',  'Basedcoin'],
  ['SIGMA',  'Sigmacoin'],
  ['ALPHA',  'Alphagrind'],
  ['BETA',   'Betatest'],
  ['OMEGA',  'Omegacore'],
  ['GIGA',   'Gigachad'],
  ['MEGA',   'Megabro'],
  // ── degen finance + lifestyle tier ──────────────────────────────
  ['YOLO',   'YOLO Capital'],
  ['WAGMI',  'WagmiNet'],
  ['NGMI',   'NGMI Inc'],
  ['HODL',   'HODLfarm'],
  ['BTFD',   'BTFDtoken'],
  ['FOMO',   'FOMOcoin'],
  ['FUD',    'FUDfighter'],
  ['LAMBO',  'Lambochain'],
  ['MOONP',  'Moonpump'],
  ['ROCKET', 'RocketLP'],
  ['STONK',  'Stonkmaster'],
  ['TENDIE', 'Tendiechain'],
  ['ANON',   'Anonchain'],
  ['CHADCN', 'Chadcoin'],
  ['GIGAJ',  'GigaJeet'],
  ['DEGEN',  'Degenchain'],
  ['APE',    'Apezone'],
  ['NFTX',   'NFTxchange'],
  ['MEME',   'Memenet'],
  ['LULZ',   'Lulzcoin'],
  ['LOL',    'LOLcoin'],
  ['KEK',    'Kekcoin'],
  ['POG',    'Pogchain'],
  ['GMI',    'GMIcoin'],
  ['BULL',   'BullishBag'],
  ['BEAR',   'Beargrind'],
  ['LIQUID', 'Liquid Hopium'],
  ['DCA',    'DCAcoin'],
  ['LEVERG', 'Leveragecoin'],
  ['REKT2',  'RektTwoCoin'],
  ['SQUEEZ', 'Squeezeplay'],
  ['SHORT',  'Shortsqueeze'],
  ['MARGIN2','Margin Call II'],
  ['HEDGE',  'Hedgefund Inc'],
  ['BIDEN',  'Bidencoin'],
  ['TRUMP2', 'Trump 2028'],
  ['POTUS',  'Potuscoin'],
  ['SCOTUS', 'Scotuscoin'],
  ['FBI',    'FBIcoin'],
  ['SEC',    'SECtoken'],
  ['IRS',    'IRStax'],
  ['CIA',    'CIAchain'],
  // ── gibberish tier (looks generated, intentionally) ─────────────
  ['XQQQ',   'Xqqqnet'],
  ['ZNTH',   'Zenithian'],
  ['QORE',   'Qoremeta'],
  ['VRTX',   'Vortex Cash'],
  ['NEXM',   'Nexomesh'],
  ['ORYX',   'Oryxion'],
  ['ZRX2',   'Zerox Two'],
  ['CRYSL',  'Crystalin'],
  ['NOVA2',  'Novapulse'],
  ['VANTA',  'Vantablack'],
  ['HELO',   'Heloform'],
  ['EVOS',   'Evostake'],
  ['IMPRT',  'Imprintfi'],
  ['NEXIA',  'Nexiagrid'],
  ['QUAZR',  'Quazaria'],
  ['ZYNQ',   'Zynqcoin'],
  ['VYBR',   'Vybrnet'],
  ['XOLO',   'Xolograde'],
]

// ── Compound fallback (used past the curated pool) ─────────────────
// Same prefix/root/suffix logic the engine had before. Kept around
// so the namespace remains effectively unbounded even after the
// curated list runs out for a session with a lot of mints.
const PREFIXES = [
  'SAFE', 'BABY', 'MINI', 'MEGA', 'TURBO', 'GIGA', 'ULTRA', 'HYPER',
  'PUMP', 'DUMP', 'KING', 'LORD', 'BASED', 'CHAD', 'COPE', 'BOG',
  'GOLD', 'DIAMOND', 'BLACK', 'NEON', 'SUPER', 'OMEGA', 'ALPHA', 'CYBER',
]
const ROOTS = [
  'MOON', 'INU', 'PEPE', 'DOGE', 'FLOKI', 'SHIB', 'CUM', 'WOJAK', 'PONZI',
  'RUG', 'SCAM', 'AIRDROP', 'YIELD', 'STAKE', 'APE', 'BANANA', 'FROG',
  'CAT', 'KITTEN', 'WHALE', 'BULL', 'BEAR', 'LAMBO', 'ROCKET', 'TENDIES',
  'GAINS', 'LOSS', 'BAGS', 'EXIT', 'RUGZ', 'COIN', 'TOKEN', 'CASH',
  'NET', 'CHAIN', 'PROTO', 'NEXUS', 'FORGE', 'STREAM', 'GRID', 'CORE',
]
const SUFFIXES = [
  '', '', '', '', '2X', '3X', '69', '420', 'X', 'AI', 'GPT', 'INU', 'CASH',
  'DAO', 'V2', 'V3', 'MAX', 'PRO', 'SWAP', 'FI', 'FUND', 'LABS',
]

// Tiny xorshift32 so the generator is deterministic. Same seeded
// behavior as before — given the same coin id we return the same name.
function hashSeed(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h || 1
}
function next(state) {
  let x = state.seed
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.seed = x >>> 0
  return state.seed
}
function pick(state, arr) {
  return arr[next(state) % arr.length]
}

export function generateMemeCoin(idForSeed) {
  const state = { seed: hashSeed(String(idForSeed || Math.random())) }
  next(state); next(state); next(state)  // warm up
  // 80% chance we pick from the curated pool; 20% fall through to
  // compound generation so the long tail of "weird AI-generated"
  // names still happens. Reading the low bit of `next` for the
  // branch keeps the rest of the state untouched if we don't use it.
  const useCurated = (next(state) % 5) !== 0
  if (useCurated && POOL.length > 0) {
    const [symbol, name] = POOL[next(state) % POOL.length]
    return { symbol, name }
  }
  const prefix = pick(state, PREFIXES)
  const root = pick(state, ROOTS)
  const suffix = pick(state, SUFFIXES)
  const symbol = (prefix.slice(0, 3) + root.slice(0, 3) + (suffix || '')).slice(0, 7)
  const name = `${prefix}${root}${suffix}`
  return { symbol, name }
}
