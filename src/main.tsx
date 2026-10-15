import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { MainTaskPretestPage } from './pretests/main/MainTaskPretestPage'
import { SubTaskPretestPage } from './pretests/sub/SubTaskPretestPage'
import { N0FormalRunPage } from './formal/N0FormalRunPage'
import type { N3Context } from './formal/n3Trial'
import type { ScanResult } from './formal/c1RadarTrial'
import { formatRate, formatSeconds, latestUniqueRecords, resultCondition, resultKey, statsForRecord, upsertFormalRecord, type FormalStats, type SubTaskEvent } from './formal/resultRecords'
import { currentSessionRecords, hasUnexportedRecords } from './formal/sessionResults'
import './style.css'

export type Status = '未开始' | '进行中' | '已完成'
type RunStatus = '待开始' | '进行中' | '已暂停' | '已完成'
type Support = 'N0' | 'N1' | 'N2' | 'N3' | 'N4' | 'N5'
type ExperimentStage = 'one' | 'two'
type Conditions = { intervention: string; timeSensitivity?: string; conditionId?: string; supportSource?: string; support: Support | '' }
export type FormalSession = { participantId: string; stage: ExperimentStage; conditions: Conditions; status: RunStatus }
export type MotFormalMetrics = {
  seed: number
  triggerAtSeconds: number
  selectionSeconds?: number
  main: { correct: number; wrong: number; missed: number; total: number }
  subTask: SubTaskEvent | null
}
export type FormalRecord = {
  participantId: string; trialId: string; stage?: ExperimentStage
  intervention?: string; modality?: string; support?: Support | ''; supportName?: string
  conditionId?: string; timeSensitivity?: string
  completedAt: string; status: '已完成'
  mainTaskResult: string; subTaskResult: string; attentionReturnResult: string
  stats?: FormalStats
  subTaskEvents?: SubTaskEvent[]
  n0Metrics?: MotFormalMetrics
  motMetrics?: MotFormalMetrics
  n1Marking?: { used: boolean; targetIds: number[] }
  n3Bridge?: { triggeredAtSeconds: number; context: N3Context; durationSeconds: number }
  c1Radar?: ScanResult
}
type SavedState = {
  participantId: string
  pretestStatuses: Record<string, Status>
  pretestParams: Record<string, Record<string, string>>
  conditions: Conditions
  activeFormal: FormalSession | null
  formalRecords: FormalRecord[]
}
export type Platform = { state: SavedState; setState: React.Dispatch<React.SetStateAction<SavedState>>; markExported: (records: FormalRecord[]) => void }

