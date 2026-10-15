import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceMot, createMotEngine, defaultMotParams, scoreMotSelection } from '../src/pretests/main/motEngine.ts'
import { SubTaskQuestionBank, pickQuestions } from '../src/pretests/sub/SubTaskQuestionBank.ts'
import { N0_TIMING, n0MotParams, n0TriggerAt } from '../src/formal/n0Trial.ts'
import { N1_TIMING, n1MarkingDeadlineSeconds, toggleN1Marker } from '../src/formal/n1Trial.ts'
import { appendN3Frame, captureN3Context, n3BridgeOpacity, N3_BRIDGE_SECONDS, N3_HOLD_SECONDS, N3_SAMPLE_SECONDS } from '../src/formal/n3Trial.ts'
import { latestUniqueRecords, statsForRecord, upsertFormalRecord } from '../src/formal/resultRecords.ts'
import { currentSessionRecords, hasUnexportedRecords } from '../src/formal/sessionResults.ts'
import { C1_SCAN_DEFAULTS, c1TriggerAt, classifyScanClick, createC1ScanTrial, isInScan, isScanTargetEligible, scanOrigin, scanResult } from '../src/formal/c1RadarTrial.ts'

test('C1 moving scan uses fixed seeded targets and spatial capture windows', () => {
  const trial = createC1ScanTrial(123)
  assert.deepEqual(trial, createC1ScanTrial(123))
  assert.equal(trial.targets.length, 32)
  assert.equal(trial.targets.filter(target => target.kind === 'vehicle').length, 20)
  assert.equal(C1_SCAN_DEFAULTS.durationSeconds, 15)
  assert.ok(c1TriggerAt(123) >= 4 && c1TriggerAt(123) < 8)
  assert.ok(c1TriggerAt(123) + 1 + C1_SCAN_DEFAULTS.durationSeconds <= N0_TIMING.trackingSeconds - N0_TIMING.selectionWarningSeconds)
  assert.equal(scanOrigin(trial, 4).y, C1_SCAN_DEFAULTS.startY - 4 * C1_SCAN_DEFAULTS.speed)
  const first = trial.targets[1]
  assert.equal(isInScan(trial, first, 0), true)
  assert.equal(isInScan(trial, first, 6), false)
  assert.equal(classifyScanClick(trial, first, .5, []), 'capture')
  assert.equal(classifyScanClick(trial, first, .5, [first.id]), 'duplicate')
  assert.equal(classifyScanClick(trial, first, 6, []), 'outside')
  assert.equal(classifyScanClick(trial, trial.targets[21], 15, []), 'outside')
  const distractor = trial.targets.find(target => target.kind !== 'vehicle' && Array.from({ length: 151 }, (_, index) => index / 10).some(time => isInScan(trial, target, time)))
  assert.ok(distractor)
  const distractorTime = Array.from({ length: 151 }, (_, index) => index / 10).find(time => isInScan(trial, distractor, time))
  assert.equal(classifyScanClick(trial, distractor, distractorTime, []), 'wrong')
  const late = trial.targets[19]
  assert.equal(isInScan(trial, late, 0), false)
  assert.equal(isInScan(trial, late, 12), true)
  for (const target of trial.targets.filter(item => item.kind === 'vehicle')) {
    assert.ok(Array.from({ length: 151 }, (_, index) => index / 10).some(time => isInScan(trial, target, time)))
    const window = trial.plannedWindows.find(item => item.targetId === target.id)
    assert.ok(window && window.enteredAtSeconds !== null && window.exitedAtSeconds !== null)
    assert.ok(window.enteredAtSeconds < window.exitedAtSeconds)
  }
  for (const time of [0, 2, 4, 6, 8, 10, 12, 14]) {
    assert.ok(trial.targets.filter(target => target.kind === 'vehicle' && isInScan(trial, target, time)).length >= 2)
  }
  assert.ok(trial.plannedWindows.filter(item => item.exitedAtSeconds > 1).length > trial.plannedWindows.filter(item => item.exitedAtSeconds > 10).length)
  for (let index = 0; index < trial.targets.length; index++) {
    for (let other = index + 1; other < trial.targets.length; other++) {
      assert.ok(Math.hypot(trial.targets[index].x - trial.targets[other].x, trial.targets[index].y - trial.targets[other].y) >= 27.9)
    }
  }
  const outcome = scanResult(trial, 1000, 1000, 3000, 9000, [
    { targetId: first.id, atMs: 1200, elapsedSeconds: .2, result: 'capture' },
    { targetId: first.id, atMs: 1300, elapsedSeconds: .3, result: 'duplicate' },
    { targetId: trial.targets[21].id, atMs: 1400, elapsedSeconds: .4, result: 'wrong' },
  ], trial.targets.map(target => ({ targetId: target.id, enteredAtMs: null, exitedAtMs: null, capturedAtMs: null, missedAtMs: null })))
  assert.deepEqual([outcome.capturedCount, outcome.wrongCount, outcome.missedCount], [1, 1, 19])
  assert.equal(outcome.firstValidClickAtMs, 1200)
  assert.equal(outcome.captureAccuracy, .05)
  const stats = statsForRecord({ participantId: '001', trialId: '1', stage: 'two', conditionId: 'C1', completedAt: '', status: '已完成', mainTaskResult: '', subTaskResult: '', attentionReturnResult: '', c1Radar: outcome })
  assert.equal(stats.subTriggered, 1)
  assert.equal(stats.subCorrect, 1)
  assert.equal(stats.subWrong, 1)
  assert.equal(stats.subMissed, 19)
  assert.equal(stats.subAccuracy, .05)
  const custom = createC1ScanTrial(9, { targetCount: 2, vehicleCount: 1, speed: 20, halfAngleDegrees: 30, radius: 100, durationSeconds: 6, positions: [{ x: 150, y: 280, kind: 'vehicle' }, { x: 180, y: 210, kind: 'facility' }] })
  assert.equal(custom.targets.length, 2)
  assert.equal(scanOrigin(custom, 2).y, custom.params.startY - 40)
  assert.equal(createC1ScanTrial(9, { targetCount: 8, vehicleCount: 3 }).targets.filter(target => target.kind === 'vehicle').length, 3)
  for (const vehicles of [18, 24]) {
    const configured = createC1ScanTrial(123, { targetCount: vehicles + 15, vehicleCount: vehicles })
    assert.equal(configured.targets.length, vehicles + 15)
    assert.equal(configured.targets.filter(target => target.kind === 'vehicle').length, vehicles)
    assert.ok(configured.targets.filter(target => target.kind === 'vehicle').every(target => configured.plannedWindows.find(window => window.targetId === target.id)?.enteredAtSeconds !== null))
  }
})

