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
  presentation?: 'operational'
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
const compactMoney = (v: number) => {
  const unit = Math.abs(v) >= 1_000_000 ? 1_000_000 : Math.abs(v) >= 1_000 ? 1_000 : 1
  return `$${new Intl.NumberFormat('es-MX', { maximumFractionDigits: unit === 1 ? 0 : 2 }).format(v / unit)}${unit === 1_000_000 ? ' M' : unit === 1_000 ? ' mil' : ''}`
}

function operationalMax(max: number): number {
  if (max <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(max))
  // Evita que un máximo de 1.05 M se dibuje contra 2 M, dejando media gráfica vacía.
  return magnitude * ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(step => step >= max / magnitude) ?? 10)
}

function useSize<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const update = () => setSize(previous => {
      const next = { w: el.clientWidth, h: el.clientHeight }
      return previous.w === next.w && previous.h === next.h ? previous : next
    })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [active])
  return { ref, ...size }
}

export function ComboChart(props: ComboChartProps) {
  const { ref, w } = useSize<HTMLDivElement>()
  return <div ref={ref} className={s.chartResponsive}>
    {w > 0 && (w <= 640
      ? <MobileChart key={props.labels.join('|')} {...props} />
      : <ChartPlot {...props} />)}
  </div>
}

const detailMoney = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function MobileChart({ labels, series, leftTitle, rightTitle, presentation }: ComboChartProps) {
  const [selected, setSelected] = useState(Math.max(0, labels.length - 1))
  // Four legible months per window; selecting a month also selects its window.
  const end = labels.length - Math.floor((labels.length - 1 - selected) / 4) * 4
  const start = Math.max(0, end - 4)
  const groups = [
    { title: leftTitle || 'Evolución mensual', series: series.filter(se => se.axis !== 'y2') },
    { title: rightTitle || 'Ingresos', series: series.filter(se => se.axis === 'y2').map(se => ({ ...se, axis: 'y' as const })) },
  ].filter(group => group.series.length > 0)
  return <div className={s.chartMobile}>
    <div className={s.chartNavigation} aria-label="Periodos de la gráfica">
      <button type="button" aria-label="Ver meses anteriores" disabled={start === 0} onClick={() => setSelected(Math.max(0, start - 1))}>←</button>
      <span aria-live="polite">{labels[start]}{end - start > 1 ? ` – ${labels[end - 1]}` : ''}</span>
      <button type="button" aria-label="Ver meses siguientes" disabled={end >= labels.length} onClick={() => setSelected(end)}>→</button>
    </div>
    {groups.map(group => <section key={group.title} className={s.mobileChartPanel} aria-label={group.title}>
      <h3>{group.title}</h3>
      <div className={s.mobileChartLegend}>
        {group.series.map((se, i) => <span key={i}>
          <i aria-hidden="true" className={se.kind === 'line' ? s.legendLine : s.legendBar} style={{ color: se.color, ...(se.kind === 'line' ? { borderTopStyle: se.dashed ? 'dashed' : 'solid' } : { background: se.fill ?? se.color }) }} />
          {se.label}
        </span>)}
      </div>
      <div className={s.mobilePlot}>
        <ChartPlot labels={labels.slice(start, end)} series={group.series.map(se => ({ ...se, data: se.data.slice(start, end) }))} scaleSeries={group.series} presentation={presentation} selectedIndex={selected - start} onSelect={i => setSelected(start + i)} />
      </div>
    </section>)}
    <p className={s.mobileChartHint}>Toca un mes para ver sus importes. MXN{groups.length > 1 ? ' · Cada gráfica tiene su propia escala.' : '.'}</p>
    <div className={s.mobileChartDetail}>
      <label className={s.mobileMonthSelect}>Detalle del mes
        <select value={selected} onChange={event => setSelected(Number(event.target.value))}>
          {labels.map((label, i) => <option key={i} value={i}>{label}</option>)}
        </select>
      </label>
      <dl aria-live="polite" aria-atomic="true">
        {series.map((se, i) => <div key={i}>
          <dt>{se.label}</dt>
          <dd>{se.data[selected] == null ? 'Sin datos' : detailMoney.format(se.data[selected]!)}</dd>
        </div>)}
      </dl>
    </div>
  </div>
}

