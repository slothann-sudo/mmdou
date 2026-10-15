export function currentSessionRecords<T extends { participantId: string }>(records: readonly T[], participantId: string): T[] {
  const currentId = participantId.trim()
  return currentId ? records.filter(record => record.participantId.trim() === currentId) : []
}

export function hasUnexportedRecords<T extends object>(records: readonly T[], exported: ReadonlySet<T>): boolean {
  return records.some(record => !exported.has(record))
}
