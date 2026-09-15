"use client";

import { X } from "lucide-react";
import { Quote } from "@/lib/mock-data";
import { KYBER_SUPPORTED_CHAINS } from "@/lib/web3";
import SwapWidget from "./SwapWidget";
import JupiterSwapWidget from "./JupiterSwapWidget";

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: "buy" | "sell";
  ticker: string;
  quote: Quote;
  amount: number;
  basePrice: number;
}

export default function SwapModal({ isOpen, onClose, action, ticker, quote }: SwapModalProps) {
  if (!isOpen) return null;

  const isBuy = action === "buy";
  const isSolana = quote.chain === "Solana";
  const isRobinhood = quote.chainId === 4663;
  // 只有明显垃圾路由才拦截：偏离市场价 > 15%（说明池子深度极差）
  const isBadRoute = Math.abs(quote.premiumPercent) > 15;
  const hasWidget = !isBadRoute && quote.tokenAddress != null && (
    isRobinhood || (quote.chainId != null && KYBER_SUPPORTED_CHAINS.has(quote.chainId))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E2E8F0]">
          <div>
            <h3 className="font-semibold text-lg">{isBuy ? "Buy" : "Sell"} {ticker}</h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              via {quote.provider} · {quote.chain}
              <span className={`ml-2 font-medium ${quote.premiumPercent <= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                {quote.premiumPercent >= 0 ? "+" : ""}{quote.premiumPercent.toFixed(2)}% vs market
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-[#94A3B8] hover:text-[#0F172A] transition-colors ml-4">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[80vh] p-4">
          {isSolana && quote.tokenAddress ? (
            <JupiterSwapWidget
              outputMint={quote.tokenAddress}
              tokenSymbol={quote.tokenName}
              action={action}
            />
          ) : hasWidget ? (
            <SwapWidget
              tokenAddress={quote.tokenAddress!}
              tokenSymbol={quote.tokenName}
              action={action}
              chainId={quote.chainId!}
              basePrice={quote.price}
            />
          ) : (
            <div className="py-10 text-center px-6">
              <div className="w-12 h-12 bg-[#FEF3C7] rounded-full flex items-center justify-center mx-auto mb-3 text-xl">⚠️</div>
              <p className="font-semibold text-[#92400E] mb-1">Insufficient On-Chain Liquidity</p>
              <p className="text-sm text-[#94A3B8]">
                {quote.tokenName} on {quote.chain} does not have enough DEX liquidity for in-app swap.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
