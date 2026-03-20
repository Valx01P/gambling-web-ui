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

      <Link href="/poker" className="group w-full max-w-xs">
        <div className="relative bg-green-900/80 border border-white/10 rounded-xl p-6 
                        transition-all duration-200 group-hover:border-white/30 
                        group-hover:bg-green-900 group-hover:scale-[1.02]">
          
          <div className="absolute top-4 right-4 opacity-30 group-hover:opacity-60 transition-opacity">
            <SpadeSVG />
          </div>

          <h2 className="font-bold text-xl mb-1">Texas Hold&apos;em</h2>
          <p className="text-sm opacity-60 mb-6">
            Up to 6 players &middot; Spectate or play
          </p>

          <div className="flex gap-2">
            <span className="text-xs bg-white/10 rounded px-2 py-1">AI opponents</span>
            <span className="text-xs bg-white/10 rounded px-2 py-1">Multiplayer</span>
            <span className="text-xs bg-white/10 rounded px-2 py-1">Spectate</span>
          </div>
        </div>
      </Link>

    </div>
  )
}
