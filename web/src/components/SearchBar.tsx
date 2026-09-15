"use client";

import { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type { AssetSearchResult } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AssetSearchResult[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/assets/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setResults(json.ok ? json.data : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [query]);

  return (
    <div className="relative w-full max-w-xl mx-auto">
      <div className={`flex items-center border rounded-xl px-4 py-3 bg-white transition-all ${isFocused ? "border-[#2563EB] shadow-[0_0_0_3px_rgba(37,99,235,0.1)]" : "border-[#E2E8F0]"}`}>
        <Search className="w-5 h-5 text-[#94A3B8] mr-3 flex-shrink-0" />
        <input
          type="text"
          placeholder="Search by ticker or company name..."
          className="w-full outline-none text-[15px] placeholder:text-[#94A3B8]"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
        />
        {loading && (
          <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin flex-shrink-0" />
        )}
      </div>

      {isFocused && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#E2E8F0] rounded-xl shadow-lg overflow-hidden z-50">
          {results.map((asset) => (
            <a
              key={asset.ticker}
              href={`/asset/${asset.ticker}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-[#F8FAFC] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#F1F5F9] rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="font-semibold text-sm text-[#334155]">{asset.ticker}</span>
                </div>
                <div>
                  <p className="font-medium text-sm">{asset.name}</p>
                  <p className="text-xs text-[#94A3B8]">{asset.sector}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                {asset.marketPrice ? (
                  <span className="font-price text-sm font-medium">${asset.marketPrice.toFixed(2)}</span>
                ) : (
                  <span className="text-xs text-[#94A3B8]">—</span>
                )}
                {asset.tradeableCount > 0 && (
                  <p className="text-xs text-[#16A34A] mt-0.5">{asset.tradeableCount} routes</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}

      {isFocused && query.trim() && !loading && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#E2E8F0] rounded-xl shadow-lg overflow-hidden z-50">
          <div className="px-4 py-3 text-sm text-[#94A3B8] text-center">
            No assets found for &quot;{query}&quot;
          </div>
        </div>
      )}
    </div>
  );
}
