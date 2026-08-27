import type { CSSProperties } from 'react'
import s from './Skeleton.module.css'

// Bloque skeleton con shimmer (estático bajo prefers-reduced-motion).
export function Skeleton({
  width = '100%',
  height = 12,
  radius = 6,
  style,
}: {
  width?: number | string
  height?: number | string
  radius?: number
  style?: CSSProperties
}) {
  return <span className={s.skeleton} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />
}

// Anchos variados por columna para que las filas skeleton se vean naturales.
const WIDTHS = [72, 54, 46, 62, 40, 52, 64, 36, 48, 58]
function colWidth(c: number, cols: number): string {
  return `${c === cols - 1 ? 38 : WIDTHS[c % WIDTHS.length]}%`
}

// Filas skeleton para una tabla: `rows` filas × `cols` celdas. Va dentro del
// <tbody> de la feature; las celdas heredan el padding/borde de la tabla.
export function TableSkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}><Skeleton width={colWidth(c, cols)} /></td>
          ))}
        </tr>
      ))}
    </>
  )
}
