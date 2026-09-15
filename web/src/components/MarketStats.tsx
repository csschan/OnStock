import { BarChart3, Wallet, Layers, Activity } from "lucide-react";

const stats = [
  { label: "Tokenized Stock TVL", value: "$1.6B", icon: BarChart3 },
  { label: "24h Volume", value: "$89M", icon: Activity },
  { label: "Active Tokens", value: "800+", icon: Layers },
  { label: "Channels", value: "12", icon: Wallet },
];

export default function MarketStats() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className="w-4 h-4 text-[#94A3B8]" />
            <span className="text-xs text-[#64748B]">{stat.label}</span>
          </div>
          <p className="font-price text-xl font-semibold">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
