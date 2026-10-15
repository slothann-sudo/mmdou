import { useEffect, useRef } from 'react'
import { isInScan, isScanTargetEligible, scanOrigin, type ScanTargetKind, type ScanTrial } from './c1RadarTrial'

function polar(x: number, y: number, angle: number, distance: number) {
  const radians = angle * Math.PI / 180
  return { x: x + Math.sin(radians) * distance, y: y - Math.cos(radians) * distance }
}
function fanPath(x: number, y: number, radius: number, halfAngle: number) {
  const left = polar(x, y, -halfAngle, radius)
  const right = polar(x, y, halfAngle, radius)
  return `M ${x} ${y} L ${left.x} ${left.y} A ${radius} ${radius} 0 0 1 ${right.x} ${right.y} Z`
}
function arcPath(x: number, y: number, radius: number, halfAngle: number) {
  const left = polar(x, y, -halfAngle, radius)
  const right = polar(x, y, halfAngle, radius)
  return `M ${left.x} ${left.y} A ${radius} ${radius} 0 0 1 ${right.x} ${right.y}`
}
function TargetIcon({ kind }: { kind: ScanTargetKind }) {
  if (kind === 'vehicle') return <><rect x="-8" y="-6" width="16" height="12" rx="2" /><path d="M-4-6v-3m8 3v-3M-4 6v3m8-3v3M-4-3h8v6h-8z" /></>
  if (kind === 'facility') return <><rect x="-8" y="-8" width="16" height="16" /><path d="M-4-8v-4h8v4M-8-3h16M-3 8V2h6v6" /></>
  return <><path d="M0-10 9 7H-9Z" /><path d="M-4 8h8M0-5v7" /></>
}

