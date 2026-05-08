import Link from "next/link"

const SpadeSVG = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2C12 2 4 10 4 14C4 17.5 7 19 9 18C7.5 20 6 21 6 21H18C18 21 16.5 20 15 18C17 19 20 17.5 20 14C20 10 12 2 12 2Z"
      fill="currentColor"
    />
  </svg>
)

const DiamondSVG = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <polygon points="12,2 22,12 12,22 2,12" fill="#ef4444" />
  </svg>
)

const ClubSVG = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 3a4.5 4.5 0 0 0-2.9 7.95A4.5 4.5 0 1 0 9 18.4c-.7 1.2-1.6 2.1-2.4 2.6h10.8c-.8-.5-1.7-1.4-2.4-2.6a4.5 4.5 0 1 0-.1-7.45A4.5 4.5 0 0 0 12 3Z"
      fill="currentColor"
    />
  </svg>
)

const HeartSVG = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 21s-8-4.9-8-11.2C4 6.5 6.3 4 9.2 4c1.6 0 2.9.8 3.8 2 0.9-1.2 2.2-2 3.8-2C19.7 4 22 6.5 22 9.8 22 16.1 12 21 12 21Z"
      fill="#ef4444"
    />
  </svg>
)

function GameCard({ href, title, description, tags, icon }) {
  return (
    <Link href={href} className="group w-full">
      <div className="relative h-full bg-green-900/80 border border-white/10 rounded-xl p-6 transition-all duration-200 group-hover:border-white/30 group-hover:bg-green-900 group-hover:scale-[1.02]">
        <div className="absolute top-4 right-4 opacity-30 group-hover:opacity-60 transition-opacity">
          {icon}
        </div>

        <h2 className="font-bold text-xl mb-1">{title}</h2>
        <p className="text-sm opacity-60 mb-6">{description}</p>

        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span key={tag} className="text-xs bg-white/10 rounded px-2 py-1">{tag}</span>
          ))}
        </div>
      </div>
    </Link>
  )
}

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-16">

      <div className="max-w-lg text-center mb-16">
        <div className="flex justify-center gap-2 mb-4 opacity-40">
          <DiamondSVG /><SpadeSVG /><DiamondSVG />
        </div>
        <h1 className="font-bold text-2xl sm:text-3xl leading-snug">
          Study advanced statistics, game theory, and adversarial analysis
        </h1>
        <p className="mt-3 text-sm opacity-60">
          Play with fake chips. Learn real strategy.
        </p>
      </div>

      <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        <GameCard
          href="/poker"
          title="Texas Hold'em"
          description="Up to 5 players - spectate or play"
          tags={['Multiplayer', 'Spectate', 'Stats']}
          icon={<SpadeSVG />}
        />
        <GameCard
          href="/blackjack"
          title="Blackjack"
          description="Up to 5 players - beat the dealer together"
          tags={['Split', 'Double', 'Chat']}
          icon={<ClubSVG />}
        />
        <GameCard
          href="/baccarat"
          title="Baccarat"
          description="Bet player, banker, or tie with friends"
          tags={['Fast Bets', 'Big Stacks', 'Chat']}
          icon={<HeartSVG />}
        />
      </div>

    </div>
  )
}
