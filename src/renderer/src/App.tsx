import { useEffect, useState } from 'react'
import { Route, Routes, useLocation, useParams } from 'react-router-dom'
import type { CollectionKind } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { PlayerBar } from './features/player/PlayerBar'
import { PlayerHotkeys } from './features/player/PlayerHotkeys'
import { QueuePanel } from './features/player/QueuePanel'
import { TrackContextMenu } from './features/player/TrackContextMenu'
import { PlaylistPicker } from './features/library/PlaylistPicker'
import { Toaster } from './features/toast/Toaster'
import { usePlayer } from './features/player/store'
import { MainScrollProvider } from './lib/mainScroll'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { ArtistSongsPage } from './pages/ArtistSongsPage'
import { CollectionPage } from './pages/CollectionPage'
import { NowPlayingPage } from './pages/NowPlayingPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'

function CollectionRoute({ kind }: { kind: CollectionKind }): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  return <CollectionPage key={`${kind}:${id ?? ''}`} kind={kind} />
}

function ArtistSongsRoute(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  return <ArtistSongsPage key={id ?? ''} />
}

function App(): React.JSX.Element {
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
  const { pathname } = useLocation()

  useEffect(() => {
    // Each route starts at the top, like a regular page navigation.
    scrollElement?.scrollTo({ top: 0 })
  }, [pathname, scrollElement])

  useEffect(() => {
    // Initialise the audio element and media session before the first track.
    const { volume, setVolume } = usePlayer.getState()
    setVolume(volume)
  }, [])

  useEffect(() => {
    return window.api.app.onPlayerCommand((command) => {
      const player = usePlayer.getState()
      if (command === 'toggle') player.toggle()
      else if (command === 'next') player.next()
      else player.previous()
    })
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="app-glow pointer-events-none absolute inset-x-0 top-0 h-64" />
          <TopBar />
          <main ref={setScrollElement} className="relative min-h-0 flex-1 overflow-y-auto">
            <MainScrollProvider value={scrollElement}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/album/:id" element={<CollectionRoute kind="album" />} />
                <Route path="/playlist/:id" element={<CollectionRoute kind="playlist" />} />
                <Route path="/now-playing" element={<NowPlayingPage />} />
                <Route path="/artist/:id/songs" element={<ArtistSongsRoute />} />
                <Route path="/artist/:id" element={<CollectionRoute kind="artist" />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </MainScrollProvider>
          </main>
        </div>
      </div>
      <PlayerBar />
      <QueuePanel />
      <TrackContextMenu />
      <PlaylistPicker />
      <Toaster />
      <PlayerHotkeys />
    </div>
  )
}

export default App
