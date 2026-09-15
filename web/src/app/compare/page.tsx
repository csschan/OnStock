"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchStocks, fetchStockPrices } from "@/lib/api";
import { POPULAR_STOCKS } from "@/lib/mock-data";
import { CHAIN_ID } from "@/lib/chains";
import type { RepresentationRow } from "@/components/AllMarketsTable";
import AllMarketsTable from "@/components/AllMarketsTable";
import { Search, X, Plus } from "lucide-react";

interface StockOption {
  ticker: string;
  company: string;
  sector: string;
}

interface LoadedStock {
  ticker: string;
  company: string;
  oraclePrice: number;
  representations: RepresentationRow[];
  loading: boolean;
}

const MAX_COMPARE = 3;

function TickerBadge({ ticker, company, onRemove }: { ticker: string; company: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl px-4 py-3">
      <div className="w-9 h-9 bg-white border border-[#BFDBFE] rounded-lg flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-[#2563EB]">{ticker}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#0F172A] truncate">{ticker}</p>
        <p className="text-xs text-[#64748B] truncate">{company}</p>
      </div>
      <button
        onClick={onRemove}
        className="text-[#94A3B8] hover:text-[#DC2626] transition-colors flex-shrink-0"
        title="Remove"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function AddTickerPanel({
  options,
  selected,
  onAdd,
}: {
  options: StockOption[];
  selected: string[];
  onAdd: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = options.filter(
    (o) =>
      !selected.includes(o.ticker) &&
      (o.ticker.toLowerCase().includes(query.toLowerCase()) ||
        o.company.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 border-2 border-dashed border-[#CBD5E1] rounded-xl px-4 py-3 text-sm text-[#94A3B8] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors w-full"
      >
        <Plus className="w-4 h-4" />
        Add stock to compare
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-10 overflow-hidden">
          <div className="p-3 border-b border-[#E2E8F0]">
            <div className="flex items-center gap-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
              <Search className="w-3.5 h-3.5 text-[#94A3B8] flex-shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ticker or company..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#CBD5E1]"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-[#94A3B8]">No stocks found</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.ticker}
                  onClick={() => {
                    onAdd(o.ticker);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F8FAFC] transition-colors text-left"
                >
                  <div className="w-7 h-7 bg-[#F1F5F9] rounded-md flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-[#334155]">{o.ticker}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{o.ticker}</p>
                    <p className="text-xs text-[#94A3B8]">{o.company}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const [options, setOptions] = useState<StockOption[]>([]);
  const [selected, setSelected] = useState<string[]>(["AAPL", "TSLA"]);
  const [stocks, setStocks] = useState<Map<string, LoadedStock>>(new Map());

  // Build options list from API + mock
  useEffect(() => {
    fetchStocks().then((apiStocks) => {
      const base = POPULAR_STOCKS.map((s) => ({
        ticker: s.ticker,
        company: s.company,
        sector: s.sector,
      }));
      if (apiStocks.length > 0) {
        const extra = apiStocks
          .filter((a) => !base.find((b) => b.ticker === a.ticker))
          .map((a) => ({ ticker: a.ticker, company: a.ticker, sector: "—" }));
        setOptions([...base, ...extra]);
      } else {
        setOptions(base);
      }
    });
  }, []);

  const loadStock = useCallback(async (ticker: string) => {
    setStocks((prev) => {
      const next = new Map(prev);
      next.set(ticker, {
        ticker,
        company: POPULAR_STOCKS.find((s) => s.ticker === ticker)?.company ?? ticker,
        oraclePrice: 0,
        representations: [],
        loading: true,
      });
      return next;
    });

    const { oraclePrice, buyQuotes } = await fetchStockPrices(ticker);
    const meta = POPULAR_STOCKS.find((s) => s.ticker === ticker);

    const representations: RepresentationRow[] = buyQuotes.map((q) => ({
      issuer: q.provider.toLowerCase(),
      chain: q.chain
        .toLowerCase()
        .replace(" chain", "")
        .replace("bnb chain", "bnb")
        .replace("robinhood chain", "robinhood-chain"),
      tokenSymbol: q.tokenName,
      contractAddress: q.tokenAddress,
      dexPrice: q.price,
      premiumPct: q.premiumPercent !== 0 ? q.premiumPercent : null,
      liquidityUsd: q.liquidityUsd ?? null,
      chainId: q.chainId ?? (q.chain ? CHAIN_ID[q.chain.toLowerCase().replace(" chain", "").replace("bnb chain", "bnb")] : undefined),
    }));

    setStocks((prev) => {
      const next = new Map(prev);
      next.set(ticker, {
        ticker,
        company: meta?.company ?? ticker,
        oraclePrice: oraclePrice ?? meta?.basePrice ?? 0,
        representations,
        loading: false,
      });
      return next;
    });
  }, []);

  // Load when selection changes
  useEffect(() => {
    for (const ticker of selected) {
      if (!stocks.has(ticker)) {
        loadStock(ticker);
      }
    }
  }, [selected, stocks, loadStock]);

  const addStock = (ticker: string) => {
    if (selected.length >= MAX_COMPARE) return;
    setSelected((prev) => [...prev, ticker]);
  };

  const removeStock = (ticker: string) => {
    setSelected((prev) => prev.filter((t) => t !== ticker));
    setStocks((prev) => {
      const next = new Map(prev);
      next.delete(ticker);
      return next;
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1">Compare Markets</h1>
        <p className="text-[#64748B]">
          Side-by-side view of tokenized representations across issuers and chains.
          Select up to {MAX_COMPARE} stocks.
        </p>
      </div>

      {/* Stock selector row */}
      <div
        className="grid gap-3 mb-10"
        style={{ gridTemplateColumns: `repeat(${MAX_COMPARE}, 1fr)` }}
      >
        {selected.map((ticker) => (
          <TickerBadge
            key={ticker}
            ticker={ticker}
            company={stocks.get(ticker)?.company ?? ticker}
            onRemove={() => removeStock(ticker)}
          />
        ))}
        {selected.length < MAX_COMPARE && (
          <AddTickerPanel options={options} selected={selected} onAdd={addStock} />
        )}
      </div>

      {/* Tables per selected stock */}
      <div className="space-y-10">
        {selected.map((ticker) => {
          const s = stocks.get(ticker);
          if (!s || s.loading) {
            return (
              <div key={ticker} className="bg-white border border-[#E2E8F0] rounded-xl p-8 flex items-center justify-center text-[#94A3B8]">
                <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mr-2" />
                Loading {ticker}...
              </div>
            );
          }
          return (
            <div key={ticker}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-[#F1F5F9] rounded-xl flex items-center justify-center">
                  <span className="text-sm font-bold text-[#334155]">{ticker}</span>
                </div>
                <div>
                  <h2 className="font-semibold text-base">{s.company}</h2>
                  {s.oraclePrice > 0 && (
                    <p className="text-xs text-[#94A3B8]">
                      Market price: <span className="font-price font-semibold text-[#0F172A]">${s.oraclePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </p>
                  )}
                </div>
                <a
                  href={`/asset/${ticker}`}
                  className="ml-auto text-xs text-[#2563EB] hover:underline"
                >
                  Full detail →
                </a>
              </div>
              <AllMarketsTable
                ticker={ticker}
                oraclePrice={s.oraclePrice}
                representations={s.representations}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
