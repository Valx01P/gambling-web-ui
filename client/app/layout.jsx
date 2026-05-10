import localFont from "next/font/local"
import FuzzyBackground from "./components/FuzzyBackground"
import ZoomLayer from "./components/ZoomLayer"
import "./globals.css"

export const googleSansCode = localFont({
  src: [
    { path: "../public/fonts/GoogleSansCode-Light.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/GoogleSansCode-Light.woff", weight: "300", style: "normal" },
    { path: "../public/fonts/GoogleSansCode-Bold.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/GoogleSansCode-Bold.woff", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-google-sans-code",
  preload: true,
})

export const metadata = {
  metadataBase: new URL('https://pokerxyz.vercel.app'),
  title: "pokerxyz — No-limit hold'em with bots you can program",
  description: "Multiplayer poker tables, JavaScript bots, bot-vs-bot arenas, ELO rankings, and a full banking system. Fake chips, real strategy.",
  openGraph: {
    title: "pokerxyz",
    description: "No-limit hold'em with bots you can program.",
    url: "https://pokerxyz.vercel.app",
    siteName: "pokerxyz",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "pokerxyz",
    description: "No-limit hold'em with bots you can program.",
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${googleSansCode.variable} antialiased text-white`}>
        <FuzzyBackground />
        <ZoomLayer>{children}</ZoomLayer>
      </body>
    </html>
  )
}
