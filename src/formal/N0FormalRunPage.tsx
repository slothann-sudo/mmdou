import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { FormalRecord, FormalSession, Platform } from '../main'
import { advanceMot, createMotEngine, scoreMotSelection, type MotEngine, type MotParams, type MotTargetState } from '../pretests/main/motEngine'
import { SubTaskQuestionBank, type Answer, type SubTaskQuestion } from '../pretests/sub/SubTaskQuestionBank'
import { N0Workspace, type N0Phase, type N0TaskStatus } from './N0Workspace'
import { N0_TIMING, n0MotParams, n0TriggerAt, type N0SubTaskResult } from './n0Trial'
import { n1MarkingDeadlineSeconds, toggleN1Marker } from './n1Trial'
import { appendN3Frame, captureN3Context, n3BridgeOpacity, N3_BRIDGE_SECONDS, N3_SAMPLE_SECONDS, type N3Context } from './n3Trial'
import { statsForRecord, upsertFormalRecord } from './resultRecords'
import { C1_SCAN_DEFAULTS, c1TriggerAt, classifyScanClick, createC1ScanTrial, isInScan, scanResult, type ScanClick, type ScanResult, type ScanTargetTiming, type ScanTrial } from './c1RadarTrial'

type ScanRuntime = {
  trial: ScanTrial; triggeredAtMs: number; cueAtMs: number | null; introEndedAtMs: number | null; formalStartedAtMs: number | null
  pausedDurationMs: number; pausedDurationAtStartMs: number; pausedAtMs: number | null; lastInside: Set<string>
  detectedIds: Set<string>; timings: ScanTargetTiming[]; clicks: ScanClick[]; capturedIds: string[]; ended: boolean
}