test('C2 retains detected targets while C1 expires them after the same scan pass', () => {
  const c1 = createC1ScanTrial(4321)
  const c2 = createC1ScanTrial(4321, { targetRetention: true })
  assert.deepEqual(c2.targets, c1.targets)
  assert.deepEqual(c2.plannedWindows, c1.plannedWindows)
  const target = c2.targets[1]
  const window = c2.plannedWindows.find(item => item.targetId === target.id)
  assert.ok(window && window.enteredAtSeconds !== null && window.exitedAtSeconds !== null)
  const afterExit = window.exitedAtSeconds + .1
  assert.ok(afterExit < 15)
  assert.equal(isInScan(c2, target, afterExit), false)
  assert.equal(isScanTargetEligible(c2, target, afterExit, new Set()), false)
  assert.equal(isScanTargetEligible(c2, target, afterExit, new Set([target.id])), true)
  assert.equal(classifyScanClick(c1, target, afterExit, [], new Set([target.id])), 'outside')
  assert.equal(classifyScanClick(c2, target, afterExit, [], new Set([target.id])), 'capture')
  assert.equal(classifyScanClick(c2, target, afterExit, [target.id], new Set([target.id])), 'duplicate')
  const late = c2.targets.at(-5)
  assert.ok(late)
  assert.equal(isScanTargetEligible(c2, late, 0, new Set()), false)
  const outcome = scanResult(c2, 1000, 1000, 1700, 16700, [
    { targetId: target.id, atMs: 9000, elapsedSeconds: afterExit, result: 'capture' },
  ], c2.targets.map(item => ({ targetId: item.id, enteredAtMs: item.id === target.id ? 2000 : null, exitedAtMs: null, capturedAtMs: item.id === target.id ? 9000 : null, missedAtMs: item.kind === 'vehicle' && item.id !== target.id ? 16700 : null })))
  assert.equal(outcome.capturedCount, 1)
  assert.equal(outcome.missedCount, c2.params.vehicleCount - 1)
  assert.equal(outcome.targetTimings.find(item => item.targetId === target.id)?.finalState, 'captured')
})

