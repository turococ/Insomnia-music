import type { AccentId } from '@shared/types'

export interface AccentOption {
  id: AccentId
  label: string
  color: string
  soft: string
  ink: string
}

export const accents: AccentOption[] = [
  { id: 'violet', label: 'Violet', color: '#a78bfa', soft: '#c4b5fd', ink: '#140f24' },
  { id: 'iris', label: 'Iris', color: '#818cf8', soft: '#a5b4fc', ink: '#0d1024' },
  { id: 'orchid', label: 'Orchid', color: '#d946ef', soft: '#e879f9', ink: '#1f071f' },
  { id: 'cyan', label: 'Cyan', color: '#22d3ee', soft: '#67e8f9', ink: '#06202a' },
  { id: 'coral', label: 'Coral', color: '#fb7185', soft: '#fda4af', ink: '#2a0a10' },
  { id: 'amber', label: 'Amber', color: '#fbbf24', soft: '#fcd34d', ink: '#241a00' }
]

export function accentById(id: string): AccentOption {
  return accents.find((accent) => accent.id === id) ?? accents[0]
}
