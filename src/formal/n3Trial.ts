import type { MotTargetState } from '../pretests/main/motEngine.ts'

export const N3_BRIDGE_SECONDS = 6
export const N3_HOLD_SECONDS = 4
export const N3_SAMPLE_SECONDS = 0.1

type N3Point = { x: number; y: number }

export type N3Context = {
  width: number
  height: number
  targets: { id: number; x: number; y: number; path: N3Point[]; end: N3Point | null }[]
}

export function captureN3Context(targets: MotTargetState[], width: number, height: number): N3Context {
  return {
    width,
    height,
    targets: targets.map(({ id, x, y }) => ({ id, x, y, path: [{ x, y }], end: null })),
  }
}

export function appendN3Frame(context: N3Context, targets: MotTargetState[], width: number, height: number, finished = false) {
  const positions = new Map(targets.map(target => [target.id, target]))
  for (const trace of context.targets) {
    const target = positions.get(trace.id)
    if (!target) continue
    const point = { x: target.x * context.width / width, y: target.y * context.height / height }
    trace.path.push(point)
    if (finished) trace.end = point
  }
}

export function n3BridgeOpacity(elapsedSeconds: number) {
  if (elapsedSeconds <= N3_HOLD_SECONDS) return 1
  return Math.max(0, 1 - (elapsedSeconds - N3_HOLD_SECONDS) / (N3_BRIDGE_SECONDS - N3_HOLD_SECONDS))
}