function ChartPlot({ labels, series, leftTitle, rightTitle, presentation, scaleSeries = series, selectedIndex, onSelect }: ComboChartProps & { scaleSeries?: Serie[]; selectedIndex?: number; onSelect?: (index: number) => void }) {
  const { ref, w, h } = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const operational = presentation === 'operational'
  const tooltip = useSize<HTMLDivElement>(operational && !!hover)
  const compact = operational && w < 520

  const hasRight = series.some((se) => se.axis === 'y2')
  const margin = operational ? { top: 26, bottom: 30, left: compact ? 60 : 74, right: hasRight ? (compact ? 60 : 74) : 16 } : { ...M, right: hasRight ? 54 : M.right }

  const plotL = margin.left
  const plotT = margin.top
  const plotW = Math.max(0, w - margin.left - margin.right)
  const plotH = Math.max(0, h - margin.top - margin.bottom)

  const leftSeries = scaleSeries.filter((se) => (se.axis ?? 'y') === 'y')
  const rightSeries = scaleSeries.filter((se) => se.axis === 'y2')

  const rawLeftMax = Math.max(0, ...leftSeries.flatMap((se) => se.data.map((v) => (v == null ? 0 : v))))
  const rawRightMax = Math.max(0, ...rightSeries.flatMap((se) => se.data.map((v) => (v == null ? 0 : v))))
  const leftMax = operational ? operationalMax(rawLeftMax) : niceMax(rawLeftMax)
  const rightMax = operational ? operationalMax(rawRightMax) : niceMax(rawRightMax)
  const tickLabel = operational ? compactMoney : kFmt

  const n = labels.length
  const band = n > 0 ? plotW / n : plotW
  const labelStride = operational ? Math.max(1, Math.ceil(32 / Math.max(band, 1))) : 1
  const cx = (i: number) => plotL + band * i + band / 2
  const yL = (v: number) => plotT + plotH * (1 - (leftMax > 0 ? v / leftMax : 0))
  const yR = (v: number) => plotT + plotH * (1 - (rightMax > 0 ? v / rightMax : 0))

  const barSeries = series.filter((se) => se.kind === 'bar')
  const nBars = barSeries.length
  const groupW = operational ? Math.min(band * 0.68, 76) : band * 0.72
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

  const leftTicks = operational && rawLeftMax === 0 ? [0] : ticksFor(leftMax)
  const rightTicks = operational && rawRightMax === 0 ? [0] : ticksFor(rightMax)

  function onMove(e: MouseEvent<HTMLDivElement>) {
    if (!w || n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < plotL || px > plotL + plotW) { setHover(null); return }
    const i = Math.min(n - 1, Math.max(0, Math.floor((px - plotL) / band)))
    if (onSelect) onSelect(i)
    else setHover({ i, x: px, y: e.clientY - rect.top })
  }

  const ready = w > 0 && h > 0
  // El recuadro se mide y cambia de lado al acercarse a un borde. Siempre queda
  // dentro de la gráfica, también después de un resize o de envolver sus textos.
  const tooltipLeft = hover ? Math.max(6, Math.min(
    hover.x + 12 + tooltip.w > w - 6 ? hover.x - tooltip.w - 12 : hover.x + 12,
    w - tooltip.w - 6,
  )) : 6
  const tooltipTop = hover ? Math.max(6, Math.min(
    hover.y + 12 + tooltip.h > h - 6 ? hover.y - tooltip.h - 12 : hover.y + 12,
    h - tooltip.h - 6,
  )) : 6

  return (
    <div ref={ref} className={`${s.chartSvgWrap} ${compact ? s.chartCompact : ''}`} onMouseMove={onSelect ? undefined : onMove} onMouseLeave={() => setHover(null)} onClick={onSelect ? onMove : undefined} onPointerDown={!onSelect && operational ? onMove : undefined}>
      {ready && (
        <svg width={w} height={h} className={s.chartSvg} role="img" aria-label="Gráfica del dashboard">
          {/* Gridlines + ticks eje izquierdo */}
          {leftTicks.map((t, i) => {
            const y = yL(t)
            return (
              <g key={`l${i}`}>
                <line x1={plotL} y1={y} x2={plotL + plotW} y2={y} className={s.chartGrid} />
                <text x={plotL - (operational ? 8 : 6)} y={y + 3} textAnchor="end" className={s.chartTick}>{tickLabel(t)}</text>
              </g>
            )
          })}
          {/* Ticks eje derecho */}
          {hasRight && rightTicks.map((t, i) => {
            const y = yR(t)
            return (
              <text key={`r${i}`} x={plotL + plotW + (operational ? 8 : 6)} y={y + 3} textAnchor="start" className={s.chartTick}>{tickLabel(t)}</text>
            )
          })}
          {/* Títulos de eje */}
          {leftTitle && (
            <text x={plotL} y={plotT - 3} textAnchor="start" className={s.chartAxisTitle}>{compact ? 'Presup. / uso' : leftTitle}</text>
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
                  rx={operational ? 5 : 3}
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
                    strokeWidth={operational ? (se.dashed ? 2.5 : 3) : 2}
                    strokeDasharray={se.dashed ? (operational ? '7 6' : '5 4') : undefined}
                    strokeLinecap={operational ? 'round' : undefined}
                    strokeLinejoin={operational ? 'round' : undefined}
                  />
                ))}
                {se.data.map((v, i) => (v == null ? null : (
                  <circle key={`pt${i}`} cx={cx(i)} cy={yFn(v)} r={operational ? 3.5 : 2.6} fill={operational && se.dashed ? 'var(--bg-card)' : se.color} stroke={operational ? se.color : undefined} strokeWidth={operational ? 2 : undefined} />
                )))}
              </g>
            )
          })}
          {/* Etiquetas X */}
          {labels.map((lbl, i) => {
            // Se espacian las etiquetas, pero todos los meses conservan sus puntos
            // y su detalle al pasar el cursor o tocar la gráfica.
            if (i !== 0 && i !== n - 1 && (i % labelStride !== 0 || (operational && (n - 1 - i) * band < 32))) return null
            return <text key={`x${i}`} x={cx(i)} y={plotT + plotH + 16} textAnchor="middle" className={`${s.chartTick} ${selectedIndex === i ? s.selectedTick : ''}`}>{lbl}</text>
          })}
          {/* Banda de hover */}
          {(hover || selectedIndex != null) && (
            <line x1={cx(selectedIndex ?? hover!.i)} y1={plotT} x2={cx(selectedIndex ?? hover!.i)} y2={plotT + plotH} className={s.chartHoverLine} />
          )}
        </svg>
      )}
      {hover && (
        <div
          ref={tooltip.ref}
          className={s.chartTooltip}
          style={operational ? { left: tooltipLeft, top: tooltipTop } : { left: Math.max(0, Math.min(hover.x + 12, (w || 0) - 160)), top: Math.max(4, hover.y - 10) }}
        >
          <div className={s.chartTooltipTitle}>{labels[hover.i]}</div>
          {series.map((se, i) => {
            const v = se.data[hover.i]
            if (v == null) return null
            return (
              <div key={i} className={s.chartTooltipRow}>
                <span className={s.chartTooltipDot} style={{ background: se.color }} />
                {se.label}: {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: operational ? 2 : 0, maximumFractionDigits: operational ? 2 : 0 }).format(v)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
