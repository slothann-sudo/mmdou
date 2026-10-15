export type ScanTargetKind = 'vehicle' | 'facility' | 'distractor'
export type ScanTarget = { id: string; kind: ScanTargetKind; x: number; y: number }
export type ScanParams = {
  targetCount: number; vehicleCount: number; speed: number; halfAngleDegrees: number
  radius: number; durationSeconds: number; startX: number; startY: number; targetRetention: boolean
  positions?: { x: number; y: number; kind: ScanTargetKind }[]
}
export type ScanWindow = { targetId: string; enteredAtSeconds: number | null; exitedAtSeconds: number | null }
export type ScanTrial = { seed: number; params: ScanParams; targets: ScanTarget[]; plannedWindows: ScanWindow[] }
export type ScanClick = { targetId: string; atMs: number; elapsedSeconds: number; result: 'capture' | 'wrong' | 'outside' | 'duplicate' }
export type ScanTargetTiming = { targetId: string; enteredAtMs: number | null; exitedAtMs: number | null; capturedAtMs: number | null; missedAtMs: number | null; finalState?: 'unseen' | 'detected' | 'captured' | 'missed' }
export type ScanResult = {
  seed: number; params: ScanParams; targets: ScanTarget[]; plannedWindows: ScanWindow[]
  clockOriginEpochMs: number
  triggeredAtMs: number; presentedAtMs: number; cueAtMs: number | null; introEndedAtMs: number | null; formalStartedAtMs: number | null; enteredAtMs: number | null; firstClickAtMs: number | null; firstValidClickAtMs: number | null; endedAtMs: number
  workspaceExpansionStartedAtMs: number | null; workspaceFullyPresentedAtMs: number | null
  clicks: ScanClick[]; targetTimings: ScanTargetTiming[]
  capturedCount: number; wrongCount: number; missedCount: number; vehicleTargetCount: number; captureAccuracy: number
}

export const C1_SCAN_DEFAULTS: ScanParams = {
  targetCount: 32, vehicleCount: 20, speed: 15, halfAngleDegrees: 36,
  radius: 138, durationSeconds: 15, startX: 150, startY: 344, targetRetention: false,
}

// 30 秒 MOT 中为短动画和 15 秒扫描预留时间，避免次任务截断最终选择。
export function c1TriggerAt(seed: number) {
  const fraction = ((Math.imul(seed ^ 0x5f3759df, 1664525) + 1013904223) >>> 0) / 4294967296
  return 4 + fraction * 4
}

// 前段稍密、后段仍有目标。目标固定在地图上，仅扫描扇面前移。
const vehiclePositions = [
  [120, 299], [150, 299], [180, 299],
  [110, 267], [150, 267], [190, 267],
  [109, 235], [151, 235], [192, 235],
  [125, 203], [170, 203], [208, 203],
  [109, 171], [151, 171], [192, 171],
  [128, 139], [176, 139],
  [125, 70], [170, 70],
  [150, 35],
  [215, 139], [210, 70], [110, 35], [190, 35],
] as const

function densePositions(seed: number, vehicleCount: number, distractorCount: number) {
  const next = random(seed ^ 0x71b4a5d3)
  const selectedPositions = vehicleCount < 20
    ? [...vehiclePositions.slice(0, vehicleCount - 3), ...vehiclePositions.slice(17, 20)]
    : vehiclePositions.slice(0, vehicleCount)
  const source: { x: number; y: number; kind: ScanTargetKind }[] = selectedPositions.map(([x, y]) => ({ x: x + (next() - .5) * .8, y: y + (next() - .5) * .8, kind: 'vehicle' }))
  for (let index = 0; index < distractorCount; index++) {
    let placed = false
    for (let attempt = 0; attempt < 5000 && !placed; attempt++) {
      const x = 68 + next() * 164, y = 23 + next() * 300
      if (source.every(item => Math.hypot(item.x - x, item.y - y) >= 28)) {
        source.push({ x, y, kind: index % 2 ? 'distractor' : 'facility' })
        placed = true
      }
    }
    if (!placed) throw new Error('C1 scan targets cannot be placed without overlap')
  }
  return source
}

function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
}

export function createC1ScanTrial(seed: number, overrides: Partial<ScanParams> = {}): ScanTrial {
  const params = { ...C1_SCAN_DEFAULTS, ...overrides }
  if (params.targetCount < 1 || params.vehicleCount < 1 || params.vehicleCount > params.targetCount || params.speed <= 0 || params.radius <= 0 || params.durationSeconds <= 0 || params.halfAngleDegrees <= 0 || params.halfAngleDegrees >= 90) throw new Error('Invalid C1 scan parameters')
  const distractorCount = params.targetCount - params.vehicleCount
  const generated = [
    ...Array.from({ length: params.vehicleCount }, (_, index) => ({ x: index % 2 ? 174 : 132, y: params.vehicleCount === 1 ? 190 : 286 - index * 190 / (params.vehicleCount - 1), kind: 'vehicle' as const })),
    ...Array.from({ length: distractorCount }, (_, index) => ({ x: index % 2 ? 188 : 114, y: distractorCount === 1 ? 185 : 302 - index * 226 / (distractorCount - 1), kind: (index % 2 ? 'distractor' : 'facility') as ScanTargetKind })),
  ]
  const source = params.positions ?? (params.vehicleCount >= 18 && params.vehicleCount <= 24 && distractorCount >= 10 && distractorCount <= 15 ? densePositions(seed, params.vehicleCount, distractorCount) : generated)
  if (source.length !== params.targetCount || source.filter(item => item.kind === 'vehicle').length !== params.vehicleCount) throw new Error('C1 target positions do not match configured counts')
  const next = random(seed)
  const targets = source.map((item, index) => ({ id: `SCAN-${String(index + 1).padStart(2, '0')}`, kind: item.kind, x: item.x + (params.positions || source !== generated ? 0 : (next() - .5) * 12), y: item.y + (params.positions || source !== generated ? 0 : (next() - .5) * 8) }))
  return { seed, params, targets, plannedWindows: targets.map(target => plannedScanWindow(params, target)) }
}

