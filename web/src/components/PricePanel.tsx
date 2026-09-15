"use client";

import { useState } from "react";
import { Shield, Zap } from "lucide-react";
import { Quote } from "@/lib/mock-data";
import { formatPrice, formatPercent, getProviderColor } from "@/lib/utils";
import SwapModal from "./SwapModal";

interface PricePanelProps {
  ticker: string;
  basePrice: number;
  buyQuotes: Quote[];
  sellQuotes: Quote[];
}

export default function PricePanel({ ticker, basePrice, buyQuotes, sellQuotes }: PricePanelProps) {
  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("100");
  const [swapOpen, setSwapOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

  const quotes = activeTab === "buy" ? buyQuotes : sellQuotes;
  const amountNum = parseFloat(amount) || 0;

  const handleTrade = (quote: Quote) => {
    setSelectedQuote(quote);
    setSwapOpen(true);
  };

  return (
    <>
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E2E8F0]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-lg">{ticker} Price Comparison</h2>
              <p className="text-sm text-[#64748B] mt-0.5">
                Real price: <span className="font-price font-medium text-[#0F172A]">${formatPrice(basePrice)}</span>
                <span className="ml-1 text-[#94A3B8]">(Yahoo Finance)</span>
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs text-[#94A3B8]">
              <div className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse"></div>
              Live
            </div>
          </div>

          {/* Buy / Sell tabs */}
          <div className="flex gap-1 bg-[#F1F5F9] p-1 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab("buy")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === "buy"
                  ? "bg-white text-[#0F172A] shadow-sm"
                  : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setActiveTab("sell")}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === "sell"
                  ? "bg-white text-[#0F172A] shadow-sm"
                  : "text-[#64748B] hover:text-[#0F172A]"
              }`}
            >
              Sell
            </button>
          </div>
        </div>

        {/* Amount input */}
        <div className="px-5 py-3 border-b border-[#F1F5F9] bg-[#F8FAFC]">
          <label className="text-xs text-[#64748B] mb-1.5 block">
            {activeTab === "buy" ? "Amount (USDC)" : "Amount (tokens)"}
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[#94A3B8]">{activeTab === "buy" ? "$" : ""}</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-price text-lg font-medium bg-transparent outline-none w-32"
            />
            <span className="text-sm text-[#94A3B8]">{activeTab === "buy" ? "USDC" : ticker}</span>
          </div>
        </div>

        {/* Quotes list */}
        <div className="divide-y divide-[#F1F5F9]">
          {quotes.map((quote, i) => {
            const totalCostBuy = amountNum * (1 + quote.protocolFee / 100) + quote.estimatedGas;
            const tokensReceived = amountNum / quote.price;
            const netSell = amountNum * quote.price * (1 - quote.protocolFee / 100) - quote.estimatedGas;

            return (
              <div
                key={`${quote.provider}-${quote.chain}`}
                className={`px-5 py-4 hover:bg-[#F8FAFC] transition-colors ${i === 0 ? "bg-[#EFF6FF]/50" : ""}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {i === 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] bg-[#EFF6FF] px-2 py-0.5 rounded-full">
                          <Zap className="w-3 h-3" />
                          Best
                        </span>
                      )}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getProviderColor(quote.type)}`}>
                        {quote.type === "issuer" ? "Issuer" : quote.type === "dex" ? "DEX" : "CEX"}
                      </span>
                      {quote.requiresKYC && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-[#94A3B8]">
                          <Shield className="w-3 h-3" />
                          KYC
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-medium text-[15px]">{quote.provider}</span>
                      <span className="text-xs text-[#94A3B8]">{quote.tokenName}</span>
                    </div>

                    <div className="flex items-center gap-3 mt-2 text-xs text-[#64748B]">
                      <span className="bg-[#F1F5F9] px-2 py-0.5 rounded">{quote.chain}</span>
                      <span>Fee: {quote.protocolFee}%</span>
                      {quote.estimatedGas > 0 && <span>Gas: ~${quote.estimatedGas.toFixed(2)}</span>}
                      {quote.liquidityUsd != null && (
                        <span className={`font-medium ${
                          quote.liquidityUsd >= 500_000 ? "text-[#16A34A]" :
                          quote.liquidityUsd >= 100_000 ? "text-[#D97706]" :
                          "text-[#DC2626]"
                        }`}>
                          Pool: {quote.liquidityUsd >= 1_000_000
                            ? `$${(quote.liquidityUsd / 1_000_000).toFixed(1)}M`
                            : quote.liquidityUsd >= 1_000
                            ? `$${(quote.liquidityUsd / 1_000).toFixed(0)}K`
                            : `$${quote.liquidityUsd.toFixed(0)}`}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-price text-[15px] font-semibold">${formatPrice(quote.price)}</p>
                    <p className={`text-xs font-medium mt-0.5 ${quote.premiumPercent <= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                      {formatPercent(quote.premiumPercent)}
                    </p>

                    {amountNum > 0 && (
                      <p className="text-xs text-[#64748B] mt-1.5">
                        {activeTab === "buy" ? (
                          <>Cost: <span className="font-price">${formatPrice(totalCostBuy)}</span></>
                        ) : (
                          <>Receive: <span className="font-price">${formatPrice(netSell)}</span></>
                        )}
                      </p>
                    )}

                    <div className="mt-2">
                      <button
                        onClick={() => handleTrade(quote)}
                        className="text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {activeTab === "buy" ? "Buy" : "Sell"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Swap Modal */}
      {selectedQuote && (
        <SwapModal
          isOpen={swapOpen}
          onClose={() => setSwapOpen(false)}
          action={activeTab}
          ticker={ticker}
          quote={selectedQuote}
          amount={amountNum}
          basePrice={basePrice}
        />
      )}
    </>
  );
}
