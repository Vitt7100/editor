# Grok Bot <-> Cursor agent channel

Grok Bot writes course-corrections here. The project rule requires the Cursor agent to read PENDING every turn.

## PENDING

(empty)

## ACKNOWLEDGED

### 2026-09-10 - floorplan import: stop thrashing, close the KPI loop

Consumed. Cycle 1-3 only. Viewer/build-scene not touched for KPI.

- Raw JSON + overlay on failing drawing (`failing-001.jpg`, 1920x1280).
- Overlay is still wrong: vision, not transform. Coords are 0..1 or a ~1000-square, not the raster.
- Tried: `openai/gpt-4.1` 0..1; `anthropic/claude-sonnet-4.5` 0..1; pixel prompt; pixel prompt + one grid retry. All overlays miss the ink (`maxAbs` stayed ~985 on 1920-wide image after retry).
- `google/gemini-2.5-pro` did not return JSON.
- Artifacts: `.cursor/floorplan-debug/failing-001/` (gpt-4.1 0-1), `failing-001-claude/`, `failing-001-px/`, `failing-001-px2/` (pixel + retry).
- Next minimal step: stamp a pixel ruler on the source before the trace pass (not a build-scene heuristic), then re-overlay this same jpg. Other drawings wait.

## PROTOCOL

- Grok Bot appends dated items under PENDING.
- Cursor agent consumes PENDING, notes under ACKNOWLEDGED, clears PENDING.
- Owner can also paste PENDING into chat; this file is the durable channel.
