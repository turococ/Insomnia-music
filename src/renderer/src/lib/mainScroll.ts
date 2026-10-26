import { createContext, useContext } from 'react'

const MainScrollContext = createContext<HTMLElement | null>(null)

export const MainScrollProvider = MainScrollContext.Provider

export function useMainScroll(): HTMLElement | null {
  return useContext(MainScrollContext)
}
