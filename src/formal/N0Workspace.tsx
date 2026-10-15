import type { CSSProperties, RefObject } from 'react'
import type { MotTargetState } from '../pretests/main/motEngine'
import { questionOptions, type Answer, type SubTaskQuestion } from '../pretests/sub/SubTaskQuestionBank'
import type { N3Context } from './n3Trial'
import { C1RadarCard } from './C1RadarCard'
import type { ScanTrial } from './c1RadarTrial'

export type N0Phase = 'idle' | 'highlight' | 'tracking' | 'selection' | 'confirmed' | 'completed'
export type N0TaskStatus = 'standby' | 'marking' | 'active' | 'recorded'

const uavs = [
  { id: 'UAV-01', battery: 78, signal: '良好', status: '执行中', task: '前出侦察', sensor: '红外', link: '正常' },
  { id: 'UAV-02', battery: 64, signal: '良好', status: '执行中', task: '区域搜索', sensor: '可见光', link: '正常' },
  { id: 'UAV-03', battery: 91, signal: '稳定', status: '待命', task: '任务预备', sensor: '红外', link: '正常' },
] as const

function N3TrailLayer({ context, targets, width, height, opacity }: { context: N3Context; targets: MotTargetState[]; width: number; height: number; opacity: number }) {
  const currentById = new Map(targets.map(target => [target.id, target]))
  const scaleX = width / context.width
  const scaleY = height / context.height
  return <svg className="n3-bridge-layer" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ opacity }} aria-hidden="true">
    {context.targets.map(trace => {
      const current = currentById.get(trace.id)
      if (!current) return null
      const path = trace.path.map(point => `${point.x * scaleX},${point.y * scaleY}`)
      const last = path.length - 1
      const firstCut = Math.max(1, Math.floor(last / 3))
      const secondCut = Math.min(last, Math.max(firstCut + 1, Math.floor(last * 2 / 3)))
      const segment = (start: number, end: number) => path.slice(start, end + 1).join(' ')
      const end = trace.end ?? trace.path[last]
      return <g key={trace.id}>
        {last > 0 && <polyline className="n3-trail-old" points={segment(0, firstCut)} />}
        {secondCut > firstCut && <polyline className="n3-trail-middle" points={segment(firstCut, secondCut)} />}
        {last > secondCut && <polyline className="n3-trail-recent" points={segment(secondCut, last)} />}
        <line className="n3-trail-live" x1={end.x * scaleX} y1={end.y * scaleY} x2={current.x} y2={current.y} />
        <circle cx={trace.x * scaleX} cy={trace.y * scaleY} r="12" />
      </g>
    })}
  </svg>
}

function N2TaskCard({ question, remaining, status, answer, paused, n4 = false, onSelect }: { question: SubTaskQuestion; remaining: number; status: N0TaskStatus; answer: Answer | null; paused: boolean; n4?: boolean; onSelect: (answer: Answer) => void }) {
  const options = questionOptions(question)
  return <div className={'n2-task-card' + (n4 ? ' n4-task-card' : '') + (status === 'recorded' ? ' is-exiting' : '')} role="dialog" aria-label={`${question.uavId} 任务裁决`}>
    <div className="n2-task-top"><span>{question.uavId} / 任务裁决</span><strong>{remaining.toFixed(1)}s</strong></div>
    <p>选择下一阶段任务</p>
    <div className="n2-task-options" role="group" aria-label="任务方案">
      {(['A', 'B', 'C'] as Answer[]).map(key => { const option = options[key]; return <button key={key} type="button" className={'n2-task-option' + (answer === key ? ' selected' : '')} disabled={paused || (status !== 'active' && !(n4 && status === 'marking'))} onClick={() => onSelect(key)}><b>{key}</b><span><strong>{option.label}</strong><small>{option.taskStage} · 覆盖 {option.currentCoverage}% · 线索 {option.unconfirmedClues}（高价值 {option.highValueClues}） · 代价 {option.arrivalCost}</small></span></button> })}
    </div>
  </div>
}

