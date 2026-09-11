import { IcUser } from '../../components/ui/icons'
import { requesterDisplayName } from './logic'
import type { Profile } from './types'
import s from './Solicitudes.module.css'

export function RequesterIdentity({ profile, compact = false }: {
  profile?: Profile | null
  compact?: boolean
}) {
  return (
    <div className={`${s.requesterIdentity} ${compact ? s.requesterCompact : s.requesterHeader}`}>
      <span className={s.requesterIcon} aria-hidden="true"><IcUser size={compact ? 14 : 17} /></span>
      <span className={s.requesterText}>
        <span className={s.requesterLabel}>Solicitante{compact ? ':' : ''}</span>{' '}
        <strong className={s.requesterName}>{requesterDisplayName(profile)}</strong>
      </span>
    </div>
  )
}
