import { DISCOUNT_STOCKS } from "@/lib/mock-data";
import { ArrowDown } from "lucide-react";

export default function DiscountList() {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E2E8F0]">
        <h2 className="font-semibold text-base">Biggest Discounts</h2>
        <p className="text-xs text-[#94A3B8] mt-0.5">Buy below real stock price</p>
      </div>
      <div className="divide-y divide-[#F1F5F9]">
        {DISCOUNT_STOCKS.map((item, i) => (
          <a
            key={item.ticker}
            href={`/asset/${item.ticker}`}
            className="flex items-center justify-between px-5 py-3 hover:bg-[#F8FAFC] transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#94A3B8] w-5">{i + 1}</span>
              <span className="font-medium text-sm">{item.ticker}</span>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-[#16A34A]">
              <ArrowDown className="w-3.5 h-3.5" />
              {item.discount}%
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