export function N0FormalRunPage({ state, setState, session }: Platform & { session: FormalSession }) {
  const navigate = useNavigate()
  const isN1 = session.conditions.support === 'N1'
  const isN2 = session.conditions.support === 'N2'
  const isN3 = session.conditions.support === 'N3'
  const isN4 = session.conditions.support === 'N4'
  const isN5 = session.conditions.support === 'N5'
  const isRadar = session.stage === 'two' && (
    session.conditions.conditionId === 'C1' && session.conditions.intervention === 'S1' && session.conditions.timeSensitivity === 'T1' ||
    session.conditions.conditionId === 'C2' && session.conditions.intervention === 'S1' && session.conditions.timeSensitivity === 'T2' ||
    session.conditions.conditionId === 'C3' && session.conditions.intervention === 'S2' && session.conditions.timeSensitivity === 'T1' ||
    session.conditions.conditionId === 'C4' && session.conditions.intervention === 'S2' && session.conditions.timeSensitivity === 'T2'
  )
  const isLowSensitivity = isRadar && session.conditions.timeSensitivity === 'T2'
  const isGuided = isRadar && session.conditions.intervention === 'S1'
  const isDirect = isRadar && session.conditions.intervention === 'S2'
  const hasMarker = isN1 || isN4 || isN5 || isRadar
  const hasPersistentMarks = isN4 || isN5 || isRadar
  const hasReturnBridge = isN3 || isN4 || isN5
  const [phase, setPhase] = useState<N0Phase>(session.status === '已完成' ? 'completed' : 'idle')
  const [paused, setPaused] = useState(false)
  const [confirmReturnOpen, setConfirmReturnOpen] = useState(false)
  const [targets, setTargets] = useState<MotTargetState[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [markedTargets, setMarkedTargets] = useState<number[]>([])
  const [persistentMarkedTargetIds, setPersistentMarkedTargetIds] = useState<number[]>([])
  const [n3Context, setN3Context] = useState<N3Context | null>(null)
  const [memoryCountdown, setMemoryCountdown] = useState<number>(N0_TIMING.highlightSeconds)
  const [selectionWarning, setSelectionWarning] = useState(false)
  const [taskStatus, setTaskStatus] = useState<N0TaskStatus>('standby')
  const [taskQuestion, setTaskQuestion] = useState<SubTaskQuestion>(SubTaskQuestionBank[3])
  const [taskAnswer, setTaskAnswer] = useState<Answer | null>(null)
  const [taskRemaining, setTaskRemaining] = useState<number>(N0_TIMING.subTaskLimitSeconds)
  const [subTaskResult, setSubTaskResult] = useState<N0SubTaskResult | null>(null)
  const [scanTrial, setScanTrial] = useState<ScanTrial | null>(null)
  const [scanPreparing, setScanPreparing] = useState(false)
  const [scanElapsed, setScanElapsed] = useState(0)
  const [scanCapturedIds, setScanCapturedIds] = useState<string[]>([])
  const [scanDetectedIds, setScanDetectedIds] = useState<string[]>([])
  const [scanFeedback, setScanFeedback] = useState<{ targetId: string; atSeconds: number } | null>(null)
  const [cueActive, setCueActive] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MotEngine | null>(null)
  const paramsRef = useRef<MotParams>(n0MotParams(0))
  const questionRef = useRef(taskQuestion)
  const stageElapsedRef = useRef(0)
  const accumulatorRef = useRef(0)
  const taskRemainingRef = useRef<number>(N0_TIMING.subTaskLimitSeconds)
  const taskStatusRef = useRef<N0TaskStatus>('standby')
  const taskTriggeredRef = useRef(false)
  const triggerAtRef = useRef<number>(N0_TIMING.subTaskEarliestSeconds)
  const warningShownRef = useRef(false)
  const warningDismissAtRef = useRef<number | null>(null)
  const answerFeedbackElapsedRef = useRef(0)
  const markingDeadlineRef = useRef<number | null>(null)
  const markerUsedRef = useRef(false)
  const recordedMarkedTargetIdsRef = useRef<number[]>([])
  const n3ContextRef = useRef<N3Context | null>(null)
  const n3ContextAtRef = useRef<number | null>(null)
  const n3LastSampleAtRef = useRef<number | null>(null)
  const n3BridgeStartedAtRef = useRef<number | null>(null)
  const completedRef = useRef(false)
  const selectionStartedAtRef = useRef<number | null>(null)
  const selectionSecondsRef = useRef<number | null>(null)
  const scanTrialRef = useRef<ScanTrial | null>(null)
  const scanRuntimeRef = useRef<ScanRuntime | null>(null)
  const scanOutcomeRef = useRef<ScanResult | null>(null)
  const cueEndsAtRef = useRef<number | null>(null)
  const audioRef = useRef<AudioContext | null>(null)
  const returnDialogPausedScanRef = useRef(false)

  function playArrivalCue() {
    const context = audioRef.current
    if (!context) return
    const sound = () => {
      if (context.state !== 'running') return
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'; oscillator.frequency.value = 660
      gain.gain.setValueAtTime(.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(.045, context.currentTime + .018)
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .16)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(); oscillator.stop(context.currentTime + .17)
    }
    if (context.state === 'running') sound()
    else void context.resume().then(sound).catch(() => {})
  }

  function updateSession(status: FormalSession['status']) {
    setState(previous => previous.activeFormal ? { ...previous, activeFormal: { ...previous.activeFormal, status } } : previous)
  }
  function requestReturnHome() {
    if (phase === 'idle' || phase === 'completed') { navigate('/'); return }
    if (isRadar && !paused && scanRuntimeRef.current && !scanRuntimeRef.current.ended) {
      scanRuntimeRef.current.pausedAtMs = performance.now()
      returnDialogPausedScanRef.current = true
    }
    setConfirmReturnOpen(true)
  }
  function cancelReturnHome() {
    const runtime = scanRuntimeRef.current
    if (returnDialogPausedScanRef.current && runtime?.pausedAtMs !== null && runtime?.pausedAtMs !== undefined) {
      runtime.pausedDurationMs += performance.now() - runtime.pausedAtMs
      runtime.pausedAtMs = null
    }
    returnDialogPausedScanRef.current = false
    setConfirmReturnOpen(false)
  }
  function confirmReturnHome() {
    setState(previous => ({ ...previous, activeFormal: null }))
    navigate('/', { replace: true })
  }
  function start() {
    if (phase !== 'idle') return
    const seed = Math.floor(Math.random() * 2_147_483_647)
    const params = n0MotParams(seed)
    const width = areaRef.current?.clientWidth || 660
    const height = areaRef.current?.clientHeight || 470
    paramsRef.current = params
    triggerAtRef.current = isRadar ? c1TriggerAt(seed) : n0TriggerAt(seed)
    completedRef.current = false
    selectionStartedAtRef.current = null; selectionSecondsRef.current = null
    engineRef.current = createMotEngine(params, width, height)
    const questions = SubTaskQuestionBank.filter(question => ['UAV-01', 'UAV-02', 'UAV-03'].includes(question.uavId))
    const question = questions[Math.floor(Math.random() * questions.length)]
    questionRef.current = question
    setTaskQuestion(question)
    if (isRadar) {
      const trial = createC1ScanTrial(seed, { targetRetention: isLowSensitivity })
      scanTrialRef.current = trial; setScanTrial(trial)
      scanRuntimeRef.current = null; scanOutcomeRef.current = null
      setScanPreparing(false); setScanElapsed(0); setScanCapturedIds([]); setScanDetectedIds([]); setScanFeedback(null)
      setCueActive(false); cueEndsAtRef.current = null
      if (isGuided) {
        const context = audioRef.current ?? new AudioContext()
        audioRef.current = context
        void context.resume().catch(() => {})
      }
    }
    setTargets(engineRef.current.targets.map(target => ({ ...target })))
    setSelected([]); setMarkedTargets([]); setPersistentMarkedTargetIds([]); setTaskAnswer(null); setSubTaskResult(null)
    setMemoryCountdown(N0_TIMING.highlightSeconds); setSelectionWarning(false)
    taskStatusRef.current = 'standby'; taskTriggeredRef.current = false
    warningShownRef.current = false; warningDismissAtRef.current = null; answerFeedbackElapsedRef.current = 0
    markingDeadlineRef.current = null; markerUsedRef.current = false; recordedMarkedTargetIdsRef.current = []
    n3ContextRef.current = null; n3ContextAtRef.current = null; n3LastSampleAtRef.current = null; n3BridgeStartedAtRef.current = null; setN3Context(null)
    taskRemainingRef.current = isRadar ? C1_SCAN_DEFAULTS.durationSeconds : N0_TIMING.subTaskLimitSeconds
    setTaskStatus('standby'); setTaskRemaining(taskRemainingRef.current)
    stageElapsedRef.current = 0; accumulatorRef.current = 0
    setPaused(false); setPhase('highlight')
    updateSession('进行中')
  }
  function pause() {
    if (phase !== 'highlight' && phase !== 'tracking') return
    if (isRadar && scanRuntimeRef.current && !scanRuntimeRef.current.ended) scanRuntimeRef.current.pausedAtMs = performance.now()
    setPaused(true); updateSession('已暂停')
  }
  function resume() {
    if (!paused) return
    const runtime = scanRuntimeRef.current
    if (isRadar && runtime?.pausedAtMs !== null && runtime?.pausedAtMs !== undefined) { runtime.pausedDurationMs += performance.now() - runtime.pausedAtMs; runtime.pausedAtMs = null }
    setPaused(false); updateSession('进行中')
  }
  function reset() {
    if (audioRef.current) { void audioRef.current.close().catch(() => {}); audioRef.current = null }
    engineRef.current = null; stageElapsedRef.current = 0; accumulatorRef.current = 0
    completedRef.current = false
    selectionStartedAtRef.current = null; selectionSecondsRef.current = null
    taskStatusRef.current = 'standby'; taskTriggeredRef.current = false
    warningShownRef.current = false; warningDismissAtRef.current = null; answerFeedbackElapsedRef.current = 0
    markingDeadlineRef.current = null; markerUsedRef.current = false; recordedMarkedTargetIdsRef.current = []
    n3ContextRef.current = null; n3ContextAtRef.current = null; n3LastSampleAtRef.current = null; n3BridgeStartedAtRef.current = null; setN3Context(null)
    setPhase('idle'); setPaused(false); setTargets([]); setSelected([]); setMarkedTargets([]); setPersistentMarkedTargetIds([])
    setMemoryCountdown(N0_TIMING.highlightSeconds); setSelectionWarning(false)
    setTaskStatus('standby'); setTaskAnswer(null); setSubTaskResult(null)
    scanTrialRef.current = null; scanRuntimeRef.current = null; scanOutcomeRef.current = null
    returnDialogPausedScanRef.current = false
    setScanTrial(null); setScanPreparing(false); setScanElapsed(0); setScanCapturedIds([]); setScanDetectedIds([]); setScanFeedback(null)
    setCueActive(false); cueEndsAtRef.current = null
    setTaskRemaining(isRadar ? C1_SCAN_DEFAULTS.durationSeconds : N0_TIMING.subTaskLimitSeconds); updateSession('待开始')
  }
  function scanTime(runtime: ScanRuntime, atMs: number) {
    if (runtime.formalStartedAtMs === null) return 0
    return Math.max(0, (atMs - runtime.formalStartedAtMs - (runtime.pausedDurationMs - runtime.pausedDurationAtStartMs)) / 1000)
  }
  function completeScanIntro() {
    const runtime = scanRuntimeRef.current
    if (!isRadar || !runtime || runtime.ended || runtime.formalStartedAtMs !== null || paused || confirmReturnOpen) return
    const atMs = performance.now()
    runtime.introEndedAtMs = atMs
    runtime.formalStartedAtMs = atMs
    runtime.pausedDurationAtStartMs = runtime.pausedDurationMs
    updateScanWindows(runtime, 0, atMs)
    setScanPreparing(false)
  }
  function updateScanWindows(runtime: ScanRuntime, elapsed: number, atMs: number) {
    const inside = new Set<string>()
    let newlyDetected = false
    for (const target of runtime.trial.targets) {
      if (isInScan(runtime.trial, target, elapsed)) inside.add(target.id)
      const timing = runtime.timings.find(item => item.targetId === target.id)!
      const plannedEntry = runtime.trial.plannedWindows.find(item => item.targetId === target.id)?.enteredAtSeconds
      if (plannedEntry !== null && plannedEntry !== undefined && elapsed >= plannedEntry && !runtime.detectedIds.has(target.id)) {
        runtime.detectedIds.add(target.id)
        newlyDetected = true
        timing.enteredAtMs = atMs
      }
      if (!inside.has(target.id) && runtime.lastInside.has(target.id) && timing.exitedAtMs === null) {
        timing.exitedAtMs = atMs
        if (!runtime.trial.params.targetRetention && target.kind === 'vehicle' && timing.capturedAtMs === null) timing.missedAtMs = atMs
      }
    }
    runtime.lastInside = inside
    if (newlyDetected) setScanDetectedIds([...runtime.detectedIds])
  }
  function captureScanTarget(targetId: string) {
    const runtime = scanRuntimeRef.current
    if (!isRadar || !runtime || runtime.ended || runtime.formalStartedAtMs === null || paused) return
    const target = runtime.trial.targets.find(item => item.id === targetId)
    if (!target) return
    const atMs = performance.now()
    const elapsed = scanTime(runtime, atMs)
    const plannedEntry = runtime.trial.plannedWindows.find(item => item.targetId === targetId)?.enteredAtSeconds
    const timing = runtime.timings.find(item => item.targetId === targetId)!
    if (plannedEntry !== null && plannedEntry !== undefined && elapsed >= plannedEntry && timing.enteredAtMs === null) {
      timing.enteredAtMs = atMs
      runtime.detectedIds.add(targetId)
      setScanDetectedIds([...runtime.detectedIds])
    }
    const result = classifyScanClick(runtime.trial, target, elapsed, runtime.capturedIds, runtime.detectedIds)
    runtime.clicks.push({ targetId, atMs, elapsedSeconds: elapsed, result })
    if (result === 'capture') {
      runtime.capturedIds.push(targetId)
      timing.capturedAtMs = atMs
      setScanCapturedIds([...runtime.capturedIds])
    }
    if (result === 'capture' || result === 'wrong') setScanFeedback({ targetId, atSeconds: elapsed })
  }
  function finishScan(atMs: number) {
    const runtime = scanRuntimeRef.current
    if (!runtime || runtime.ended) return
    runtime.ended = true
    updateScanWindows(runtime, runtime.trial.params.durationSeconds, atMs)
    for (const target of runtime.trial.targets) {
      if (target.kind !== 'vehicle') continue
      const timing = runtime.timings.find(item => item.targetId === target.id)!
      if (timing.capturedAtMs === null && timing.missedAtMs === null) timing.missedAtMs = atMs
    }
    scanOutcomeRef.current = scanResult(runtime.trial, runtime.triggeredAtMs, runtime.cueAtMs, runtime.formalStartedAtMs, atMs, runtime.clicks, runtime.timings, runtime.introEndedAtMs, isDirect)
    markingDeadlineRef.current = null; taskStatusRef.current = 'standby'; setTaskStatus('standby')
    setScanPreparing(false); setCueActive(false); setScanElapsed(runtime.trial.params.durationSeconds)
  }
  function chooseSubTask(answer: Answer) {
    if (paused || (taskStatusRef.current !== 'active' && (!hasMarker || taskStatusRef.current !== 'marking'))) return
    markingDeadlineRef.current = null
    setSubTaskResult({ taskId: questionRef.current.taskId, answer, correctAnswer: questionRef.current.correctAnswer, responseSeconds: Math.round((N0_TIMING.subTaskLimitSeconds - taskRemainingRef.current) * 10) / 10, timedOut: false })
    if (isN3 || isN5) { activateN3Bridge(); return }
    taskStatusRef.current = 'recorded'; setTaskStatus('recorded')
    answerFeedbackElapsedRef.current = 0
    setTaskAnswer(answer)
  }
  function activateN3Bridge() {
    if (!hasReturnBridge) return
    if (n3ContextRef.current && engineRef.current) appendN3Frame(n3ContextRef.current, engineRef.current.targets, areaRef.current?.clientWidth || n3ContextRef.current.width, areaRef.current?.clientHeight || n3ContextRef.current.height, true)
    taskStatusRef.current = 'standby'; setTaskStatus('standby'); setTaskAnswer(null)
    n3BridgeStartedAtRef.current = stageElapsedRef.current
    setN3Context(n3ContextRef.current)
  }
  function enterSubTask() {
    if (taskStatusRef.current !== 'marking') return
    markingDeadlineRef.current = null
    taskStatusRef.current = 'active'; setTaskStatus('active')
  }
  function openMarker() {
    if (!hasMarker || phase !== 'tracking' || paused) return
    if (taskStatusRef.current === 'marking') { enterSubTask(); return }
    if (markerUsedRef.current || taskStatusRef.current !== 'active') return
    markerUsedRef.current = true
    markingDeadlineRef.current = n1MarkingDeadlineSeconds(stageElapsedRef.current, N0_TIMING.trackingSeconds, taskRemainingRef.current)
    taskStatusRef.current = 'marking'; setTaskStatus('marking')
  }
  function toggleMarker(id: number) {
    if (!hasMarker || phase !== 'tracking' || paused || taskStatusRef.current !== 'marking') return
    if (hasPersistentMarks) {
      setPersistentMarkedTargetIds(current => {
        const next = toggleN1Marker(current, id, paramsRef.current.targets)
        recordedMarkedTargetIdsRef.current = next
        return next
      })
      return
    }
    setMarkedTargets(current => {
      const next = toggleN1Marker(current, id, paramsRef.current.targets)
      return next
    })
  }
  function confirmSelection() {
    if (phase !== 'selection' || selected.length !== paramsRef.current.targets) return
    selectionSecondsRef.current = selectionStartedAtRef.current === null ? null : Math.round((performance.now() - selectionStartedAtRef.current) / 100) / 10
    setPhase('confirmed')
  }
  function finish() {
    if (phase !== 'confirmed' || completedRef.current || !engineRef.current) return
    completedRef.current = true
    const main = scoreMotSelection(engineRef.current.targets, selected)
    const sub = subTaskResult
    const scan = scanOutcomeRef.current
    const metrics = { seed: paramsRef.current.seed, triggerAtSeconds: triggerAtRef.current, selectionSeconds: selectionSecondsRef.current ?? undefined, main, subTask: sub }
    const record: FormalRecord = {
      participantId: session.participantId, trialId: String(state.formalRecords.length + 1).padStart(3, '0'),
      stage: isRadar ? 'two' : 'one', conditionId: isRadar ? session.conditions.conditionId : undefined, intervention: isRadar ? session.conditions.intervention : undefined, timeSensitivity: isRadar ? session.conditions.timeSensitivity : undefined, support: isRadar ? 'N1' : isN1 ? 'N1' : isN2 ? 'N2' : isN3 ? 'N3' : isN4 ? 'N4' : isN5 ? 'N5' : 'N0', supportName: isN1 || isRadar ? '迁移前支持' : isN2 ? '视觉占用期支持' : isN3 ? '注意回归期支持' : isN4 ? '全过程支持' : isN5 ? '迁移前 + 回归期支持' : '无支持', completedAt: new Date().toISOString(), status: '已完成',
      mainTaskResult: `选择目标 ${selected.map(id => id + 1).join('、')}；正确 ${main.correct}/${main.total}；正确率 ${Math.round(main.correct / main.total * 100)}%；错选 ${main.wrong}；漏选 ${main.missed}`,
      subTaskResult: isRadar ? scan ? `车辆捕获 ${scan.capturedCount}/${scan.params.vehicleCount}；误选 ${scan.wrongCount}；错失 ${scan.missedCount}` : '未触发' : sub ? sub.timedOut ? '超时' : `选择方案 ${sub.answer}；${sub.answer === sub.correctAnswer ? '正确' : '错误'}；反应 ${sub.responseSeconds?.toFixed(1)} 秒` : '未触发',
      attentionReturnResult: hasReturnBridge ? '次任务结束后呈现 6 秒历史位置与虚线运动轨迹' : '未采集', ...(isRadar ? { motMetrics: metrics, c1Radar: scan ?? undefined, n1Marking: { used: markerUsedRef.current, targetIds: recordedMarkedTargetIdsRef.current.map(id => id + 1) } } : isN1 ? { motMetrics: metrics, n1Marking: { used: markerUsedRef.current, targetIds: markedTargets.map(id => id + 1) } } : hasReturnBridge ? { motMetrics: metrics, ...(hasPersistentMarks ? { n1Marking: { used: markerUsedRef.current, targetIds: recordedMarkedTargetIdsRef.current.map(id => id + 1) } } : {}), ...(n3ContextRef.current && n3ContextAtRef.current !== null ? { n3Bridge: { triggeredAtSeconds: n3ContextAtRef.current, context: n3ContextRef.current, durationSeconds: N3_BRIDGE_SECONDS } } : {}) } : isN2 ? { motMetrics: metrics } : { n0Metrics: metrics }), subTaskEvents: isRadar ? [] : sub ? [sub] : [],
    }
    record.stats = statsForRecord(record)
    setState(previous => ({ ...previous, activeFormal: previous.activeFormal ? { ...previous.activeFormal, status: '已完成' } : null, formalRecords: upsertFormalRecord(previous.formalRecords, { ...record, trialId: String(previous.formalRecords.length + 1).padStart(3, '0') }) }))
    if (audioRef.current) { void audioRef.current.close().catch(() => {}); audioRef.current = null }
    if (hasPersistentMarks) { setPersistentMarkedTargetIds([]); recordedMarkedTargetIdsRef.current = [] }
    setPhase('completed')
  }
  function toggleTarget(id: number) {
    if (phase !== 'selection') return
    const next = selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]
    if (next.length > paramsRef.current.targets) return
    setSelected(next)
  }

  useEffect(() => () => { if (audioRef.current) void audioRef.current.close().catch(() => {}) }, [])

  useEffect(() => {
    if (paused || confirmReturnOpen || (phase !== 'highlight' && phase !== 'tracking')) return
    let frame = 0, last = 0, transitioning = false
    const tick = (now: number) => {
      if (!last) last = now
      const dt = Math.min((now - last) / 1000, .05); last = now
      stageElapsedRef.current += dt
      if (phase === 'highlight') {
        setMemoryCountdown(current => { const next = Math.max(1, Math.ceil(N0_TIMING.highlightSeconds - stageElapsedRef.current)); return current === next ? current : next })
        if (stageElapsedRef.current >= N0_TIMING.highlightSeconds && !transitioning) {
          transitioning = true; stageElapsedRef.current = 0; setPhase('tracking'); return
        }
      } else if (engineRef.current && areaRef.current) {
        accumulatorRef.current += dt
        const width = areaRef.current.clientWidth, height = areaRef.current.clientHeight
        while (accumulatorRef.current >= 1 / 60) {
          advanceMot(engineRef.current, paramsRef.current, width, height, 1 / 60)
          accumulatorRef.current -= 1 / 60
        }
        setTargets(engineRef.current.targets.map(target => ({ ...target })))
        if (!taskTriggeredRef.current && stageElapsedRef.current >= triggerAtRef.current) {
          if (hasReturnBridge) { n3ContextRef.current = captureN3Context(engineRef.current.targets, width, height); n3ContextAtRef.current = stageElapsedRef.current; n3LastSampleAtRef.current = stageElapsedRef.current }
          taskTriggeredRef.current = true; taskStatusRef.current = 'active'; setTaskStatus('active')
          if (isRadar && scanTrialRef.current) {
            const trial = scanTrialRef.current
            const runtime: ScanRuntime = { trial, triggeredAtMs: now, cueAtMs: isGuided ? now : null, introEndedAtMs: null, formalStartedAtMs: null, pausedDurationMs: 0, pausedDurationAtStartMs: 0, pausedAtMs: null, lastInside: new Set(), detectedIds: new Set(), timings: trial.targets.map(target => ({ targetId: target.id, enteredAtMs: null, exitedAtMs: null, capturedAtMs: null, missedAtMs: null })), clicks: [], capturedIds: [], ended: false }
            scanRuntimeRef.current = runtime
            if (isGuided) {
              runtime.introEndedAtMs = now
              runtime.formalStartedAtMs = now
              updateScanWindows(runtime, 0, now)
              setScanPreparing(false)
            } else setScanPreparing(true)
            if (isGuided) { playArrivalCue(); cueEndsAtRef.current = stageElapsedRef.current + .8; setCueActive(true) }
          }
        }
        if (isRadar && cueEndsAtRef.current !== null && stageElapsedRef.current >= cueEndsAtRef.current) { cueEndsAtRef.current = null; setCueActive(false) }
        if (hasReturnBridge && (taskStatusRef.current === 'active' || (hasPersistentMarks && taskStatusRef.current === 'marking')) && n3ContextRef.current && n3LastSampleAtRef.current !== null && stageElapsedRef.current - n3LastSampleAtRef.current >= N3_SAMPLE_SECONDS) {
          appendN3Frame(n3ContextRef.current, engineRef.current.targets, width, height)
          n3LastSampleAtRef.current = stageElapsedRef.current
        }
        if (taskStatusRef.current === 'marking') {
          if (markingDeadlineRef.current !== null && stageElapsedRef.current >= markingDeadlineRef.current) enterSubTask()
        }
        if (isRadar && scanRuntimeRef.current && !scanRuntimeRef.current.ended) {
          const runtime = scanRuntimeRef.current
          if (runtime.formalStartedAtMs !== null) {
            const elapsed = Math.min(runtime.trial.params.durationSeconds, scanTime(runtime, now))
            updateScanWindows(runtime, elapsed, now)
            setScanElapsed(elapsed)
            taskRemainingRef.current = Math.max(0, runtime.trial.params.durationSeconds - elapsed)
            setTaskRemaining(taskRemainingRef.current)
            if (elapsed >= runtime.trial.params.durationSeconds) finishScan(now)
          }
        }
        if (!isRadar && taskStatusRef.current === 'active') {
          taskRemainingRef.current = Math.max(0, taskRemainingRef.current - dt)
          setTaskRemaining(Math.ceil(taskRemainingRef.current * 10) / 10)
          if (taskRemainingRef.current === 0) {
            setSubTaskResult({ taskId: questionRef.current.taskId, answer: null, correctAnswer: questionRef.current.correctAnswer, responseSeconds: null, timedOut: true })
            if (isN3 || isN5) activateN3Bridge()
            else if (isN2 || isN4) { taskStatusRef.current = 'recorded'; setTaskStatus('recorded'); answerFeedbackElapsedRef.current = 0 }
            else { taskStatusRef.current = 'standby'; setTaskStatus('standby'); setTaskAnswer(null) }
          }
        }
        if (taskStatusRef.current === 'recorded') {
          answerFeedbackElapsedRef.current += dt
          if (answerFeedbackElapsedRef.current >= (isN2 || isN4 ? .3 : N0_TIMING.answerFeedbackSeconds)) {
            if (isN4) activateN3Bridge()
            else { taskStatusRef.current = 'standby'; setTaskStatus('standby'); setTaskAnswer(null) }
          }
        }
        if (hasPersistentMarks && n3BridgeStartedAtRef.current !== null && stageElapsedRef.current - n3BridgeStartedAtRef.current >= N3_BRIDGE_SECONDS) {
          n3BridgeStartedAtRef.current = null
          setN3Context(null)
        }
        if (!warningShownRef.current && stageElapsedRef.current >= N0_TIMING.trackingSeconds - N0_TIMING.selectionWarningSeconds) {
          warningShownRef.current = true
          warningDismissAtRef.current = stageElapsedRef.current + N0_TIMING.selectionWarningDurationSeconds
          setSelectionWarning(true)
        }
        if (warningDismissAtRef.current !== null && stageElapsedRef.current >= warningDismissAtRef.current) {
          warningDismissAtRef.current = null; setSelectionWarning(false)
        }
        if (stageElapsedRef.current >= N0_TIMING.trackingSeconds && !transitioning) {
          if (isRadar && scanRuntimeRef.current && !scanRuntimeRef.current.ended) finishScan(now)
          if (!isRadar && hasMarker && (taskStatusRef.current === 'marking' || taskStatusRef.current === 'active')) {
            taskStatusRef.current = 'standby'; setTaskStatus('standby'); setTaskAnswer(null)
            setSubTaskResult({ taskId: questionRef.current.taskId, answer: null, correctAnswer: questionRef.current.correctAnswer, responseSeconds: null, timedOut: true })
          }
          transitioning = true; selectionStartedAtRef.current = performance.now(); setSelectionWarning(false); setPhase('selection'); return
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [phase, paused, confirmReturnOpen, isN1, isN2, isN3, isN4, isN5, isRadar, isGuided, isDirect])

  const displayStatus = phase === 'completed' ? '已完成' : phase === 'idle' ? '待开始' : paused ? '暂停' : '进行中'
  const supportLabel = isN1 ? 'N1 迁移前支持' : isN2 ? 'N2 视觉占用期支持' : isN3 ? 'N3 注意回归期支持' : isN4 ? 'N4 全过程支持' : isN5 ? 'N5 迁移前 + 回归期支持' : 'N0 无支持'
  const bridgeOpacity = hasReturnBridge && phase === 'tracking' && n3BridgeStartedAtRef.current !== null ? n3BridgeOpacity(stageElapsedRef.current - n3BridgeStartedAtRef.current) : 0
  return <main className="n0-page">
    <header className="n0-page-header"><button type="button" className="n0-home-button" onClick={requestReturnHome}>← 返回首页</button><div className="n0-frame-status"><div><span>被试编号</span><strong>{session.participantId}</strong></div><div><span>当前实验条件</span><strong>{isRadar ? `实验二｜${session.conditions.conditionId} ${isGuided ? '跨模态注意引导' : '视觉直接介入'} × ${isLowSensitivity ? '低' : '高'}时间效益敏感性` : `实验一｜${supportLabel}`}</strong></div><div><span>实验状态</span><strong>{displayStatus}</strong></div></div></header>
    <section className="n0-experiment-frame" aria-label={`${isRadar ? `实验二 ${session.conditions.conditionId}` : `实验一 ${supportLabel}`} 16比9实验画布`}><N0Workspace areaRef={areaRef} phase={phase} targets={targets} selected={selected} support={isRadar ? isGuided ? isLowSensitivity ? 'C2' : 'C1' : isLowSensitivity ? 'C4' : 'C3' : isN1 ? 'N1' : isN2 ? 'N2' : isN3 ? 'N3' : isN4 ? 'N4' : isN5 ? 'N5' : 'N0'} markedTargets={hasPersistentMarks ? persistentMarkedTargetIds : markedTargets} markerUsed={markerUsedRef.current} n3Bridge={n3Context && bridgeOpacity > 0 ? { context: n3Context, opacity: bridgeOpacity } : null} memoryCountdown={memoryCountdown} selectionWarning={selectionWarning} paused={paused} taskStatus={taskStatus} taskQuestion={taskQuestion} taskAnswer={taskAnswer} taskRemaining={taskRemaining} c1Radar={isRadar ? { trial: scanTrial, intro: scanPreparing, introSuspended: confirmReturnOpen, elapsed: scanElapsed, capturedIds: scanCapturedIds, detectedIds: scanDetectedIds, wrongCount: scanRuntimeRef.current?.clicks.filter(click => click.result === 'wrong').length ?? 0, feedback: scanFeedback, cueActive } : undefined} onC1TargetClick={captureScanTarget} onC1IntroComplete={completeScanIntro} onToggle={toggleTarget} onMarkerTool={openMarker} onMarkerToggle={toggleMarker} onTaskSelect={chooseSubTask} /></section>
    <footer className="n0-frame-controls"><button className="button button-primary" disabled={phase !== 'idle'} onClick={start}>开始</button><button className="button button-secondary" disabled={paused || (phase !== 'highlight' && phase !== 'tracking')} onClick={pause}>暂停</button><button className="button button-secondary" disabled={!paused} onClick={resume}>继续</button><button className="button button-secondary" onClick={reset}>重置</button>{phase === 'selection' && selected.length === paramsRef.current.targets && <button className="button button-primary" onClick={confirmSelection}>确认选择</button>}{phase === 'confirmed' && <button className="button button-primary" onClick={finish}>结束实验</button>}</footer>
    {confirmReturnOpen && <div className="n0-return-backdrop"><div className="n0-return-dialog" role="alertdialog" aria-modal="true" aria-labelledby="n0-return-title" onKeyDown={event => { if (event.key === 'Escape') cancelReturnHome() }}><p id="n0-return-title">当前实验尚未完成，返回首页将终止本轮实验，是否继续？</p><div><button type="button" className="button button-secondary" autoFocus onClick={cancelReturnHome}>取消</button><button type="button" className="button button-primary" onClick={confirmReturnHome}>确认返回</button></div></div></div>}
  </main>
}
