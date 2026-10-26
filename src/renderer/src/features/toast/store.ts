import { create } from 'zustand'

export type ToastTone = 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

interface ToastState {
  toasts: ToastItem[]
  push: (message: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

let nextToastId = 0

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'success') => {
    const id = (nextToastId += 1)
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }].slice(-3) }))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
    }, 3200)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }))
}))

export function toast(message: string, tone: ToastTone = 'success'): void {
  useToasts.getState().push(message, tone)
}
