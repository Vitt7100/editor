import Link from 'next/link'
import { FloorplanImport } from '@/components/floorplan-import'
import { getConfiguredVisionProvider } from '@/lib/floorplan-import/vision'

export default function Home() {
  const provider = getConfiguredVisionProvider()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-border border-b">
        <div className="container mx-auto flex items-center justify-between gap-4 px-6 py-4">
          <p className="font-semibold">Pascal</p>
          <nav className="flex items-center gap-4 text-sm">
            <Link className="text-muted-foreground hover:text-foreground" href="/scenes">
              Scenes
            </Link>
            <Link className="text-muted-foreground hover:text-foreground" href="/new">
              Empty editor
            </Link>
          </nav>
        </div>
      </header>
      <main className="container mx-auto max-w-3xl px-6 py-16">
        <p className="text-muted-foreground text-sm uppercase tracking-wide">
          Local apartment studio
        </p>
        <h1 className="mt-2 font-bold text-4xl">Upload a plan. Get 3D.</h1>
        <p className="mt-3 mb-8 max-w-xl text-muted-foreground">
          Drop a BTI-style apartment drawing. We reconstruct rooms and walls in 3D,
          with the drawing on the floor. Ceiling height defaults to 2.7 m.
        </p>
        <FloorplanImport initialVision={{ visionConfigured: provider !== null, provider }} />
      </main>
    </div>
  )
}
