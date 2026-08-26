// Íconos SVG line (currentColor). Cero emojis.
type P = { size?: number }
const svg = (size = 18) =>
  ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
     strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

export const IcSolicitudes = ({ size }: P) => (
  <svg {...svg(size)}><rect x="5" y="3" width="14" height="18" rx="2" /><line x1="8.5" y1="8" x2="15.5" y2="8" /><line x1="8.5" y1="12" x2="15.5" y2="12" /><line x1="8.5" y1="16" x2="13" y2="16" /></svg>
)
export const IcLayouts = ({ size }: P) => (
  <svg {...svg(size)}><polygon points="12 3 21 8 12 13 3 8" /><polyline points="3 12 12 17 21 12" /><polyline points="3 16 12 21 21 16" /></svg>
)
export const IcEfectivo = ({ size }: P) => (
  <svg {...svg(size)}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.4" /></svg>
)
export const IcIngresos = ({ size }: P) => (
  <svg {...svg(size)}><path d="M12 4v9" /><path d="M8.5 9.5 12 13l3.5-3.5" /><path d="M4 19h16" /></svg>
)
export const IcIncidencias = ({ size }: P) => (
  <svg {...svg(size)}><path d="M12 4 3 19.5h18z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="16.8" r=".4" /></svg>
)
export const IcProveedores = ({ size }: P) => (
  <svg {...svg(size)}><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M9 20v-4h6v4" /><line x1="8" y1="8" x2="8.01" y2="8" /><line x1="12" y1="8" x2="12.01" y2="8" /><line x1="16" y1="8" x2="16.01" y2="8" /></svg>
)
export const IcDashboard = ({ size }: P) => (
  <svg {...svg(size)}><rect x="3" y="3" width="7" height="7" rx="1.3" /><rect x="14" y="3" width="7" height="7" rx="1.3" /><rect x="3" y="14" width="7" height="7" rx="1.3" /><rect x="14" y="14" width="7" height="7" rx="1.3" /></svg>
)
export const IcAprobaciones = ({ size }: P) => (
  <svg {...svg(size)}><circle cx="12" cy="12" r="9" /><path d="M8 12l2.8 2.8L16 9" /></svg>
)
export const IcConfig = ({ size }: P) => (
  <svg {...svg(size)}><line x1="4" y1="8" x2="20" y2="8" /><circle cx="9" cy="8" r="2.3" /><line x1="4" y1="16" x2="20" y2="16" /><circle cx="15" cy="16" r="2.3" /></svg>
)
export const IcUser = ({ size }: P) => (
  <svg {...svg(size)}><circle cx="12" cy="8" r="4" /><path d="M4.5 20c0-4 3.5-6 7.5-6s7.5 2 7.5 6" /></svg>
)
export const IcLogout = ({ size }: P) => (
  <svg {...svg(size)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
)
export const IcTheme = ({ size }: P) => (
  <svg {...svg(size)}><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" /></svg>
)
export const IcSearch = ({ size }: P) => (
  <svg {...svg(size)}><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></svg>
)
export const IcPlus = ({ size }: P) => (
  <svg {...svg(size)} strokeWidth={2.1}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