const pretests = [
  { id: 'PT-01', slug: 'main-task', name: '主任务预实验', description: '熟悉持续动态目标跟踪主任务。', purpose: '熟悉持续动态目标跟踪主任务，并调整主任务参数。' },
  { id: 'PT-02', slug: 'sub-task', name: '次任务预实验', description: '熟悉UAV突发次任务。', purpose: '熟悉 UAV 突发次任务，并调节次任务难度和时间限制。' },
  { id: 'PT-03', slug: 'combined-task', name: '主次任务组合预实验', description: '熟悉主任务持续运行、次任务随机插入的双任务流程。', purpose: '熟悉主任务持续运行、次任务随机出现以及完成次任务后继续主任务。' },
  { id: 'PT-04', slug: 'support', name: '主任务注意再分配支持预实验', description: '熟悉N0-N4支持策略的表现形式。', purpose: '熟悉 N0–N4 支持策略的表现形式与区别。' },
] as const
type Pretest = typeof pretests[number]
const supports: { id: Support; name: string; mechanism: string; detail: string }[] = [
  { id: 'N0', name: '无支持', mechanism: '无额外支持', detail: '次任务出现、处理和完成后，系统不额外提供主任务支持。' },
  { id: 'N1', name: '迁移前支持', mechanism: '任务状态外化', detail: '注意从主任务转向次任务之前，允许对当前主任务状态进行一次轻量标记。' },
  { id: 'N2', name: '视觉占用期支持', mechanism: '主次任务共域呈现', detail: '处理次任务期间，判读卡进入持续运行的 MOT 主任务空间。' },
  { id: 'N3', name: '注意回归期支持', mechanism: '上下文重建', detail: '次任务完成后，提供短暂的主任务连续性辅助线索。' },
  { id: 'N4', name: '全过程支持', mechanism: 'N1 + N2 + N3', detail: '组合迁移前任务状态外化、注意占用期主任务线索保持与注意回归期上下文重建。' },
  { id: 'N5', name: '迁移前 + 回归期支持', mechanism: 'N1 + N3', detail: '组合迁移前主动标记与次任务完成后的上下文重建，次任务仍在右侧区域呈现。' },
]
const experimentTwoStrategies = [
  { id: 'S1', name: '跨模态注意引导' },
  { id: 'S2', name: '视觉直接呈现' },
] as const
const experimentTwoSensitivities = [
  { id: 'T1', name: '高时间效益敏感性' },
  { id: 'T2', name: '低时间效益敏感性' },
] as const
function experimentTwoConditionId(intervention: string, timeSensitivity: string) {
  if (intervention !== 'S1' && intervention !== 'S2') return ''
  if (timeSensitivity !== 'T1' && timeSensitivity !== 'T2') return ''
  return `C${(intervention === 'S1' ? 0 : 2) + (timeSensitivity === 'T1' ? 1 : 2)}`
}
function experimentTwoConditionText(conditions: Conditions) {
  const strategy = experimentTwoStrategies.find(item => item.id === conditions.intervention)
  const sensitivity = experimentTwoSensitivities.find(item => item.id === conditions.timeSensitivity)
  const id = experimentTwoConditionId(conditions.intervention, conditions.timeSensitivity || '')
  return id && strategy && sensitivity ? `${id}｜${strategy.name} × ${sensitivity.name}` : '请完成两项实验条件选择'
}
function newParticipantSession(): SavedState {
  return {
    participantId: '', pretestStatuses: {}, pretestParams: {},
    conditions: { intervention: '', timeSensitivity: '', support: '' }, activeFormal: null, formalRecords: [],
  }
}
function usePlatform(): Platform {
  const [state, setState] = useState<SavedState>(newParticipantSession)
  const recordsRef = useRef(state.formalRecords)
  const exportedRecordsRef = useRef(new Set<FormalRecord>())
  recordsRef.current = state.formalRecords
  useEffect(() => {
    try { localStorage.removeItem('attention-platform-single-page-v1') } catch { /* Storage may be unavailable. */ }
  }, [])
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!hasUnexportedRecords(recordsRef.current, exportedRecordsRef.current)) return
      event.preventDefault(); event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeLeaving)
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving)
  }, [])
  function markExported(records: FormalRecord[]) {
    records.forEach(record => exportedRecordsRef.current.add(record))
  }
  return { state, setState, markExported }
}
function StatusBadge({ status }: { status: Status }) {
  return <span className={`status status-${status === '已完成' ? 'done' : status === '进行中' ? 'running' : 'idle'}`}><i />{status}</span>
}
function conditionText(stage: ExperimentStage, conditions: Conditions) {
  if (stage === 'one') {
    const support = supports.find(item => item.id === conditions.support)
    return support ? `实验一｜${support.id} ${support.name}` : '实验一｜请选择主任务支持条件'
  }
  const combination = experimentTwoConditionText(conditions)
  return `实验二｜${combination}｜主任务支持采用实验一筛选条件`
}
function stageLabel(record: FormalRecord) { return record.stage === 'one' ? '实验一' : record.stage === 'two' ? '实验二' : '旧版实验' }
function supportType(record: FormalRecord) {
  const support = supports.find(item => item.id === record.support)
  return support ? `${support.id} ${support.name}` : record.supportName || (record.stage === 'two' ? '采用实验一筛选结果' : '未记录')
}
function download(filename: string, body: string, mime: string, bom = false) {
  const url = URL.createObjectURL(new Blob([bom ? '\uFEFF' : '', body], { type: mime }))
  const link = document.createElement('a'); link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const csvColumns: { title: string; value: (record: FormalRecord, stats: FormalStats) => string }[] = [
  { title: '被试编号', value: record => record.participantId },
  { title: '实验序号', value: record => stageLabel(record) },
  { title: '实验条件', value: record => resultCondition(record) },
  { title: '支持类型', value: record => supportType(record) },
  { title: '主任务正确率', value: (_record, stats) => stats.mainAccuracy === null ? '' : formatRate(stats.mainAccuracy) },
  { title: '主任务正确数', value: (_record, stats) => stats.mainCorrect?.toString() ?? '' },
  { title: '主任务错误数', value: (_record, stats) => stats.mainWrong?.toString() ?? '' },
  { title: '主任务漏选数', value: (_record, stats) => stats.mainMissed?.toString() ?? '' },
  { title: '主任务选择用时', value: (_record, stats) => stats.selectionSeconds === null ? '' : formatSeconds(stats.selectionSeconds) },
  { title: '次任务触发次数', value: (_record, stats) => stats.subTriggered?.toString() ?? '' },
  { title: '次任务正确次数', value: (_record, stats) => stats.subCorrect?.toString() ?? '' },
  { title: '次任务错误次数', value: (_record, stats) => stats.subWrong?.toString() ?? '' },
  { title: '次任务漏选次数', value: (_record, stats) => stats.subMissed?.toString() ?? '' },
  { title: '次任务正确率', value: (_record, stats) => stats.subAccuracy === null ? '' : formatRate(stats.subAccuracy) },
  { title: '次任务漏选率', value: (_record, stats) => stats.subMissRate === null ? '' : formatRate(stats.subMissRate) },
  { title: '次任务平均反应时间', value: (_record, stats) => stats.subAverageResponseSeconds === null ? '' : formatSeconds(stats.subAverageResponseSeconds) },
  { title: '扫描捕获数', value: record => record.c1Radar?.capturedCount.toString() ?? '' },
  { title: '扫描误选数', value: record => record.c1Radar?.wrongCount.toString() ?? '' },
  { title: '扫描错失数', value: record => record.c1Radar?.missedCount.toString() ?? '' },
  { title: '扫描有效目标总数', value: record => record.c1Radar?.vehicleTargetCount?.toString() ?? '' },
  { title: '扫描捕获正确率', value: record => record.c1Radar?.captureAccuracy === undefined ? '' : formatRate(record.c1Radar.captureAccuracy) },
  { title: '扫描随机种子', value: record => record.c1Radar?.seed.toString() ?? '' },
  { title: '时钟起点(Unix ms)', value: record => record.c1Radar?.clockOriginEpochMs.toFixed(3) ?? '' },
  { title: '次任务触发时间戳(ms)', value: record => record.c1Radar?.triggeredAtMs.toFixed(3) ?? '' },
  { title: '工作区呈现时间戳(ms)', value: record => record.c1Radar?.presentedAtMs?.toFixed(3) ?? '' },
  { title: '工作区开始展开时间戳(ms)', value: record => record.c1Radar?.workspaceExpansionStartedAtMs?.toFixed(3) ?? '' },
  { title: '工作区完整呈现时间戳(ms)', value: record => record.c1Radar?.workspaceFullyPresentedAtMs?.toFixed(3) ?? '' },
  { title: '注意引导时间戳(ms)', value: record => record.c1Radar?.cueAtMs?.toFixed(3) ?? '' },
  { title: '光线动画结束时间戳(ms)', value: record => record.c1Radar?.introEndedAtMs?.toFixed(3) ?? '' },
  { title: '扫描正式启动时间戳(ms)', value: record => record.c1Radar?.formalStartedAtMs?.toFixed(3) ?? record.c1Radar?.enteredAtMs?.toFixed(3) ?? '' },
  { title: '首次目标点击时间戳(ms)', value: record => record.c1Radar?.firstClickAtMs?.toFixed(3) ?? '' },
  { title: '首次有效点击时间戳(ms)', value: record => record.c1Radar?.firstValidClickAtMs?.toFixed(3) ?? '' },
  { title: '扫描结束时间戳(ms)', value: record => record.c1Radar?.endedAtMs.toFixed(3) ?? '' },
  { title: '扫描参数(JSON)', value: record => record.c1Radar ? JSON.stringify(record.c1Radar.params) : '' },
  { title: '扫描点击记录(JSON)', value: record => record.c1Radar ? JSON.stringify(record.c1Radar.clicks) : '' },
  { title: '目标预定扫描窗口(JSON)', value: record => record.c1Radar ? JSON.stringify(record.c1Radar.plannedWindows ?? []) : '' },
  { title: '目标扫描窗口(JSON)', value: record => record.c1Radar ? JSON.stringify(record.c1Radar.targetTimings) : '' },
]
function exportRecords(records: FormalRecord[], filename: string) {
  if (!records.length) return
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
  const lines = [csvColumns.map(column => escape(column.title)).join(','), ...records.map(record => {
    const stats = statsForRecord(record)
    return csvColumns.map(column => escape(column.value(record, stats))).join(',')
  })]
  download(filename, lines.join('\r\n'), 'text/csv;charset=utf-8', true)
}
function exportSingleRecord(record: FormalRecord) {
  const safe = (value: string) => value.replace(/[^\p{L}\p{N}_-]/gu, '_')
  exportRecords([record], `${safe(record.participantId)}_${record.stage || 'legacy'}_${safe(resultCondition(record))}.csv`)
}
function ResultMetric({ label, value }: { label: string; value: string | number }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
function ResultRecord({ record, markExported }: { record: FormalRecord; markExported: Platform['markExported'] }) {
  const stats = statsForRecord(record)
  const value = (item: number | null) => item === null ? '—' : item
  return <article className="result-record"><div className="result-record-head"><div className="result-record-identity"><strong>被试 {record.participantId}</strong><span>{stageLabel(record)}</span><span>{resultCondition(record)}</span><small>{supportType(record)}</small></div><button type="button" className="button button-secondary" onClick={() => { exportSingleRecord(record); markExported([record]) }}>导出 CSV</button></div>
    <div className="result-record-stats"><section><h3>主任务</h3><dl><ResultMetric label="正确率" value={formatRate(stats.mainAccuracy)} /><ResultMetric label="正确" value={value(stats.mainCorrect)} /><ResultMetric label="错误" value={value(stats.mainWrong)} /><ResultMetric label="漏选" value={value(stats.mainMissed)} /><ResultMetric label="选择用时" value={formatSeconds(stats.selectionSeconds)} /></dl></section>
      <section><h3>次任务</h3><dl><ResultMetric label="触发" value={value(stats.subTriggered)} /><ResultMetric label="正确" value={value(stats.subCorrect)} /><ResultMetric label="错误" value={value(stats.subWrong)} /><ResultMetric label="漏选" value={value(stats.subMissed)} /><ResultMetric label="正确率" value={formatRate(stats.subAccuracy)} /><ResultMetric label="漏选率" value={formatRate(stats.subMissRate)} /><ResultMetric label="平均反应时间" value={formatSeconds(stats.subAverageResponseSeconds)} /></dl></section></div>
  </article>
}

function Home({ state, setState, markExported }: Platform) {
  const navigate = useNavigate()
  const location = useLocation()
  const [validation, setValidation] = useState('')
  const [validationStage, setValidationStage] = useState<ExperimentStage>('one')
  const [selectedStage, setSelectedStage] = useState<ExperimentStage>('one')
  const participantId = state.participantId.trim()
  const records = latestUniqueRecords(currentSessionRecords(state.formalRecords, participantId))
  const participantLocked = state.formalRecords.length > 0 || state.activeFormal !== null
  useEffect(() => { if (location.hash === '#results') document.getElementById('results')?.scrollIntoView({ block: 'start' }) }, [location.hash])
  function selectSupport(value: Support) {
    setState(previous => ({ ...previous, conditions: { ...previous.conditions, support: value } }))
    setSelectedStage('one')
    setValidation('')
  }
  function selectIntervention(value: string) {
    setState(previous => ({ ...previous, conditions: { ...previous.conditions, intervention: value } }))
    setSelectedStage('two')
    setValidation('')
  }
  function selectTimeSensitivity(value: string) {
    setState(previous => ({ ...previous, conditions: { ...previous.conditions, timeSensitivity: value } }))
    setSelectedStage('two')
    setValidation('')
  }
  function startFormal(stage: ExperimentStage) {
    setSelectedStage(stage)
    setValidationStage(stage)
    if (!participantId) { setValidation('请填写被试编号。'); return }
    if (stage === 'one' && !state.conditions.support) { setValidation('请选择主任务注意再分配支持条件。'); return }
    if (stage === 'two' && !state.conditions.intervention) { setValidation('请选择次任务介入策略。'); return }
    if (stage === 'two' && !state.conditions.timeSensitivity) { setValidation('请选择次任务时间效益敏感性。'); return }
    setValidation('')
    setState(previous => ({ ...previous, activeFormal: {
      participantId, stage,
      conditions: stage === 'one'
        ? { support: previous.conditions.support, intervention: '' }
        : { support: '', supportSource: '实验一筛选结果', intervention: previous.conditions.intervention, timeSensitivity: previous.conditions.timeSensitivity, conditionId: experimentTwoConditionId(previous.conditions.intervention, previous.conditions.timeSensitivity || '') },
      status: '待开始',
    } }))
    navigate('/formal/run')
  }
  return <main className="page home-page">
    <header className="title-area"><h1>有人车—多无人机协同前出侦察</h1><p>注意力分配实验 · 原型</p></header>

    <section className="block participant-block" aria-labelledby="participant-heading"><div className="block-heading"><div><span className="section-number">01 / PARTICIPANT</span><h2 id="participant-heading">被试编号</h2></div></div><label className="participant-field"><span className="sr-only">被试编号</span><input value={state.participantId} onChange={event => { setState(previous => ({ ...previous, participantId: event.target.value })); setValidation('') }} placeholder="P001" autoComplete="off" disabled={participantLocked} /></label></section>

    <section className="block pretest-block" aria-labelledby="pretest-heading"><div className="block-heading"><div><span className="section-number">02 / PRE-EXPERIMENT</span><h2 id="pretest-heading">预实验训练</h2></div><p>熟悉任务与支持策略，不记录正式实验结果。</p></div><div className="pretest-list">{pretests.map(item => <div className="pretest-row" key={item.id}><span className="module-code">{item.id}</span><div className="module-copy"><h3>{item.name}</h3><p>{item.description}</p></div><StatusBadge status={state.pretestStatuses[item.id] || '未开始'} /><Link className="small-button" to={'/pretest/' + item.slug}>进入 <span aria-hidden="true">↗</span></Link></div>)}</div><div className="pretest-footer"><Link className="button button-primary" to="/pretest/main-task">开始预实验训练 <span aria-hidden="true">↗</span></Link><button className="button button-quiet" onClick={() => document.getElementById('formal')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>跳过预实验</button></div></section>

    <section id="formal" className="block formal-block" aria-labelledby="formal-heading"><div className="block-heading"><div><span className="section-number">03 / FORMAL EXPERIMENT</span><h2 id="formal-heading">正式实验</h2></div><p>按阶段配置实验条件</p></div>
      <div className="formal-step-path" aria-label="正式实验顺序"><span>STEP 01 主任务支持实验</span><b aria-hidden="true">→</b><span>STEP 02 次任务介入实验</span></div>
      <div className="formal-stage-stack">
        <article className={'formal-stage-card' + (selectedStage === 'one' ? ' active' : '')} aria-labelledby="experiment-one-heading">
          <div className="formal-stage-heading"><span className="stage-index">STEP 01</span><div><h3 id="experiment-one-heading">实验一｜主任务注意维持与再分配支持</h3><p>在持续主任务与突发次任务并行情境下，比较不同阶段的主任务支持策略。</p></div></div>
          <div className="stage-condition"><div className="condition-label"><strong>主任务注意再分配支持</strong><small>选择一项支持条件</small></div><div className="option-group support-group" role="group" aria-label="主任务注意再分配支持">{supports.map(value => <button key={value.id} type="button" className={'option' + (state.conditions.support === value.id ? ' selected' : '')} aria-pressed={state.conditions.support === value.id} title={value.detail} onClick={() => selectSupport(value.id)}><span>{value.id}</span> {value.name}</button>)}</div></div>
          <p className="stage-description">固定次任务呈现条件，对比不同主任务支持阶段及策略，筛选更有利于主任务注意维持与绩效保持的支持方式。</p>
          {validation && validationStage === 'one' && <p className="validation" role="alert">{validation}</p>}
          <div className="stage-footer"><button className="button button-primary large" onClick={() => startFormal('one')}>开始实验一 <span aria-hidden="true">↗</span></button></div>
        </article>
        <div className="stage-connector" aria-hidden="true"><span>↓</span> 基于实验一筛选结果继续</div>
        <article className={'formal-stage-card experiment-two-card' + (selectedStage === 'two' ? ' active' : '')} aria-labelledby="experiment-two-heading">
          <div className="formal-stage-heading"><span className="stage-index">STEP 02</span><div><h3 id="experiment-two-heading">实验二｜次任务介入与注意分配机制</h3><p>在实验一筛选出的主任务支持条件基础上，比较不同次任务介入策略与时间效益敏感性组合的影响。</p></div></div>
          <div className="support-source">主任务支持条件：<strong>采用实验一筛选结果</strong></div>
          <div className="stage-condition experiment-two-choice"><div className="condition-label"><strong>次任务介入策略</strong></div><div className="option-group" role="group" aria-label="次任务介入策略">{experimentTwoStrategies.map(value => <button key={value.id} type="button" className={'option experiment-two-option' + (state.conditions.intervention === value.id ? ' selected' : '')} aria-pressed={state.conditions.intervention === value.id} onClick={() => selectIntervention(value.id)}>{value.name}</button>)}</div></div>
          <div className="stage-condition experiment-two-choice"><div className="condition-label"><strong>次任务时间效益敏感性</strong></div><div className="option-group" role="group" aria-label="次任务时间效益敏感性">{experimentTwoSensitivities.map(value => <button key={value.id} type="button" className={'option experiment-two-option' + (state.conditions.timeSensitivity === value.id ? ' selected' : '')} aria-pressed={state.conditions.timeSensitivity === value.id} onClick={() => selectTimeSensitivity(value.id)}>{value.name}</button>)}</div></div>
          <p className="experiment-two-current"><span>当前实验条件：</span><strong>{experimentTwoConditionText(state.conditions)}</strong></p>
          {validation && validationStage === 'two' && <p className="validation" role="alert">{validation}</p>}
          <div className="stage-footer"><button className="button button-primary large" onClick={() => startFormal('two')}>开始实验二 <span aria-hidden="true">↗</span></button></div>
        </article>
      </div>
      <div className="condition-summary"><span>当前实验：</span><strong>{conditionText(selectedStage, state.conditions)}</strong></div>
    </section>

    <section id="results" className="block results-block" aria-labelledby="results-heading"><div className="block-heading result-list-heading"><div><span className="section-number">04 / FORMAL RESULTS</span><h2 id="results-heading">正式实验结果</h2></div><button type="button" className="button button-secondary" disabled={!records.length} onClick={() => { exportRecords(records, `participant_${participantId.replace(/[^\p{L}\p{N}_-]/gu, '_')}_results.csv`); markExported(records) }}>导出全部记录</button></div><p className="result-session-note">当前被试：{participantId || '未填写'} · 实验一已完成 {records.filter(record => record.stage === 'one').length} 项 · 实验二已完成 {records.filter(record => record.stage === 'two').length} 项<br />当前结果仅在本次页面会话中保留，请在刷新或关闭页面前导出数据。</p>{records.length ? <div className="result-record-list">{records.map(record => <ResultRecord key={resultKey(record)} record={record} markExported={markExported} />)}</div> : <div className="no-data">当前被试暂无实验记录</div>}</section>
  </main>
}

type Param = { key: string; label: string; type: 'number' | 'select' | 'text'; initial: string; options?: string[] }
const parameterSets: Record<string, { title: string; params: Param[] }[]> = {
  'main-task': [{ title: '主任务参数', params: [
    { key: 'total', label: '动态目标总数', type: 'number', initial: '12' },
    { key: 'targets', label: '重点跟踪目标数量', type: 'number', initial: '4' },
    { key: 'speed', label: '目标速度', type: 'select', initial: '中', options: ['低', '中', '高'] },
    { key: 'area', label: '目标运动区域', type: 'select', initial: '标准区域', options: ['标准区域', '扩大区域'] },
    { key: 'randomness', label: '目标运动随机性', type: 'select', initial: '中', options: ['低', '中', '高'] },
    { key: 'duration', label: '单轮任务时长（秒）', type: 'number', initial: '60' },
    { key: 'collision', label: '目标碰撞或避让规则', type: 'select', initial: '避让', options: ['避让', '允许碰撞'] },
  ] }],
  'sub-task': [{ title: '次任务参数', params: [
    { key: 'type', label: '次任务类型', type: 'select', initial: '信息判断', options: ['信息判断', '选项决策'] },
    { key: 'options', label: '选项数量', type: 'number', initial: '4' },
    { key: 'limit', label: '限时时长（秒）', type: 'number', initial: '15' },
    { key: 'volume', label: '任务信息量', type: 'select', initial: '中', options: ['低', '中', '高'] },
    { key: 'complexity', label: '任务复杂度', type: 'select', initial: '中', options: ['低', '中', '高'] },
    { key: 'image', label: '是否包含图像', type: 'select', initial: '是', options: ['是', '否'] },
    { key: 'text', label: '是否包含文字', type: 'select', initial: '是', options: ['是', '否'] },
    { key: 'map', label: '是否包含地图信息', type: 'select', initial: '否', options: ['是', '否'] },
  ] }],
  'combined-task': [
    { title: '主任务参数', params: [
      { key: 'mainTotal', label: '动态目标数', type: 'number', initial: '12' },
      { key: 'mainTargets', label: '重点目标数', type: 'number', initial: '4' },
      { key: 'mainSpeed', label: '速度', type: 'select', initial: '中', options: ['低', '中', '高'] },
      { key: 'mainDuration', label: '主任务时长（秒）', type: 'number', initial: '60' },
    ] },
    { title: '次任务参数', params: [
      { key: 'subType', label: '次任务类型', type: 'select', initial: '信息判断', options: ['信息判断', '选项决策'] },
      { key: 'subLimit', label: '限时时长（秒）', type: 'number', initial: '15' },
      { key: 'subCount', label: '次任务出现次数', type: 'number', initial: '2' },
      { key: 'insertRange', label: '次任务插入时间范围（秒）', type: 'text', initial: '15–45' },
    ] },
  ],
}
function Preview({ title, detail }: { title: string; detail: string }) {
  return <div className="experiment-preview"><span className="preview-corner">EXPERIMENT AREA / PLACEHOLDER</span><div><span className="preview-symbol">◎</span><strong>{title}</strong><small>{detail}</small></div></div>
}
function ParameterControls({ item, state, setState }: { item: Pretest } & Platform) {
  return <div className="parameter-groups">{parameterSets[item.slug]?.map(group => <div className="parameter-group" key={group.title}><h3>{group.title}</h3><div className="parameter-grid">{group.params.map(param => {
    const value = state.pretestParams[item.id]?.[param.key] ?? param.initial
    const onChange = (next: string) => setState(previous => ({ ...previous, pretestParams: { ...previous.pretestParams, [item.id]: { ...previous.pretestParams[item.id], [param.key]: next } } }))
    return <label key={param.key}><span>{param.label}</span>{param.type === 'select' ? <select value={value} onChange={event => onChange(event.target.value)}>{param.options?.map(option => <option key={option}>{option}</option>)}</select> : <input type={param.type} min={param.type === 'number' ? 1 : undefined} value={value} onChange={event => onChange(event.target.value)} />}</label>
  })}</div></div>)}</div>
}
function TrainingControls({ item, state, setState }: { item: Pretest } & Platform) {
  const [paused, setPaused] = useState(false)
  const status = state.pretestStatuses[item.id] || '未开始'
  function update(status: Status) { setState(previous => ({ ...previous, pretestStatuses: { ...previous.pretestStatuses, [item.id]: status } })) }
  return <div className="module-controls"><div><span>训练状态</span><strong>{paused && status === '进行中' ? '已暂停' : status}</strong></div><div className="control-buttons"><button className="button button-primary" onClick={() => { update('进行中'); setPaused(false) }}>开始训练</button><button className="button button-secondary" disabled={status !== '进行中' || paused} onClick={() => setPaused(true)}>暂停</button><button className="button button-secondary" disabled={status !== '进行中' || !paused} onClick={() => setPaused(false)}>继续</button><button className="button button-secondary" onClick={() => { update('未开始'); setPaused(false) }}>重置</button><button className="button button-quiet" disabled={status !== '进行中' || paused} onClick={() => update('已完成')}>完成训练</button></div></div>
}
function PretestPage(platform: Platform) {
  const { slug } = useParams()
  const item = pretests.find(test => test.slug === slug)
  const [selectedStrategy, setSelectedStrategy] = useState<Support>('N0')
  if (!item) return <Navigate to="/" replace />
  const strategy = supports.find(option => option.id === selectedStrategy)!
  return <main className="page module-page"><div className="module-header"><div><span className="section-number">PRE-EXPERIMENT / {item.id}</span><h1>{item.name}</h1><p>{item.purpose}</p></div><Link className="back-link" to="/">← 返回首页</Link></div>
    {item.slug === 'support' ? <>
      <section className="module-panel"><h2>N0–N4 策略选择</h2><div className="option-group support-group">{supports.filter(option => option.id !== 'N5').map(option => <button key={option.id} className={'option' + (selectedStrategy === option.id ? ' selected' : '')} aria-pressed={selectedStrategy === option.id} onClick={() => setSelectedStrategy(option.id)}><span>{option.id}</span> {option.name}</button>)}</div></section>
      <section className="module-panel strategy-description"><span className="section-number">{strategy.id} / {strategy.mechanism}</span><h2>{strategy.name}</h2><p>{strategy.detail}</p></section>
      <Preview title="支持策略实验预览区" detail="当前阶段仅展示结构，后续接入真实支持逻辑。" />
    </> : <div className="module-workspace"><section className="module-panel parameter-panel"><h2>参数设置</h2><ParameterControls item={item} {...platform} /></section><div className={'preview-layout' + (item.slug === 'combined-task' ? ' combined' : '')}>{item.slug === 'combined-task' ? <><Preview title="主任务区" detail="持续动态目标跟踪区占位" /><Preview title="次任务区" detail="随机插入次任务区占位" /></> : <Preview title={item.slug === 'main-task' ? '主任务实验显示区' : '次任务预览区'} detail={item.slug === 'main-task' ? '后续用于放置 MOT 动态目标' : '后续用于呈现真实 UAV 次任务'} />}</div></div>}
    <TrainingControls item={item} {...platform} /><div className="module-bottom"><Link className="back-link" to="/">← 返回首页</Link></div>
  </main>
}
function FormalRunPage({ state, setState, markExported }: Platform) {
  const navigate = useNavigate()
  const session = state.activeFormal
  if (!session) return <main className="page module-page"><div className="module-header"><div><span className="section-number">FORMAL EXPERIMENT</span><h1>正式实验</h1><p>请先在首页填写被试编号并配置实验条件。</p></div><Link className="back-link" to="/">← 返回首页</Link></div></main>
  if (session.stage === 'one' && (session.conditions.support === 'N0' || session.conditions.support === 'N1' || session.conditions.support === 'N2' || session.conditions.support === 'N3' || session.conditions.support === 'N4' || session.conditions.support === 'N5')) return <N0FormalRunPage state={state} setState={setState} markExported={markExported} session={session} />
  if (session.stage === 'two' && ((session.conditions.conditionId === 'C1' && session.conditions.intervention === 'S1' && session.conditions.timeSensitivity === 'T1') || (session.conditions.conditionId === 'C2' && session.conditions.intervention === 'S1' && session.conditions.timeSensitivity === 'T2') || (session.conditions.conditionId === 'C3' && session.conditions.intervention === 'S2' && session.conditions.timeSensitivity === 'T1') || (session.conditions.conditionId === 'C4' && session.conditions.intervention === 'S2' && session.conditions.timeSensitivity === 'T2'))) return <N0FormalRunPage state={state} setState={setState} markExported={markExported} session={session} />
  const support = supports.find(item => item.id === session.conditions.support)
  function update(status: RunStatus) { setState(previous => previous.activeFormal ? { ...previous, activeFormal: { ...previous.activeFormal, status } } : previous) }
  function finish() {
    if (!session || session.status !== '进行中' || (session.stage === 'one' && !support)) return
    const record: FormalRecord = {
      participantId: session.participantId, trialId: String(state.formalRecords.length + 1).padStart(3, '0'),
      stage: session.stage, intervention: session.stage === 'two' ? session.conditions.intervention : undefined,
      support: session.stage === 'one' ? support?.id : '',
      supportName: session.stage === 'one' ? support?.name : '采用实验一筛选结果', completedAt: new Date().toISOString(),
      status: '已完成', mainTaskResult: '模拟值', subTaskResult: '模拟值', attentionReturnResult: '模拟值',
    }
    setState(previous => ({ ...previous, activeFormal: null, formalRecords: upsertFormalRecord(previous.formalRecords, record) }))
    navigate('/#results')
  }
  return <main className="page module-page"><div className="module-header"><div><span className="section-number">FORMAL EXPERIMENT / {session.stage === 'one' ? 'STEP 01' : 'STEP 02'}</span><h1>{session.stage === 'one' ? '实验一｜主任务注意维持与再分配支持' : '实验二｜次任务介入与注意分配机制'}</h1><p>当前阶段为独立实验页面框架，未接入真实刺激与数据采集。</p></div><Link className="back-link" to="/">← 返回首页</Link></div>
    <div className="run-meta"><div><span>被试编号</span><strong>{session.participantId}</strong></div><div><span>当前实验条件</span><strong>{conditionText(session.stage, session.conditions)}</strong></div><div><span>实验状态</span><strong>{session.status}</strong></div></div>
    <div className="formal-preview-layout"><Preview title="主任务区" detail="后续用于持续动态目标跟踪主任务" /><Preview title="次任务区" detail="后续用于 UAV 突发次任务" /></div>
    <div className="module-controls"><div><span>实验控制</span><strong>{session.status}</strong></div><div className="control-buttons"><button className="button button-primary" disabled={session.status !== '待开始'} onClick={() => update('进行中')}>开始</button><button className="button button-secondary" disabled={session.status !== '进行中'} onClick={() => update('已暂停')}>暂停</button><button className="button button-secondary" disabled={session.status !== '已暂停'} onClick={() => update('进行中')}>继续</button><button className="button button-secondary" onClick={() => update('待开始')}>重置</button><button className="button button-quiet" disabled={session.status !== '进行中'} onClick={finish}>完成模拟实验</button></div></div><div className="module-bottom"><Link className="back-link" to="/">← 返回首页</Link></div>
  </main>
}
function App() {
  const platform = usePlatform()
  return <Routes><Route path="/" element={<Home {...platform} />} /><Route path="/pretest/main-task" element={<MainTaskPretestPage {...platform} />} /><Route path="/pretest/sub-task" element={<SubTaskPretestPage {...platform} />} /><Route path="/pretest/:slug" element={<PretestPage {...platform} />} /><Route path="/formal/run" element={<FormalRunPage {...platform} />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>)