export function plannedScanWindow(params: ScanParams, target: ScanTarget): ScanWindow {
  const lateral = Math.abs(target.x - params.startX)
  const maxForward = Math.sqrt(params.radius ** 2 - lateral ** 2)
  const minForward = lateral / Math.tan(params.halfAngleDegrees * Math.PI / 180)
  const first = Math.max(0, (params.startY - target.y - maxForward) / params.speed)
  const last = Math.min(params.durationSeconds, (params.startY - target.y - minForward) / params.speed)
  return { targetId: target.id, enteredAtSeconds: Number.isFinite(first) && first < last ? first : null, exitedAtSeconds: Number.isFinite(last) && first < last ? last : null }
}

export function scanOrigin(trial: ScanTrial, elapsedSeconds: number) {
  return { x: trial.params.startX, y: trial.params.startY - trial.params.speed * Math.max(0, elapsedSeconds) }
}

export function isInScan(trial: ScanTrial, target: Pick<ScanTarget, 'x' | 'y'>, elapsedSeconds: number) {
  const origin = scanOrigin(trial, elapsedSeconds)
  const forward = origin.y - target.y
  if (forward <= 0) return false
  const lateral = Math.abs(target.x - origin.x)
  return Math.hypot(lateral, forward) <= trial.params.radius && lateral <= forward * Math.tan(trial.params.halfAngleDegrees * Math.PI / 180)
}

export function isScanTargetEligible(trial: ScanTrial, target: ScanTarget, elapsedSeconds: number, detectedIds?: ReadonlySet<string>) {
  if (elapsedSeconds >= trial.params.durationSeconds) return false
  if (isInScan(trial, target, elapsedSeconds)) return true
  return trial.params.targetRetention && Boolean(detectedIds?.has(target.id))
}

export function classifyScanClick(trial: ScanTrial, target: ScanTarget, elapsedSeconds: number, capturedIds: readonly string[], detectedIds?: ReadonlySet<string>): ScanClick['result'] {
  if (!isScanTargetEligible(trial, target, elapsedSeconds, detectedIds)) return 'outside'
  if (capturedIds.includes(target.id)) return 'duplicate'
  return target.kind === 'vehicle' ? 'capture' : 'wrong'
}

export function scanResult(trial: ScanTrial, triggeredAtMs: number, cueAtMs: number | null, formalStartedAtMs: number | null, endedAtMs: number, clicks: ScanClick[], timings: ScanTargetTiming[], introEndedAtMs: number | null = formalStartedAtMs, workspaceExpansion = false): ScanResult {
  const captured = new Set(clicks.filter(click => click.result === 'capture').map(click => click.targetId))
  const targetById = new Map(trial.targets.map(target => [target.id, target]))
  const settledTimings = timings.map(timing => ({ ...timing, finalState: captured.has(timing.targetId) ? 'captured' as const : targetById.get(timing.targetId)?.kind === 'vehicle' ? 'missed' as const : timing.enteredAtMs === null ? 'unseen' as const : 'detected' as const }))
  return {
    seed: trial.seed, params: trial.params, targets: trial.targets, plannedWindows: trial.plannedWindows, clockOriginEpochMs: performance.timeOrigin, triggeredAtMs, presentedAtMs: triggeredAtMs, cueAtMs, introEndedAtMs, formalStartedAtMs, enteredAtMs: formalStartedAtMs, firstClickAtMs: clicks[0]?.atMs ?? null, firstValidClickAtMs: clicks.find(click => click.result === 'capture' || click.result === 'wrong')?.atMs ?? null, endedAtMs, workspaceExpansionStartedAtMs: workspaceExpansion ? triggeredAtMs : null, workspaceFullyPresentedAtMs: workspaceExpansion ? introEndedAtMs : null, clicks, targetTimings: settledTimings,
    capturedCount: captured.size,
    wrongCount: clicks.filter(click => click.result === 'wrong').length,
    missedCount: trial.targets.filter(target => target.kind === 'vehicle' && !captured.has(target.id)).length,
    vehicleTargetCount: trial.params.vehicleCount,
    captureAccuracy: captured.size / trial.params.vehicleCount,
  }
}
