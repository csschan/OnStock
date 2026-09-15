// DEX API 代理 — 解决浏览器 CORS 问题
// 前端调用 /api/dex-proxy?url=<encoded_url> 代替直接调用第三方 API

import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_HOSTS = [
  'aggregator-api.kyberswap.com',
  'api.odos.xyz',
  'apiv5.paraswap.io',
]

function isAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h))
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get('url')
  if (!targetUrl || !isAllowed(targetUrl)) {
    return NextResponse.json({ error: 'Invalid or disallowed URL' }, { status: 400 })
  }

  try {
    const res = await fetch(targetUrl, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Proxy fetch failed' }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get('url')
  if (!targetUrl || !isAllowed(targetUrl)) {
    return NextResponse.json({ error: 'Invalid or disallowed URL' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Proxy fetch failed' }, { status: 502 })
  }
}
