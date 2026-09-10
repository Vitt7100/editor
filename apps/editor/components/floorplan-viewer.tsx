'use client'

import {
  acquireSceneReadOnlyLease,
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'
import { useViewer, Viewer } from '@pascal-app/viewer'
import { CameraControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box3, type Object3D } from 'three'
import type { SceneMeta } from '@/components/scene-loader'
import { withoutImportFloors } from '@/lib/floorplan-import/is-import-scene'

type CameraControlsImpl = {
  fitToBox: (
    target: Object3D,
    enableTransition: boolean,
    options?: {
      paddingTop?: number
      paddingBottom?: number
      paddingLeft?: number
      paddingRight?: number
    },
  ) => Promise<unknown>
  rotateTo: (azimuthAngle: number, polarAngle: number, enableTransition?: boolean) => Promise<unknown>
}

function AutoFit({ targetId, trigger }: { targetId: string | null; trigger: number }) {
  const controls = useThree((state) => state.controls) as CameraControlsImpl | null
  const lastFitRef = useRef(-1)

  useEffect(() => {
    if (!controls || !targetId || trigger === lastFitRef.current) return
    let cancelled = false
    let attempts = 0

    const tryFit = () => {
      if (cancelled) return
      const target = sceneRegistry.nodes.get(targetId)
      if (target) {
        const box = new Box3().setFromObject(target)
        if (!box.isEmpty()) {
          void controls.fitToBox(target, false, {
            paddingTop: 1.1,
            paddingBottom: 1.1,
            paddingLeft: 1.1,
            paddingRight: 1.1,
          }).then(() => {
            void controls.rotateTo(Math.PI / 5, Math.PI / 3.1, false)
          })
          lastFitRef.current = trigger
          return
        }
      }
      attempts += 1
      if (attempts < 30) requestAnimationFrame(tryFit)
    }

    tryFit()
    return () => {
      cancelled = true
    }
  }, [trigger, targetId, controls])

  return null
}

export function FloorplanViewer({
  initialScene,
  meta,
}: {
  initialScene: SceneGraph
  meta: SceneMeta
}) {
  const setScene = useScene((state) => state.setScene)
  const setSelection = useViewer((state) => state.setSelection)
  const [fitTrigger, setFitTrigger] = useState(0)
  const displayScene = useMemo(() => withoutImportFloors(initialScene), [initialScene])
  const levelId =
    (Object.values(displayScene.nodes).find((node) => node.type === 'level')?.id as string | undefined) ??
    null

  useEffect(() => {
    const releaseReadOnly = acquireSceneReadOnlyLease()
    const viewer = useViewer.getState()
    viewer.setWallMode('translucent')
    viewer.setShowGuides(true)
    viewer.setShowZones(false)
    viewer.setLevelMode('stacked')

    setScene(
      displayScene.nodes as Record<AnyNodeId, AnyNode>,
      displayScene.rootNodeIds as AnyNodeId[],
      { collections: displayScene.collections },
    )
    const nodes = Object.values(displayScene.nodes) as AnyNode[]
    const building = nodes.find((node) => node.type === 'building')
    const level = nodes.find((node) => node.type === 'level')
    setSelection({
      buildingId: (building?.id ?? null) as never,
      levelId: (level?.id ?? null) as never,
      zoneId: null,
      selectedIds: [],
    })
    return releaseReadOnly
  }, [displayScene, setScene, setSelection])

  return (
    <div className="relative h-screen w-screen bg-[#fafafa]">
      <header className="pointer-events-none absolute top-0 right-0 left-0 z-20 flex items-center justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link
            className="rounded-md border border-border bg-background/90 px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur hover:bg-accent/40"
            href="/"
          >
            New plan
          </Link>
          <Link
            className="rounded-md border border-border bg-background/90 px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur hover:bg-accent/40"
            href="/scenes"
          >
            All scenes
          </Link>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <p className="hidden max-w-xs truncate rounded-md bg-background/80 px-3 py-1.5 text-xs shadow-sm sm:block">
            {meta.name}
          </p>
          <Link
            className="rounded-md border border-border bg-background/90 px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur hover:bg-accent/40"
            href={`/scene/${meta.id}?edit=1`}
          >
            Open editor
          </Link>
        </div>
      </header>
      <p className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border/60 bg-background/85 px-3 py-1 text-muted-foreground text-xs shadow-sm">
        Drag to orbit · scroll to zoom · drawing is on the floor
      </p>
      <Viewer
        onSceneReadyChange={(ready) => {
          if (ready) setFitTrigger((value) => value + 1)
        }}
        renderContext="viewer"
        sceneReadyKey={meta.id}
      >
        <CameraControls makeDefault maxDistance={80} minDistance={2} />
        <AutoFit targetId={levelId} trigger={fitTrigger} />
      </Viewer>
    </div>
  )
}

