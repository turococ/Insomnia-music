import type { AccentId } from '@shared/types'

export interface AccentOption {
  id: AccentId
  label: string
  color: string
  soft: string
}

export const accents: AccentOption[] = [
  { id: 'lime', label: 'Lime', color: '#c7ff4a', soft: '#e4ffa3' },
  { id: 'violet', label: 'Violet', color: '#a78bfa', soft: '#c4b5fd' },
  { id: 'cyan', label: 'Cyan', color: '#22d3ee', soft: '#67e8f9' },
  { id: 'coral', label: 'Coral', color: '#fb7185', soft: '#fda4af' },
  { id: 'amber', label: 'Amber', color: '#fbbf24', soft: '#fcd34d' }
]

export function accentById(id: string): AccentOption {
  return accents.find((accent) => accent.id === id) ?? accents[0]
}
