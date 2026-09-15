import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import NavBar from "@/components/NavBar";
import SolanaWalletProvider from "@/components/SolanaWalletProvider";
import Web3Provider from "@/components/Web3Provider";
import PhantomProvider from "@/components/PhantomProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OnStock — Onchain Stock Aggregator",
  description: "Find the best price to buy and sell tokenized stocks across all providers, DEXs, and exchanges.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-white text-[#0F172A]" suppressHydrationWarning>
        <Web3Provider>
          <SolanaWalletProvider>
            <PhantomProvider>
              <NavBar />
              <main>{children}</main>
              <Footer />
            </PhantomProvider>
          </SolanaWalletProvider>
        </Web3Provider>
      </body>
    </html>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#E2E8F0] mt-auto">
      <div className="max-w-6xl mx-auto px-4 py-8 text-sm text-[#94A3B8]">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p>&copy; 2026 OnStock. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-[#64748B] transition-colors">Docs</a>
            <a href="#" className="hover:text-[#64748B] transition-colors">Twitter</a>
            <a href="#" className="hover:text-[#64748B] transition-colors">GitHub</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
