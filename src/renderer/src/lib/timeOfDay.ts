import { useEffect, useState } from 'react'

export type DayPeriod = 'night' | 'morning' | 'afternoon' | 'evening'

export function periodFor(date: Date): DayPeriod {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

export function greetingFor(period: DayPeriod): string {
  switch (period) {
    case 'night':
      return 'Good night'
    case 'morning':
      return 'Good morning'
    case 'afternoon':
      return 'Good afternoon'
    case 'evening':
      return 'Good evening'
  }
}

export function useDayPeriod(): DayPeriod {
  const [period, setPeriod] = useState<DayPeriod>(() => periodFor(new Date()))

  useEffect(() => {
    const interval = window.setInterval(() => setPeriod(periodFor(new Date())), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  return period
}
