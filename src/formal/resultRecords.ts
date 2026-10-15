import type { FormalRecord } from '../main'

export type SubTaskEvent = {
  taskId: string
  answer: 'A' | 'B' | 'C' | null
  correctAnswer: 'A' | 'B' | 'C'
  responseSeconds: number | null
  timedOut: boolean
}

export type FormalStats = {
  mainAccuracy: number | null
  mainCorrect: number | null
  mainWrong: number | null
  mainMissed: number | null
  selectionSeconds: number | null
  subTriggered: number | null
  subCorrect: number | null
  subWrong: number | null
  subMissed: number | null
  subAccuracy: number | null
  subMissRate: number | null
  subAverageResponseSeconds: number | null
}

const emptyStats: FormalStats = {
  mainAccuracy: null, mainCorrect: null, mainWrong: null, mainMissed: null, selectionSeconds: null,
  subTriggered: null, subCorrect: null, subWrong: null, subMissed: null,
  subAccuracy: null, subMissRate: null, subAverageResponseSeconds: null,
}

export function statsForRecord(record: FormalRecord): FormalStats {
  if (record.stats) return { ...emptyStats, ...record.stats }
  const metrics = record.motMetrics ?? record.n0Metrics
  if (record.c1Radar) {
    const scan = record.c1Radar
    const vehicleById = new Map(scan.targets.filter(target => target.kind === 'vehicle').map(target => [target.id, target]))
    const timings = new Map(scan.targetTimings.map(item => [item.targetId, item]))
    const reactionTimes = scan.clicks.filter(click => click.result === 'capture' && vehicleById.has(click.targetId)).map(click => {
      const entry = timings.get(click.targetId)?.enteredAtMs
      return entry === null || entry === undefined ? null : (click.atMs - entry) / 1000
    }).filter((value): value is number => value !== null && value >= 0)
    return {
      ...emptyStats,
      mainAccuracy: metrics?.main.total ? metrics.main.correct / metrics.main.total : null,
      mainCorrect: metrics?.main.correct ?? null, mainWrong: metrics?.main.wrong ?? null,
      mainMissed: metrics?.main.missed ?? null, selectionSeconds: metrics?.selectionSeconds ?? null,
      subTriggered: 1, subCorrect: scan.capturedCount, subWrong: scan.wrongCount,
      subMissed: scan.missedCount, subAccuracy: scan.capturedCount / scan.params.vehicleCount,
      subMissRate: scan.missedCount / scan.params.vehicleCount,
      subAverageResponseSeconds: reactionTimes.length ? reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length : null,
    }
  }
  if (!metrics && !record.subTaskEvents) return emptyStats
  const events = record.subTaskEvents ?? (metrics?.subTask ? [metrics.subTask] : [])
  const triggered = events.length
  const missed = events.filter(task => task.timedOut || task.answer === null).length
  const correct = events.filter(task => !task.timedOut && task.answer !== null && task.answer === task.correctAnswer).length
  const wrong = triggered - correct - missed
  const responseTimes = events.filter(task => !task.timedOut && task.answer !== null && task.responseSeconds !== null).map(task => task.responseSeconds as number)
  return {
    mainAccuracy: metrics?.main.total ? metrics.main.correct / metrics.main.total : null,
    mainCorrect: metrics?.main.correct ?? null, mainWrong: metrics?.main.wrong ?? null, mainMissed: metrics?.main.missed ?? null,
    selectionSeconds: metrics?.selectionSeconds ?? null,
    subTriggered: triggered, subCorrect: correct, subWrong: wrong, subMissed: missed,
    subAccuracy: triggered ? correct / triggered : null,
    subMissRate: triggered ? missed / triggered : null,
    subAverageResponseSeconds: responseTimes.length ? responseTimes.reduce((sum, seconds) => sum + seconds, 0) / responseTimes.length : null,
  }
}

export function resultCondition(record: FormalRecord) {
  if (!record.stage) return [record.intervention, record.modality, record.support].filter(Boolean).join(' · ') || '未标明'
  if (record.stage === 'two') return record.conditionId || [record.support || '', record.intervention || ''].filter(Boolean).join(' · ') || '未标明'
  return record.support || record.intervention || record.modality || '未标明'
}

export function resultKey(record: FormalRecord) {
  return [record.participantId.trim(), record.stage || 'legacy', resultCondition(record)].join('\u001f')
}

export function upsertFormalRecord(records: FormalRecord[], incoming: FormalRecord) {
  const key = resultKey(incoming)
  return [...records.filter(record => resultKey(record) !== key), incoming]
}

export function latestUniqueRecords(records: FormalRecord[]) {
  const latest = new Map<string, FormalRecord>()
  for (const record of records) {
    const key = resultKey(record)
    const previous = latest.get(key)
    if (!previous || record.completedAt >= previous.completedAt) latest.set(key, record)
  }
  return [...latest.values()].sort((first, second) => second.completedAt.localeCompare(first.completedAt))
}

export function formatRate(value: number | null) {
  return value === null ? '—' : `${Number((value * 100).toFixed(1))}%`
}

export function formatSeconds(value: number | null) {
  return value === null ? '—' : `${Number(value.toFixed(1))} s`
}
