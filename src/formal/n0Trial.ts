import { defaultMotParams, type MotParams } from '../pretests/main/motEngine.ts'

export const N0_TIMING = {
  highlightSeconds: 3,
  trackingSeconds: 30,
  selectionWarningSeconds: 4,
  selectionWarningDurationSeconds: 1.6,
  answerFeedbackSeconds: 0.6,
  subTaskEarliestSeconds: 8,
  subTaskLatestSeconds: 16,
  subTaskLimitSeconds: 8,
} as const

export function n0MotParams(seed: number): MotParams {
  return { ...defaultMotParams, total: 10, targets: 4, speed: 45, movement: '直线运动', highlightSeconds: N0_TIMING.highlightSeconds, trackingSeconds: N0_TIMING.trackingSeconds, seed }
}

export function n0TriggerAt(seed: number) {
  const fraction = ((Math.imul(seed ^ 0x5f3759df, 1664525) + 1013904223) >>> 0) / 4294967296
  return N0_TIMING.subTaskEarliestSeconds + fraction * (N0_TIMING.subTaskLatestSeconds - N0_TIMING.subTaskEarliestSeconds)
}

export type N0SubTaskResult = {
  taskId: string
  answer: 'A' | 'B' | 'C' | null
  correctAnswer: 'A' | 'B' | 'C'
  responseSeconds: number | null
  timedOut: boolean
}
