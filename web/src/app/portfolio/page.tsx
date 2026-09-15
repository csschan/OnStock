import { fetchAllInstruments } from '@/lib/api'
import type { FlatInstrument } from '@/lib/api'
import PortfolioView from './PortfolioView'

export type TrackedInstrument = FlatInstrument

export default async function PortfolioPage() {
  let instruments: FlatInstrument[] = []
  try {
    instruments = await fetchAllInstruments()
  } catch {
    // API down — render with empty list, PortfolioView handles empty state
  }
  return <PortfolioView instruments={instruments} />
}
