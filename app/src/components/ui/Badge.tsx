import s from './Badge.module.css'

export type BadgeVariant = 'success' | 'neutral' | 'info' | 'warning' | 'danger' | 'accent'

export function Badge({ children, variant = 'neutral', title }: { children: React.ReactNode; variant?: BadgeVariant; title?: string }) {
  return <span className={`${s.badge} ${s[variant]}`} title={title}>{children}</span>
}