export function N0Workspace({ areaRef, phase, targets, selected, support, markedTargets, markerUsed, n3Bridge, memoryCountdown, selectionWarning, paused, taskStatus, taskQuestion, taskAnswer, taskRemaining, c1Radar, onC1TargetClick, onC1IntroComplete, onToggle, onMarkerTool, onMarkerToggle, onTaskSelect }: {
  areaRef: RefObject<HTMLDivElement | null>; phase: N0Phase; targets: MotTargetState[]; selected: number[]
  support: 'N0' | 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'C1' | 'C2' | 'C3' | 'C4'; markedTargets: number[]; markerUsed: boolean
  n3Bridge: { context: N3Context; opacity: number } | null
  memoryCountdown: number; selectionWarning: boolean
  paused: boolean; taskStatus: N0TaskStatus; taskQuestion: SubTaskQuestion
  taskAnswer: Answer | null; taskRemaining: number; onToggle: (id: number) => void
  c1Radar?: { trial: ScanTrial | null; intro: boolean; introSuspended: boolean; elapsed: number; capturedIds: string[]; detectedIds: string[]; wrongCount: number; feedback: { targetId: string; atSeconds: number } | null; cueActive: boolean }
  onC1TargetClick?: (targetId: string) => void
  onC1IntroComplete?: () => void
  onMarkerTool: () => void; onMarkerToggle: (id: number) => void
  onTaskSelect: (answer: Answer) => void
}) {
  const selectable = phase === 'selection' && !paused
  const radarSupport = support === 'C1' || support === 'C2' || support === 'C3' || support === 'C4'
  const guidedRadarSupport = support === 'C1' || support === 'C2'
  const directRadarSupport = support === 'C3' || support === 'C4'
  const guidedTaskVisible = guidedRadarSupport && (taskStatus === 'active' || taskStatus === 'marking')
  const directTaskVisible = directRadarSupport && (taskStatus === 'active' || taskStatus === 'marking')
  const supportsMarking = support === 'N1' || support === 'N4' || support === 'N5' || radarSupport
  const persistentMark = support === 'N4' || support === 'N5' || radarSupport
  const marking = supportsMarking && phase === 'tracking' && taskStatus === 'marking' && !paused
  const markerAvailable = supportsMarking && phase === 'tracking' && !paused && (taskStatus === 'marking' || (taskStatus === 'active' && !markerUsed))
  const showSelection = phase === 'selection' || phase === 'confirmed' || phase === 'completed'
  const options = questionOptions(taskQuestion)
  const fieldWidth = areaRef.current?.clientWidth || n3Bridge?.context.width || 1
  const fieldHeight = areaRef.current?.clientHeight || n3Bridge?.context.height || 1
  return <div className={'n0-workspace' + (directRadarSupport ? ' c3-layout' : '') + (directTaskVisible ? ' c3-direct-active' : '')}>
    <section className="n0-main-region" aria-label="持续动态目标跟踪主任务">
      <div className={'n0-field' + (support === 'N4' ? ' n4-field' : '') + (n3Bridge ? ' n3-rebuilding' : '')} ref={areaRef} style={n3Bridge ? { '--n3-background-opacity': n3Bridge.opacity * .25 } as CSSProperties : undefined}>
        {n3Bridge && <N3TrailLayer context={n3Bridge.context} targets={targets} width={fieldWidth} height={fieldHeight} opacity={n3Bridge.opacity} />}
        {targets.map(target => <button key={target.id} type="button" className={'n0-target' + (phase === 'highlight' && target.isTarget ? ' marked' : '') + (showSelection && selected.includes(target.id) ? ' selected' : '') + (support === 'N1' && markedTargets.includes(target.id) ? ' n1-participant-mark' : '') + (persistentMark && markedTargets.includes(target.id) ? ' n4-participant-mark' : '') + (marking ? ' n1-hit-target' : '') + (n3Bridge ? ' n3-target' : '')} style={{ left: target.x, top: target.y, ...(n3Bridge ? { '--n3-ring-opacity': n3Bridge.opacity * .65 } : {}) } as CSSProperties} disabled={!selectable && !marking} aria-label={showSelection ? `目标 ${target.id + 1}${selected.includes(target.id) ? '，已选' : ''}` : marking ? `目标 ${target.id + 1}${markedTargets.includes(target.id) ? '，已标记' : ''}` : '移动目标'} onPointerDown={marking ? event => { if (event.pointerType !== 'mouse' || event.button === 0) onMarkerToggle(target.id) } : undefined} onClick={event => { if (marking && event.detail === 0) onMarkerToggle(target.id); else if (selectable) onToggle(target.id) }}>{showSelection ? target.id + 1 : ''}{persistentMark && markedTargets.includes(target.id) && !(showSelection && selected.includes(target.id)) && <span className="n4-persistent-mark" aria-hidden="true" />}</button>)}
        {supportsMarking && <button type="button" className={'n1-mark-tool' + (marking ? ' is-marking' : '')} aria-label="标记工具" aria-disabled={!markerAvailable} aria-pressed={marking} tabIndex={markerAvailable ? 0 : -1} onClick={onMarkerTool}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18.5l3.8-.8L19 7.5 16.5 5 6.3 15.2 5 18.5Z"/><path d="m14.8 6.7 2.5 2.5M4.5 21h15"/></svg></button>}
        {phase === 'highlight' && <div className="n0-memory-prompt" aria-live="polite"><strong>请记住高亮目标</strong><span>{memoryCountdown}</span></div>}
        {phase === 'tracking' && selectionWarning && <div className="n0-end-warning" role="status">即将进入目标选择阶段</div>}
        {supportsMarking && phase === 'tracking' && taskStatus === 'marking' && <div className="n1-mark-prompt"><strong>请标记你当前认为正在追踪的目标</strong><span>已标记 {markedTargets.length} / 4</span></div>}
        {support === 'N4' && (taskStatus === 'active' || taskStatus === 'marking' || taskStatus === 'recorded') && <div className={'n4-task-hud-backdrop' + (taskStatus === 'recorded' ? ' is-exiting' : '')} aria-hidden="true" />}
        {(support === 'N2' || support === 'N4') && (taskStatus === 'active' || (support === 'N4' && taskStatus === 'marking') || taskStatus === 'recorded') && <N2TaskCard question={taskQuestion} remaining={taskRemaining} status={taskStatus} answer={taskAnswer} paused={paused} n4={support === 'N4'} onSelect={onTaskSelect} />}
        {phase === 'selection' && <div className="n0-selection-prompt" role="status"><strong>请选择最初需要追踪的目标</strong><span>已选择 {selected.length} / 4</span></div>}
        {phase === 'confirmed' && <div className="n0-selection-prompt confirmed" role="status">选择已确认</div>}
      </div>
    </section>
    <aside className={'n0-side-region' + (guidedTaskVisible ? ' c1-guided-layout' : '') + (radarSupport && c1Radar?.cueActive && !guidedRadarSupport ? ' c1-attention-cue' : '')} aria-label="无人机状态与资源信息">
      {guidedTaskVisible ? <div className="c1-uav-overview" aria-label="UAV协同状态概览">{uavs.map(uav => <div key={uav.id} className={'c1-uav-summary' + (uav.id === 'UAV-02' ? ' is-task-source' : '') + (uav.id === 'UAV-02' && c1Radar?.cueActive ? ' is-cued' : '')}><strong>{uav.id}</strong><span><i aria-hidden="true" />{uav.id === 'UAV-02' ? '动态扫描中' : '正常'}</span></div>)}</div> : directTaskVisible ? <div className="c3-compact-uavs" aria-label="无人机简要状态">{uavs.map(uav => <span key={uav.id}><strong>{uav.id}</strong> {uav.id === 'UAV-02' ? '扫描任务' : '正常'}</span>)}</div> : <div className="n0-uav-monitor">
        {uavs.map(uav => { const n2Source = support === 'N2' && (taskStatus === 'active' || taskStatus === 'recorded') && uav.id === taskQuestion.uavId; const n4Source = support === 'N4' && (taskStatus === 'active' || taskStatus === 'marking' || taskStatus === 'recorded') && uav.id === taskQuestion.uavId; const c1Source = guidedRadarSupport && (taskStatus === 'active' || taskStatus === 'marking') && uav.id === 'UAV-02'; return <div className={'n0-uav-unit' + (n2Source ? ' n2-task-source' : '') + (c1Source ? ' c1-task-source' : '')} key={uav.id}>
          <div className="n0-unit-top"><strong>{uav.id}</strong><span className={'n0-unit-state' + (uav.status === '待命' && !n2Source ? ' standby' : '')}>{c1Source ? '扫描任务' : n2Source ? '待人工判读' : uav.status}</span></div>
          <div className="n0-unit-data"><div><span>电量</span><strong>{uav.battery}%</strong></div><div><span>信号</span><strong>{uav.signal}</strong></div><div><span>任务</span><strong>{n4Source ? '人工判读中' : uav.task}</strong></div><div><span>传感器</span><strong>{uav.sensor}</strong></div><div><span>链路</span><strong>{uav.link}</strong></div></div>
          <div className="n0-battery" aria-hidden="true"><i style={{ width: `${uav.battery}%` }} /></div>
        </div> })}
      </div>}
      {radarSupport && c1Radar?.trial && onC1TargetClick && onC1IntroComplete && (taskStatus === 'active' || taskStatus === 'marking') && <C1RadarCard trial={c1Radar.trial} directPresentation={directRadarSupport} guidedPresentation={guidedRadarSupport} intro={c1Radar.intro} elapsed={c1Radar.elapsed} capturedIds={c1Radar.capturedIds} detectedIds={c1Radar.detectedIds} wrongCount={c1Radar.wrongCount} feedback={c1Radar.feedback} paused={paused || c1Radar.introSuspended} onTargetClick={onC1TargetClick} onIntroComplete={onC1IntroComplete} />}
      {!radarSupport && support !== 'N2' && support !== 'N4' && (taskStatus === 'active' || taskStatus === 'marking' || taskStatus === 'recorded') && <div className="n0-event-layer" role="dialog" aria-label={`${taskQuestion.uavId} 突发任务`}>
        <div className="n0-event-top"><span>突发事件 / {taskQuestion.uavId}</span><strong>{taskStatus === 'recorded' ? '✓ 已记录' : `${taskRemaining.toFixed(1)}s`}</strong></div>
        <h2>{taskQuestion.title}</h2><p>{taskQuestion.prompt}</p>
        <div className="n0-event-options" role="group" aria-label="任务方案">
          {(['A', 'B', 'C'] as Answer[]).map(key => { const option = options[key]; return <button type="button" key={key} className={'n0-event-option' + (taskAnswer === key ? ' selected' : '')} disabled={paused || (taskStatus !== 'active' && !((support === 'N1' || support === 'N5') && taskStatus === 'marking'))} aria-pressed={taskAnswer === key} onClick={() => onTaskSelect(key)}><span className="n0-event-key">{key}</span><span><strong>方案 {key} · {option.label}</strong><small>{option.taskStage} · 覆盖 {option.currentCoverage}% · 线索 {option.unconfirmedClues} · 代价 {option.arrivalCost}</small></span></button> })}
        </div>
      </div>}
    </aside>
  </div>
}
