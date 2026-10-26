import { useEffect } from 'react'
import { useAuth } from '@renderer/features/auth/context'
import { useLikes } from '@renderer/features/library/likes'
import { useTrackMenu } from './menu'
import { usePlayer } from './store'

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, a, [role="button"], [role="slider"], [role="switch"]'))
  )
}

/**
 * Global media shortcuts. They are ignored while typing or while a native
 * control already handles the key, so search and forms keep working normally.
 */
export function PlayerHotkeys(): null {
  const { status } = useAuth()
  const authenticated = Boolean(status?.authenticated)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      if (useTrackMenu.getState().item) return

      const player = usePlayer.getState()
      const seekable = Boolean(player.current) && !player.isLive
      const repeatable = event.code.startsWith('Arrow')
      if (event.repeat && !repeatable) return

      switch (event.code) {
        case 'Space':
          if (!player.current || isInteractiveTarget(event.target)) return
          event.preventDefault()
          player.toggle()
          return
        case 'ArrowRight':
          if (!player.current) return
          event.preventDefault()
          if (event.shiftKey) player.next()
          else if (seekable) player.seek(player.progress + 5)
          return
        case 'ArrowLeft':
          if (!player.current) return
          event.preventDefault()
          if (event.shiftKey) player.previous()
          else if (seekable) player.seek(player.progress - 5)
          return
        case 'ArrowUp':
          event.preventDefault()
          player.setVolume(player.volume + 0.05)
          return
        case 'ArrowDown':
          event.preventDefault()
          player.setVolume(player.volume - 0.05)
          return
        case 'KeyM':
          player.toggleMute()
          return
        case 'KeyS':
          player.toggleShuffle()
          return
        case 'KeyR':
          player.cycleRepeat()
          return
        case 'KeyQ':
          player.toggleQueue()
          return
        case 'KeyL':
          if (!player.current || !authenticated) return
          void useLikes.getState().toggle(player.current)
          return
        case 'Escape':
          if (!player.queueOpen) return
          event.preventDefault()
          player.setQueueOpen(false)
          return
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [authenticated])

  return null
}
