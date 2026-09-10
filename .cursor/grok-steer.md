# Grok Bot <-> Cursor agent channel

Grok Bot writes course-corrections here. The project rule requires the Cursor agent to read PENDING every turn.

## PENDING

(empty)

## ACKNOWLEDGED

### 2026-09-10 - import UX copy (no keys in UI)

Consumed from Grok Bot chat. User-facing unconfigured copy has no API key. Height 2.0–4.5 validated before submit (API rejects, no silent clamp). Spinner + STAGE_LABELS. Doors counted only when > 0.

### 2026-09-10 - drop pixel-ruler; ship coord remap first

Consumed from Grok Bot chat. Pixel-ruler rabbit hole stopped.

- Hypothesis confirmed: overlay/build-scene only remapped 0..1, so maxAbs≈985 on 1920×1280 stayed left-aligned.
- Shipped shared `normalizeFloorplanCoords` (0..1, ~1000-square, pixels) used by overlay + build-scene.
- Fixture `unit1000-1920x1280.json` + unit tests prove remapped polygons land on the 1920×1280 raster.
- Live vision still needs local `OPENROUTER_API_KEY`; not invented here.

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
