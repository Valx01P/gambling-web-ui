import localFont from "next/font/local"
import FuzzyBackground from "./components/FuzzyBackground"
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
  title: "Stat Study — Poker",
  description: "Study game theory and adversarial analysis through poker",
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${googleSansCode.variable} antialiased text-white`}>
        <FuzzyBackground />
        {children}
      </body>
    </html>
  )
}
