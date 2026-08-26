import s from './Badge.module.css'

export type BadgeVariant = 'success' | 'neutral' | 'info' | 'warning' | 'danger' | 'accent'

export function Badge({ children, variant = 'neutral' }: { children: React.ReactNode; variant?: BadgeVariant }) {
  return <span className={`${s.badge} ${s[variant]}`}>{children}</span>
}