test('C3 shares C1 high-sensitivity scan material and records presentation without a cue', () => {
  const c1 = createC1ScanTrial(9876)
  const c3 = createC1ScanTrial(9876, { targetRetention: false })
  assert.deepEqual(c3, c1)
  const target = c3.targets[1]
  const window = c3.plannedWindows.find(item => item.targetId === target.id)
  assert.ok(window && window.exitedAtSeconds !== null)
  assert.equal(classifyScanClick(c3, target, window.exitedAtSeconds + .1, []), 'outside')
  const outcome = scanResult(c3, 1000, null, 1650, 16650, [], c3.targets.map(item => ({ targetId: item.id, enteredAtMs: null, exitedAtMs: null, capturedAtMs: null, missedAtMs: null })), 1650, true)
  assert.equal(outcome.cueAtMs, null)
  assert.equal(outcome.presentedAtMs, 1000)
  assert.equal(outcome.workspaceExpansionStartedAtMs, 1000)
  assert.equal(outcome.workspaceFullyPresentedAtMs, 1650)
  assert.equal(outcome.formalStartedAtMs - outcome.triggeredAtMs, 650)
  assert.equal(outcome.params.durationSeconds, 15)
  assert.equal(outcome.missedCount, outcome.params.vehicleCount)
})

test('C4 combines C2 target retention with C3 direct presentation and keeps a separate result', () => {
  const seed = 9876
  const c2 = createC1ScanTrial(seed, { targetRetention: true })
  const c4 = createC1ScanTrial(seed, { targetRetention: true })
  assert.deepEqual(c4, c2)
  const target = c4.targets[1]
  const window = c4.plannedWindows.find(item => item.targetId === target.id)
  assert.ok(window && window.exitedAtSeconds !== null)
  const afterExit = window.exitedAtSeconds + .1
  assert.equal(isInScan(c4, target, afterExit), false)
  assert.equal(classifyScanClick(c4, target, afterExit, [], new Set([target.id])), 'capture')
  const click = { targetId: target.id, atMs: 9000, elapsedSeconds: afterExit, result: 'capture' }
  const outcome = scanResult(c4, 1000, null, 1650, 16650, [click], c4.targets.map(item => ({ targetId: item.id, enteredAtMs: item.id === target.id ? 2000 : null, exitedAtMs: null, capturedAtMs: item.id === target.id ? 9000 : null, missedAtMs: null })), 1650, true)
  assert.equal(outcome.cueAtMs, null)
  assert.equal(outcome.workspaceExpansionStartedAtMs, 1000)
  assert.equal(outcome.workspaceFullyPresentedAtMs, 1650)
  assert.equal(outcome.params.durationSeconds, 15)
  assert.equal(outcome.capturedCount, 1)
  assert.equal(outcome.missedCount, outcome.vehicleTargetCount - 1)
  const record = (conditionId, completedAt) => ({ participantId: '001', stage: 'two', conditionId, completedAt, trialId: '1', status: '已完成', mainTaskResult: '', subTaskResult: '', attentionReturnResult: '' })
  const records = ['C1', 'C2', 'C3', 'C4'].reduce((items, conditionId) => upsertFormalRecord(items, record(conditionId, '2026-01-01')), [])
  assert.equal(records.length, 4)
  assert.equal(upsertFormalRecord(records, record('C4', '2026-01-02')).length, 4)
})

