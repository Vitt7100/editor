import type { SceneGraph } from '@pascal-app/core/clone-scene-graph'

export function isFloorplanImportScene(graph: SceneGraph): boolean {
  return Object.values(graph.nodes).some((node) => {
    if (!node || typeof node !== 'object') return false
    const metadata = (node as { metadata?: unknown }).metadata
    if (!metadata || typeof metadata !== 'object') return false
    return (metadata as { source?: unknown }).source === 'floorplan-import'
  })
}

/** Drop slabs/ceilings so the drawing on the floor stays visible. */
export function withoutImportFloors(graph: SceneGraph): SceneGraph {
  const removed = new Set(
    Object.values(graph.nodes)
      .filter((node) => node?.type === 'slab' || node?.type === 'ceiling')
      .map((node) => node.id),
  )
  if (removed.size === 0) return graph
  const nodes = Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([id]) => !removed.has(id))
      .map(([id, node]) => {
        const children = (node as { children?: string[] }).children
        if (!children?.some((childId) => removed.has(childId))) return [id, node]
        return [id, { ...node, children: children.filter((childId) => !removed.has(childId)) }]
      }),
  )
  return { ...graph, nodes }
}