export function C1RadarCard({ trial, directPresentation, guidedPresentation, intro, elapsed, capturedIds, detectedIds, wrongCount, feedback, paused, onTargetClick, onIntroComplete }: {
  trial: ScanTrial; elapsed: number; capturedIds: string[]; detectedIds: string[]; feedback: { targetId: string; atSeconds: number } | null
  intro: boolean; directPresentation: boolean; guidedPresentation: boolean; wrongCount: number
  paused: boolean; onTargetClick: (targetId: string) => void; onIntroComplete: () => void
}) {
  const introLightRef = useRef<HTMLDivElement>(null)
  const completeRef = useRef(onIntroComplete)
  completeRef.current = onIntroComplete
  useEffect(() => {
    if (!intro || paused) return
    const element = introLightRef.current
    if (!element) return
    const animations = element.getAnimations()
    if (!animations.length) { queueMicrotask(() => completeRef.current()); return }
    let cancelled = false
    void Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {
      if (!cancelled) completeRef.current()
    })
    return () => { cancelled = true }
  }, [intro, paused])
  const { params } = trial
  const detected = new Set(detectedIds)
  const origin = scanOrigin(trial, elapsed)
  const progress = Math.min(100, elapsed / params.durationSeconds * 100)
  return <div className={'c1-radar-card' + (directPresentation ? ' c3-direct-card' : '') + (guidedPresentation ? ' c1-guided-card' : '')} role="region" aria-label="UAV-02 动态目标扫描与捕获">
    <div className="c1-scan-head"><div><strong>UAV-02｜动态目标扫描</strong>{directPresentation && <small>{intro ? '待立即处理' : '侦察任务进行中'}</small>}</div><span>{intro ? '启动中' : `${directPresentation || guidedPresentation ? '剩余时间 ' : ''}${Math.max(0, params.durationSeconds - elapsed).toFixed(1)}s`}</span></div>
    <p className="c1-radar-instruction">{params.targetRetention ? '捕获侦察记录中的橙色车辆目标' : '捕获扫描范围内的橙色车辆目标'}</p>
    <div className="c1-scan-progress" aria-label={`扫描进度 ${Math.round(progress)}%`}><i style={{ width: `${progress}%` }} /></div>
    <div className="c1-scan-map-wrap"><svg className="c1-scan-map" viewBox="0 0 300 360" role="group" aria-label="动态扇形扫描地图">
      <defs><pattern id="c1-map-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" /></pattern></defs>
      <rect width="300" height="360" fill="url(#c1-map-grid)" />
      <path className="c1-route" d="M150 360V0" />
      <path className="c1-scan-fan" d={fanPath(origin.x, origin.y, params.radius, params.halfAngleDegrees)} />
      {[.33, .66, 1].map(fraction => <path key={fraction} className="c1-distance-arc" d={arcPath(origin.x, origin.y, params.radius * fraction, params.halfAngleDegrees)} />)}
      <path className="c1-fan-border" d={fanPath(origin.x, origin.y, params.radius, params.halfAngleDegrees)} />
      <line className="c1-scan-glint" x1={origin.x} y1={origin.y} x2={polar(origin.x, origin.y, -params.halfAngleDegrees + (elapsed * 90) % (params.halfAngleDegrees * 2), params.radius).x} y2={polar(origin.x, origin.y, -params.halfAngleDegrees + (elapsed * 90) % (params.halfAngleDegrees * 2), params.radius).y} />
      {trial.targets.map(target => {
        const within = isInScan(trial, target, elapsed)
        const eligible = isScanTargetEligible(trial, target, elapsed, detected)
        const historical = params.targetRetention && detected.has(target.id) && !within
        const captured = capturedIds.includes(target.id)
        const flashing = feedback?.targetId === target.id && elapsed - feedback.atSeconds < .45
        return <g key={target.id} className={'c1-scan-target ' + target.kind + (within ? ' in-range' : ' out-range') + (historical ? ' detected-history' : '') + (captured ? ' captured' : '') + (flashing ? ' feedback' : '')} transform={`translate(${target.x} ${target.y})`} role="button" tabIndex={eligible && !captured && !paused && !intro ? 0 : -1} aria-label={`${target.kind === 'vehicle' ? '车辆' : target.kind === 'facility' ? '固定设施' : '干扰目标'}${within ? '，位于扫描范围内' : historical ? '，已侦察记录' : params.targetRetention ? '，尚未扫描' : '，位于扫描范围外'}${captured ? '，已捕获' : ''}`} aria-disabled={!eligible || captured || paused || intro} onPointerDown={event => { if (!paused && !intro && (event.pointerType !== 'mouse' || event.button === 0)) onTargetClick(target.id) }} onKeyDown={event => { if (!paused && !intro && eligible && !captured && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onTargetClick(target.id) } }}>
          <circle className="c1-target-hit" r="14" />
          <g className="c1-target-shape"><TargetIcon kind={target.kind} /></g>
          {flashing && <circle className="c1-capture-flash" r="14" />}
        </g>
      })}
      <g className="c1-uav-symbol" transform={`translate(${origin.x} ${origin.y})`}><path d="M0-10 9 7 0 3 -9 7Z" /><path d="M0 3v11" /></g>
    </svg>{intro && <div ref={introLightRef} className={'c1-intro-light' + (paused ? ' is-paused' : '')} role="status" aria-label="扫描任务启动中" onAnimationEnd={event => { if (event.target === event.currentTarget && event.animationName === 'c1-light-expand') onIntroComplete() }} />}</div>
    <div className="c1-scan-legend" aria-label="目标图例"><span><svg viewBox="-14 -14 28 28" aria-hidden="true"><g className="c1-target-shape vehicle-icon"><TargetIcon kind="vehicle" /></g></svg>橙色车辆 = 有效目标</span><span><svg viewBox="-14 -14 28 28" aria-hidden="true"><g className="c1-target-shape other-icon"><TargetIcon kind="facility" /></g></svg><svg viewBox="-14 -14 28 28" aria-hidden="true"><g className="c1-target-shape other-icon"><TargetIcon kind="distractor" /></g></svg>其他图标 = 无效目标</span></div>
    <div className="c1-capture-count"><span>已捕获 <strong>{capturedIds.length} / {params.vehicleCount}</strong></span><span>误选 <strong>{wrongCount}</strong></span></div>
  </div>
}