test('same MOT seed and parameters reproduce targets and trajectories', () => {
  const params = { ...defaultMotParams, seed: 12345 }
  const first = createMotEngine(params, 800, 480)
  const second = createMotEngine(params, 800, 480)
  assert.deepEqual(first.targets, second.targets)
  assert.equal(first.targets.filter(target => target.isTarget).length, params.targets)
  for (let frame = 0; frame < 600; frame++) {
    advanceMot(first, params, 800, 480, 1 / 60)
    advanceMot(second, params, 800, 480, 1 / 60)
  }
  assert.deepEqual(first.targets, second.targets)
  assert.ok(first.targets.every(target => target.x >= params.diameter / 2 && target.x <= 800 - params.diameter / 2 && target.y >= params.diameter / 2 && target.y <= 480 - params.diameter / 2))
  const focus = first.targets.filter(target => target.isTarget)
  const distractor = first.targets.find(target => !target.isTarget)
  assert.deepEqual(scoreMotSelection(first.targets, [focus[0].id, focus[1].id, distractor.id]), { correct: 2, wrong: 1, missed: 2, total: 4 })
})

test('question bank covers all difficulties and balances answer positions', () => {
  assert.ok(SubTaskQuestionBank.length >= 10)
  for (const difficulty of ['简单', '中等', '困难']) assert.ok(SubTaskQuestionBank.some(item => item.difficulty === difficulty))
  const counts = { A: 0, B: 0, C: 0 }
  for (const question of SubTaskQuestionBank) counts[question.correctAnswer]++
  assert.deepEqual(counts, { A: 4, B: 4, C: 4 })
  assert.equal(pickQuestions('中等', 5, false).length, 5)
})

test('N0 UAV task occurs inside uninterrupted MOT tracking', () => {
  assert.equal(N0_TIMING.highlightSeconds, 3)
  assert.ok(N0_TIMING.subTaskLatestSeconds + N0_TIMING.subTaskLimitSeconds < N0_TIMING.trackingSeconds)
  assert.ok(N0_TIMING.subTaskLatestSeconds + N0_TIMING.subTaskLimitSeconds < N0_TIMING.trackingSeconds - N0_TIMING.selectionWarningSeconds)
  assert.notEqual(n0TriggerAt(9001), n0TriggerAt(1234))
  assert.ok(n0TriggerAt(9001) >= N0_TIMING.subTaskEarliestSeconds && n0TriggerAt(9001) < N0_TIMING.subTaskLatestSeconds)
  const params = n0MotParams(9001)
  assert.equal(params.speed, 45)
  assert.equal(params.movement, '直线运动')
  const engine = createMotEngine(params, 700, 440)
  let beforeTask, afterTask
  const start = Math.floor(n0TriggerAt(9001) * 60)
  for (let frame = 0; frame < N0_TIMING.trackingSeconds * 60; frame++) {
    advanceMot(engine, params, 700, 440, 1 / 60)
    if (frame === start) beforeTask = engine.targets.map(target => [target.x, target.y])
    if (frame === start + N0_TIMING.subTaskLimitSeconds * 60) afterTask = engine.targets.map(target => [target.x, target.y])
  }
  assert.notDeepEqual(beforeTask, afterTask)
})

