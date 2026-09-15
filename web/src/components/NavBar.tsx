'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'

const MultiChainButton = dynamic(() => import('./MultiChainButton'), { ssr: false })

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Markets',   href: '/markets' },
  { label: 'Earn',      href: '/earn' },
  { label: 'Intent',    href: '/intent' },
  { label: 'Portfolio Builder', href: '/portfolio-builder' },
  { label: 'Arbitrage', href: '/arbitrage' },
  { label: 'Portfolio', href: '/portfolio' },
]

export default function NavBar() {
  const pathname = usePathname()

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 50, background: '#fff', borderBottom: '1px solid #E2E8F0' }}>
      <div className="max-w-6xl mx-auto px-4">
        <div className="h-16 flex items-center gap-6">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 bg-[#2563EB] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">OS</span>
            </div>
            <span className="font-bold text-lg tracking-tight text-[#0F172A]">OnStock</span>
          </Link>

          {/* Nav links */}
          <nav className="flex items-center h-full flex-1 gap-1">
            {NAV_ITEMS.map(item => {
              const isActive = item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    position: 'relative',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: isActive ? '#2563EB' : '#64748B',
                    textDecoration: 'none',
                  }}
                >
                  {item.label}
                  {isActive && (
                    <span style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 16,
                      right: 16,
                      height: 2,
                      background: '#2563EB',
                      borderRadius: '2px 2px 0 0',
                    }} />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Multi-chain wallet */}
          <div className="flex-shrink-0">
            <MultiChainButton />
          </div>
        </div>
      </div>
    </header>
  )
}
