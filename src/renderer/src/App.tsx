import { useEffect } from 'react'
import { Route, Routes, useParams } from 'react-router-dom'
import type { CollectionKind } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { PlayerBar } from './features/player/PlayerBar'
import { QueuePanel } from './features/player/QueuePanel'
import { TrackContextMenu } from './features/player/TrackContextMenu'
import { usePlayer } from './features/player/store'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { ArtistSongsPage } from './pages/ArtistSongsPage'
import { CollectionPage } from './pages/CollectionPage'
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
  useEffect(() => {
    // Initialise the audio element and media session before the first track.
    const { volume, setVolume } = usePlayer.getState()
    setVolume(volume)
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="app-glow pointer-events-none absolute inset-x-0 top-0 h-64" />
          <TopBar />
          <main className="relative min-h-0 flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/album/:id" element={<CollectionRoute kind="album" />} />
              <Route path="/playlist/:id" element={<CollectionRoute kind="playlist" />} />
              <Route path="/artist/:id/songs" element={<ArtistSongsRoute />} />
              <Route path="/artist/:id" element={<CollectionRoute kind="artist" />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </div>
      <PlayerBar />
      <QueuePanel />
      <TrackContextMenu />
    </div>
  )
}

export default App