test('formal results keep the latest result per participant, stage and condition', () => {
  const record = (participantId, stage, support, completedAt) => ({ participantId, stage, support, completedAt, trialId: '001', status: '已完成', mainTaskResult: '', subTaskResult: '', attentionReturnResult: '' })
  const first = record('001', 'one', 'N0', '2026-01-01T00:00:00Z')
  const updated = record('001', 'one', 'N0', '2026-01-02T00:00:00Z')
  const otherCondition = record('001', 'one', 'N1', '2026-01-03T00:00:00Z')
  const otherParticipant = record('002', 'one', 'N0', '2026-01-04T00:00:00Z')
  const otherStage = record('001', 'two', 'N0', '2026-01-05T00:00:00Z')
  const records = [first, otherCondition, otherParticipant, otherStage].reduce(upsertFormalRecord, [])
  const replaced = upsertFormalRecord(records, updated)
  assert.equal(replaced.length, 4)
  assert.ok(replaced.includes(updated))
  assert.ok(!replaced.includes(first))
  assert.equal(latestUniqueRecords([updated, first, otherCondition]).length, 2)
  assert.equal(latestUniqueRecords([updated, first])[0], updated)
  const n2 = record('001', 'one', 'N2', '2026-01-08T00:00:00Z')
  assert.equal(upsertFormalRecord(replaced, n2).length, 5)
  const n5 = { ...record('001', 'one', 'N5', '2026-01-09T00:00:00Z'), supportName: '迁移前 + 回归期支持' }
  const newerN5 = { ...n5, completedAt: '2026-01-10T00:00:00Z' }
  const withN5 = upsertFormalRecord(replaced, n5)
  assert.equal(withN5.length, 5)
  assert.deepEqual(upsertFormalRecord(withN5, newerN5).find(item => item.support === 'N5'), newerN5)
  const direct = { ...record('001', 'two', '', '2026-01-06T00:00:00Z'), intervention: '直接介入' }
  const guided = { ...record('001', 'two', '', '2026-01-07T00:00:00Z'), intervention: '注意引导' }
  assert.equal(upsertFormalRecord([direct], guided).length, 2)
})

test('one participant session accumulates its conditions and tracks newly unexported results', () => {
  const record = (participantId, conditionId, completedAt) => ({ participantId, stage: 'two', conditionId, completedAt, trialId: '1', status: '已完成', mainTaskResult: '', subTaskResult: '', attentionReturnResult: '' })
  const c1 = record('01', 'C1', '2026-01-01')
  const c2 = record('01', 'C2', '2026-01-02')
  const otherParticipant = record('02', 'C1', '2026-01-03')
  const current = currentSessionRecords([c1, c2, otherParticipant], ' 01 ')
  assert.deepEqual(current, [c1, c2])
  assert.deepEqual(currentSessionRecords([c1, c2, otherParticipant], ''), [])
  const exported = new Set([c1, c2])
  assert.equal(hasUnexportedRecords(current, exported), false)
  const updatedC1 = record('01', 'C1', '2026-01-04')
  const replaced = upsertFormalRecord(current, updatedC1)
  assert.equal(replaced.length, 2)
  assert.equal(hasUnexportedRecords(replaced, exported), true)
  exported.add(updatedC1)
  assert.equal(hasUnexportedRecords(replaced, exported), false)
})

test('N0 statistics distinguish wrong answers and timed-out omissions', () => {
  const base = { n0Metrics: { main: { correct: 3, wrong: 1, missed: 1, total: 4 }, selectionSeconds: 4.8, subTask: { taskId: 'ST-01', answer: 'A', correctAnswer: 'A', responseSeconds: 3.2, timedOut: false } } }
  const answered = statsForRecord(base)
  assert.equal(answered.mainAccuracy, .75)
  assert.equal(answered.selectionSeconds, 4.8)
  assert.equal(answered.subTriggered, 1)
  assert.equal(answered.subCorrect, 1)
  assert.equal(answered.subAverageResponseSeconds, 3.2)
  const omitted = statsForRecord({ ...base, n0Metrics: { ...base.n0Metrics, subTask: { ...base.n0Metrics.subTask, answer: null, responseSeconds: null, timedOut: true } } })
  assert.equal(omitted.subMissed, 1)
  assert.equal(omitted.subAccuracy, 0)
  assert.equal(omitted.subMissRate, 1)
  assert.equal(omitted.subAverageResponseSeconds, null)
  const threeEvents = statsForRecord({ ...base, subTaskEvents: [
    { taskId: '1', answer: 'A', correctAnswer: 'A', responseSeconds: 2.4, timedOut: false },
    { taskId: '2', answer: 'B', correctAnswer: 'B', responseSeconds: 4, timedOut: false },
    { taskId: '3', answer: null, correctAnswer: 'C', responseSeconds: null, timedOut: true },
  ] })
  assert.equal(threeEvents.subTriggered, 3)
  assert.equal(threeEvents.subCorrect, 2)
  assert.equal(threeEvents.subWrong, 0)
  assert.equal(threeEvents.subMissed, 1)
  assert.equal(threeEvents.subAccuracy, 2 / 3)
  assert.equal(threeEvents.subMissRate, 1 / 3)
  assert.equal(threeEvents.subAverageResponseSeconds, 3.2)
})

