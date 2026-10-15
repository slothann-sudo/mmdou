export const N1_TIMING = {
  markingWindowSeconds: 6,
} as const

export function n1MarkingDeadlineSeconds(markingStartedAt: number, trackingSeconds: number, remainingSubTaskSeconds: number) {
  return Math.min(markingStartedAt + N1_TIMING.markingWindowSeconds, trackingSeconds - remainingSubTaskSeconds)
}

export function toggleN1Marker(markedTargets: number[], targetId: number, limit: number) {
  if (markedTargets.includes(targetId)) return markedTargets.filter(id => id !== targetId)
  return markedTargets.length < limit ? [...markedTargets, targetId] : markedTargets
}
