"use client";

import React, { useState } from "react";
import { ExternalLink, AlertTriangle, Layers, ChevronDown, ChevronUp } from "lucide-react";
import { Quote } from "@/lib/mock-data";
import { CHAIN_ID, KYBER_SUPPORTED_CHAINS, USDC_BY_CHAIN } from "@/lib/chains";
import SwapModal from "./SwapModal";
import type { PriceSource } from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RepresentationRow {
  issuer: string;
  chain: string;
  tokenSymbol: string;
  contractAddress?: string;
  dexPrice: number;
  premiumPct: number | null;
  liquidityUsd: number | null;
  chainId?: number;
}

interface AllMarketsTableProps {
  ticker: string;
  oraclePrice: number;
  representations: RepresentationRow[];
  priceSources?: PriceSource[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDepth(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function chainColor(chain: string): string {
  const colors: Record<string, string> = {
    ethereum: "bg-blue-500",
    bnb: "bg-yellow-400",
    solana: "bg-purple-500",
    base: "bg-blue-400",
    arbitrum: "bg-sky-500",
    "robinhood-chain": "bg-green-500",
  };
  return colors[chain] ?? "bg-slate-400";
}

function chainLabel(chain: string): string {
  const map: Record<string, string> = {
    ethereum: "Ethereum",
    bnb: "BNB Chain",
    solana: "Solana",
    base: "Base",
    arbitrum: "Arbitrum",
    "robinhood-chain": "Robinhood",
  };
  return map[chain] ?? chain;
}

function isSolanaOrRobinhood(chain: string): boolean {
  return chain === "solana" || chain === "robinhood-chain";
}

/** Check if a same-issuer cross-chain sibling exists for this row */
function hasBridgeAvailable(row: RepresentationRow, all: RepresentationRow[]): boolean {
  return all.some((r) => r.issuer === row.issuer && r.chain !== row.chain);
}

/** Build the best trade URL for this row — KyberSwap deep link > issuer app > fallback */
function buildTradeUrl(row: RepresentationRow): string {
  const chainSlug: Record<string, string> = {
    ethereum: "ethereum", bnb: "bnb", base: "base", arbitrum: "arbitrum",
  };
  const slug = chainSlug[row.chain];
  if (slug && row.contractAddress) {
    const chainId = row.chainId ?? CHAIN_ID[row.chain];
    const usdc = chainId ? USDC_BY_CHAIN[chainId] : null;
    if (usdc) {
      return `https://kyberswap.com/swap/${slug}?inputCurrency=${usdc}&outputCurrency=${row.contractAddress}`;
    }
  }
  // Fallback to issuer app (NOT marketing homepage)
  const appUrls: Record<string, string> = {
    ondo: "https://app.ondo.finance",
    backed: "https://app.backed.fi",
    dinari: "https://app.dinari.com",
    kraken: "https://trade.kraken.com",
    robinhood: "https://robinhood.com",
  };
  return appUrls[row.issuer] ?? "#";
}

function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    'kyberswap': 'KyberSwap',
    'uniswap-v3': 'Uniswap',
    'pancakeswap-v3': 'PancakeSwap',
    'jupiter': 'Jupiter',
    'robinhood': 'Robinhood',
    '1inch': '1inch',
  };
  return map[source] ?? source;
}

/** Convert RepresentationRow → Quote for SwapModal */
function rowToQuote(row: RepresentationRow): Quote {
  return {
    provider: row.issuer.charAt(0).toUpperCase() + row.issuer.slice(1),
    type: "issuer",
    tokenName: row.tokenSymbol,
    chain: chainLabel(row.chain),
    price: row.dexPrice,
    premiumPercent: row.premiumPct ?? 0,
    protocolFee: 0,
    estimatedGas: 0,
    canTradeInPlatform: true,
    tradeUrl: buildTradeUrl(row),
    requiresKYC: false,
    hasDividends: true,
    tokenAddress: row.contractAddress,
    chainId: row.chainId ?? CHAIN_ID[row.chain],
    liquidityUsd: row.liquidityUsd,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AllMarketsTable({ ticker, oraclePrice, representations, priceSources = [] }: AllMarketsTableProps) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<RepresentationRow | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  function toggleExpand(key: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Sort cheapest first (best buy at top)
  const sorted = [...representations].sort((a, b) => a.dexPrice - b.dexPrice);
  const bestRow = sorted[0];

  const issuers = new Set(sorted.map((r) => r.issuer));
  const chains = new Set(sorted.map((r) => r.chain));
  const totalLiquidity = sorted.reduce((sum, r) => sum + (r.liquidityUsd ?? 0), 0);
  const spread =
    sorted.length >= 2
      ? Math.abs(
          ((sorted[sorted.length - 1].dexPrice - sorted[0].dexPrice) /
            sorted[0].dexPrice) *
            10000
        )
      : 0;

  const handleBuy = (row: RepresentationRow) => {
    setSelectedRow(row);
    setSwapOpen(true);
  };

  if (representations.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-8 text-center text-[#94A3B8] text-sm">
        No market data available for {ticker}.
      </div>
    );
  }

  return (
    <>
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-base">All Markets</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              All tokenized representations of {ticker} across issuers and chains
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#94A3B8]">
            <div className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse" />
            Live
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="text-xs text-[#94A3B8] uppercase tracking-wider bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <th className="text-left px-5 py-3 font-medium">Representation</th>
                <th className="text-left px-4 py-3 font-medium">Chain</th>
                <th className="text-right px-4 py-3 font-medium">Price</th>
                <th className="text-right px-4 py-3 font-medium">vs Market</th>
                <th className="text-right px-4 py-3 font-medium">Depth</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const isBest = i === 0 && sorted.length > 1;
                const lowLiquidity =
                  row.liquidityUsd != null && row.liquidityUsd < 50_000;
                const bridgeAvailable = hasBridgeAvailable(row, sorted);
                const isExternal = isSolanaOrRobinhood(row.chain);
                const chainId = row.chainId ?? CHAIN_ID[row.chain];
                const canSwapInApp =
                  !isExternal &&
                  chainId != null &&
                  KYBER_SUPPORTED_CHAINS.has(chainId) &&
                  row.contractAddress != null;

                const rowKey = `${row.issuer}-${row.chain}-${row.tokenSymbol}`;
                const rowSources = priceSources.filter(
                  s => s.issuer === row.issuer && s.chain === row.chain
                );
                const hasMultipleSources = rowSources.length > 1;
                const isExpanded = expandedRows.has(rowKey);

                return (
                  <React.Fragment key={rowKey}>
                  <tr
                    className={`border-t border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors ${
                      isBest ? "bg-[#EFF6FF]/40" : ""
                    }`}
                  >
                    {/* Representation */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm capitalize">
                              {row.issuer}
                            </span>
                            {isBest && (
                              <span className="text-xs font-medium text-[#2563EB] bg-[#EFF6FF] border border-[#BFDBFE] px-1.5 py-0.5 rounded-full">
                                Best Buy
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[#94A3B8]">
                            {row.tokenSymbol}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Chain */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${chainColor(row.chain)}`}
                        />
                        <span className="text-sm text-[#0F172A]">
                          {chainLabel(row.chain)}
                        </span>
                      </div>
                    </td>

                    {/* Price */}
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="font-price text-sm font-semibold">
                          ${row.dexPrice.toFixed(2)}
                        </span>
                        {hasMultipleSources && (
                          <button
                            onClick={() => toggleExpand(rowKey)}
                            className="text-[#94A3B8] hover:text-[#64748B] transition-colors"
                            title={`${rowSources.length} DEX sources`}
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* vs Market */}
                    <td className="px-4 py-4 text-right">
                      {row.premiumPct != null ? (
                        <span
                          className={`text-xs font-semibold ${
                            row.premiumPct <= 0
                              ? "text-[#16A34A]"
                              : "text-[#DC2626]"
                          }`}
                        >
                          {row.premiumPct >= 0 ? "+" : ""}
                          {row.premiumPct.toFixed(2)}%
                        </span>
                      ) : (
                        <span className="text-xs text-[#94A3B8]">—</span>
                      )}
                    </td>

                    {/* Depth */}
                    <td className="px-4 py-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <span
                          className={`text-xs font-medium ${
                            row.liquidityUsd == null
                              ? "text-[#94A3B8]"
                              : lowLiquidity
                              ? "text-[#D97706]"
                              : row.liquidityUsd >= 500_000
                              ? "text-[#16A34A]"
                              : "text-[#64748B]"
                          }`}
                        >
                          {fmtDepth(row.liquidityUsd)}
                        </span>
                        {lowLiquidity && (
                          <AlertTriangle className="w-3 h-3 text-[#D97706]" />
                        )}
                      </div>
                    </td>

                    {/* Type badge */}
                    <td className="px-4 py-4">
                      {bridgeAvailable ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] px-2 py-0.5 rounded-full">
                          <Layers className="w-3 h-3" />
                          Bridge Available
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-full">
                          DEX
                        </span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-5 py-4 text-right">
                      {isExternal ? (
                        <a
                          href={
                            row.chain === "solana"
                              ? `https://jup.ag/swap/USDC-${row.tokenSymbol}`
                              : "https://robinhood.com"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Trade
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <button
                          onClick={() => handleBuy(row)}
                          className="text-xs font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Buy
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* Per-DEX source breakdown */}
                  {hasMultipleSources && isExpanded && (
                    <tr className="bg-[#F8FAFC]">
                      <td colSpan={7} className="px-5 py-2.5 border-t border-[#F1F5F9]">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="text-xs text-[#94A3B8] font-medium">DEX prices:</span>
                          {rowSources
                            .sort((a, b) => b.dexPrice - a.dexPrice)
                            .map(s => (
                              <span key={s.source} className="text-xs text-[#64748B]">
                                <span className="font-medium text-[#0F172A]">{sourceLabel(s.source)}</span>
                                {' '}<span className="font-price">${s.dexPrice.toFixed(2)}</span>
                              </span>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer summary row */}
        <div className="px-5 py-3 bg-[#F8FAFC] border-t border-[#E2E8F0] flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B]">
          <span>
            <span className="font-semibold text-[#0F172A]">{issuers.size}</span>{" "}
            issuer{issuers.size !== 1 ? "s" : ""}
          </span>
          <span className="text-[#CBD5E1]">·</span>
          <span>
            <span className="font-semibold text-[#0F172A]">{chains.size}</span>{" "}
            chain{chains.size !== 1 ? "s" : ""}
          </span>
          <span className="text-[#CBD5E1]">·</span>
          <span>
            <span className="font-semibold text-[#0F172A]">
              {fmtDepth(totalLiquidity)}
            </span>{" "}
            total liquidity
          </span>
          {sorted.length >= 2 && (
            <>
              <span className="text-[#CBD5E1]">·</span>
              <span>
                Spread:{" "}
                <span className="font-semibold text-[#0F172A]">
                  {spread.toFixed(0)} bps
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Swap Modal */}
      {selectedRow && (
        <SwapModal
          isOpen={swapOpen}
          onClose={() => setSwapOpen(false)}
          action="buy"
          ticker={ticker}
          quote={rowToQuote(selectedRow)}
          amount={0}
          basePrice={oraclePrice}
        />
      )}
    </>
  );
}