test('N1 optional marking and UAV judgment fit within the unchanged MOT duration', () => {
  for (const [markingStartedAt, remaining] of [[8, 8], [16, 8], [23, 1]]) {
    const deadline = n1MarkingDeadlineSeconds(markingStartedAt, N0_TIMING.trackingSeconds, remaining)
    assert.ok(deadline <= N0_TIMING.trackingSeconds - remaining)
    assert.ok(deadline <= markingStartedAt + N1_TIMING.markingWindowSeconds)
    assert.ok(deadline >= markingStartedAt)
  }
  const metrics = { main: { correct: 3, wrong: 1, missed: 1, total: 4 }, selectionSeconds: 4.1, subTask: { taskId: 'ST-01', answer: 'B', correctAnswer: 'A', responseSeconds: 2.3, timedOut: false } }
  const stats = statsForRecord({ motMetrics: metrics })
  assert.equal(stats.mainAccuracy, .75)
  assert.equal(stats.subWrong, 1)
  assert.equal(stats.subAverageResponseSeconds, 2.3)
})

test('N1 target marks toggle and never exceed four', () => {
  let marks = []
  for (const id of [1, 2, 3, 4]) marks = toggleN1Marker(marks, id, 4)
  assert.deepEqual(marks, [1, 2, 3, 4])
  assert.deepEqual(toggleN1Marker(marks, 5, 4), marks)
  marks = toggleN1Marker(marks, 2, 4)
  assert.deepEqual(marks, [1, 3, 4])
  assert.deepEqual(toggleN1Marker(marks, 5, 4), [1, 3, 4, 5])
})

test('N3 records each full path without tracked-target hints and fades from four to six seconds', () => {
  const engine = createMotEngine(n0MotParams(43), 800, 480)
  const context = captureN3Context(engine.targets, 800, 480)
  assert.equal(context.targets.length, 10)
  assert.deepEqual(context.targets.map(target => target.id), engine.targets.map(target => target.id))
  assert.ok(context.targets.every(target => Number.isFinite(target.x) && Number.isFinite(target.y)))
  assert.ok(context.targets.every(target => !Object.hasOwn(target, 'isTarget') && target.path.length === 1))
  const capturedX = context.targets[0].x
  engine.targets[0].x += 20
  assert.equal(context.targets[0].x, capturedX)
  appendN3Frame(context, engine.targets, 800, 480)
  engine.targets[0].x += 10
  appendN3Frame(context, engine.targets, 800, 480, true)
  assert.ok(context.targets.every(target => target.path.length === 3 && target.end !== null))
  assert.equal(context.targets[0].path[0].x, capturedX)
  assert.equal(context.targets[0].path[1].x, capturedX + 20)
  assert.equal(context.targets[0].end.x, capturedX + 30)
  assert.equal(context.width / context.height, 800 / 480)
  assert.equal(N3_SAMPLE_SECONDS, .1)
  assert.equal(n3BridgeOpacity(0), 1)
  assert.equal(n3BridgeOpacity(N3_HOLD_SECONDS), 1)
  assert.equal(n3BridgeOpacity(5), .5)
  assert.equal(n3BridgeOpacity(N3_BRIDGE_SECONDS), 0)
})
