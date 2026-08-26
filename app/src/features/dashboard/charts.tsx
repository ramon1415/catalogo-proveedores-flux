import { useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import s from './Dashboard.module.css'

// Reemplazo de Chart.js con SVG inline (sin dependencias externas, CSP-safe).
// Un único ComboChart cubre las tres gráficas del dashboard:
//  - operativa: barras (Presupuesto/Ejecutado) eje izq + líneas (Esperado/Cobrado) eje der
//  - histórico anual: barras Egresos + línea Ingresos, eje único
//  - todos los años: múltiples líneas (Egresos sólida / Ingresos punteada) por año

export type Serie = {
  kind: 'bar' | 'line'
  label: string
  data: (number | null)[]
  color: string
  fill?: string
  dashed?: boolean
  axis?: 'y' | 'y2'
}

type ComboChartProps = {
  labels: string[]
  series: Serie[]
  leftTitle?: string
  rightTitle?: string
}

const M = { top: 14, right: 16, bottom: 26, left: 54 }

function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const n = max / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}

function ticksFor(max: number, count = 4): number[] {
  const out: number[] = []
  for (let i = 0; i <= count; i++) out.push((max / count) * i)
  return out
}

const kFmt = (v: number) => `$${(v / 1000).toFixed(0)}k`

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, ...size }
}

export function ComboChart({ labels, series, leftTitle, rightTitle }: ComboChartProps) {
  const { ref, w, h } = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)

  const hasRight = series.some((se) => se.axis === 'y2')
  const margin = { ...M, right: hasRight ? 54 : M.right }

  const plotL = margin.left
  const plotT = margin.top
  const plotW = Math.max(0, w - margin.left - margin.right)
  const plotH = Math.max(0, h - margin.top - margin.bottom)

  const leftSeries = series.filter((se) => (se.axis ?? 'y') === 'y')
  const rightSeries = series.filter((se) => se.axis === 'y2')

  const rawLeftMax = Math.max(0, ...leftSeries.flatMap((se) => se.data.map((v) => (v == null ? 0 : v))))
  const rawRightMax = Math.max(0, ...rightSeries.flatMap((se) => se.data.map((v) => (v == null ? 0 : v))))
  const leftMax = niceMax(rawLeftMax)
  const rightMax = niceMax(rawRightMax)

  const n = labels.length
  const band = n > 0 ? plotW / n : plotW
  const cx = (i: number) => plotL + band * i + band / 2
  const yL = (v: number) => plotT + plotH * (1 - (leftMax > 0 ? v / leftMax : 0))
  const yR = (v: number) => plotT + plotH * (1 - (rightMax > 0 ? v / rightMax : 0))

  const barSeries = series.filter((se) => se.kind === 'bar')
  const nBars = barSeries.length
  const groupW = band * 0.72
  const barW = nBars > 0 ? groupW / nBars : 0

  // Segmentos de línea (rompe en null → spanGaps:false)
  function lineSegments(data: (number | null)[], yFn: (v: number) => number): string[] {
    const segs: string[] = []
    let cur: string[] = []
    data.forEach((v, i) => {
      if (v == null) {
        if (cur.length) segs.push(cur.join(' '))
        cur = []
        return
      }
      cur.push(`${cx(i)},${yFn(v)}`)
    })
    if (cur.length) segs.push(cur.join(' '))
    return segs
  }

  const leftTicks = ticksFor(leftMax)
  const rightTicks = ticksFor(rightMax)

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (!w || n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < plotL || px > plotL + plotW) { setHover(null); return }
    const i = Math.min(n - 1, Math.max(0, Math.floor((px - plotL) / band)))
    setHover({ i, x: px, y: e.clientY - rect.top })
  }

  const ready = w > 0 && h > 0

  return (
    <div ref={ref} className={s.chartSvgWrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {ready && (
        <svg width={w} height={h} className={s.chartSvg} role="img" aria-label="Gráfica del dashboard">
          {/* Gridlines + ticks eje izquierdo */}
          {leftTicks.map((t, i) => {
            const y = yL(t)
            return (
              <g key={`l${i}`}>
                <line x1={plotL} y1={y} x2={plotL + plotW} y2={y} className={s.chartGrid} />
                <text x={plotL - 6} y={y + 3} textAnchor="end" className={s.chartTick}>{kFmt(t)}</text>
              </g>
            )
          })}
          {/* Ticks eje derecho */}
          {hasRight && rightTicks.map((t, i) => {
            const y = yR(t)
            return (
              <text key={`r${i}`} x={plotL + plotW + 6} y={y + 3} textAnchor="start" className={s.chartTick}>{kFmt(t)}</text>
            )
          })}
          {/* Títulos de eje */}
          {leftTitle && (
            <text x={plotL} y={plotT - 3} textAnchor="start" className={s.chartAxisTitle}>{leftTitle}</text>
          )}
          {hasRight && rightTitle && (
            <text x={plotL + plotW} y={plotT - 3} textAnchor="end" className={s.chartAxisTitle}>{rightTitle}</text>
          )}
          {/* Barras */}
          {barSeries.map((se, bi) =>
            se.data.map((v, i) => {
              if (v == null || v <= 0) return null
              const yFn = (se.axis ?? 'y') === 'y2' ? yR : yL
              const y = yFn(v)
              const x = cx(i) - groupW / 2 + bi * barW
              const height = plotT + plotH - y
              return (
                <rect
                  key={`b${bi}-${i}`}
                  x={x + 0.5}
                  y={y}
                  width={Math.max(0, barW - 1)}
                  height={Math.max(0, height)}
                  rx={3}
                  fill={se.fill ?? se.color}
                  stroke={se.color}
                  strokeWidth={1}
                />
              )
            }),
          )}
          {/* Líneas */}
          {series.filter((se) => se.kind === 'line').map((se, li) => {
            const yFn = (se.axis ?? 'y') === 'y2' ? yR : yL
            const segs = lineSegments(se.data, yFn)
            return (
              <g key={`line${li}`}>
                {segs.map((pts, si) => (
                  <polyline
                    key={si}
                    points={pts}
                    fill="none"
                    stroke={se.color}
                    strokeWidth={2}
                    strokeDasharray={se.dashed ? '5 4' : undefined}
                  />
                ))}
                {se.data.map((v, i) => (v == null ? null : (
                  <circle key={`pt${i}`} cx={cx(i)} cy={yFn(v)} r={2.6} fill={se.color} />
                )))}
              </g>
            )
          })}
          {/* Etiquetas X */}
          {labels.map((lbl, i) => (
            <text key={`x${i}`} x={cx(i)} y={plotT + plotH + 16} textAnchor="middle" className={s.chartTick}>{lbl}</text>
          ))}
          {/* Banda de hover */}
          {hover && (
            <line x1={cx(hover.i)} y1={plotT} x2={cx(hover.i)} y2={plotT + plotH} className={s.chartHoverLine} />
          )}
        </svg>
      )}
      {hover && (
        <div
          className={s.chartTooltip}
          style={{ left: Math.min(hover.x + 12, (w || 0) - 160), top: Math.max(4, hover.y - 10) }}
        >
          <div className={s.chartTooltipTitle}>{labels[hover.i]}</div>
          {series.map((se, i) => {
            const v = se.data[hover.i]
            if (v == null) return null
            return (
              <div key={i} className={s.chartTooltipRow}>
                <span className={s.chartTooltipDot} style={{ background: se.color }} />
                {se.label}: {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
