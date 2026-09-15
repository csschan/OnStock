'use client'

import { useEffect, useState } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

interface Props {
  ticker: string
  initialPrice: number | null
}

export default function LivePriceBadge({ ticker, initialPrice }: Props) {
  const [price, setPrice] = useState(initialPrice)
  const [change, setChange] = useState<number | null>(null)
  const [lastUpdate, setLastUpdate] = useState(Date.now())

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/assets/${ticker}`)
        const json = await res.json()
        if (json.ok && json.data.marketPrice != null) {
          setPrice(json.data.marketPrice)
          setChange(json.data.change24h)
          setLastUpdate(Date.now())
        }
      } catch {}
    }

    const interval = setInterval(poll, 30_000)
    return () => clearInterval(interval)
  }, [ticker])

  const secsAgo = Math.floor((Date.now() - lastUpdate) / 1000)
  const freshness = secsAgo < 60 ? `${secsAgo}s ago` : `${Math.floor(secsAgo / 60)}m ago`

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs text-[#16A34A] bg-[#F0FDF4] border border-[#BBF7D0] px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 bg-[#16A34A] rounded-full animate-pulse inline-block" />
        Live · {freshness}
      </span>
      {change != null && (
        <span className={`text-xs font-medium ${change >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}% 24h
        </span>
      )}
    </div>
  )
}
