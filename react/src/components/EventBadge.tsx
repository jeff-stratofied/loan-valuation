import { useState } from 'react'
import { Tooltip } from './Tooltip'

export type EventType = 'prepayment' | 'deferral' | 'default'

export interface LoanEvent {
  type: EventType
  date?: string
  amount?: number
  months?: number
  startDate?: string
  recovered?: number
}

interface Props {
  type: EventType
  variant?: 'pill' | 'round'
  tooltip?: string
  event?: LoanEvent
}

const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const EVENT_MAP: Record<EventType, { icon: string; label: string; bg: string; color: string; border: string }> = {
  prepayment: { icon: '💰', label: 'Prepay',   bg: 'rgba(34,197,94,0.15)',  color: '#166534', border: 'rgba(34,197,94,0.35)'  },
  deferral:   { icon: '⏸',  label: 'Deferral', bg: 'rgba(234,179,8,0.15)', color: '#92400e', border: 'rgba(234,179,8,0.35)'  },
  default:    { icon: '⚠️', label: 'Default',  bg: 'rgba(239,68,68,0.12)', color: '#b91c1c', border: 'rgba(239,68,68,0.35)'  },
}

const ROUND_BG: Record<EventType, { bg: string; color: string }> = {
  prepayment: { bg: '#d1fae5', color: '#10b981' },
  deferral:   { bg: '#fef3c7', color: '#d97706' },
  default:    { bg: '#fee2e2', color: '#ef4444' },
}

function buildTooltipLines(type: EventType, event?: LoanEvent, tooltip?: string): string[] {
  if (tooltip) return [tooltip]
  if (!event) return [EVENT_MAP[type].label]

  switch (type) {
    case 'prepayment':
      return [
        'Prepayment',
        ...(event.date ? [`Date: ${event.date}`] : []),
        ...(event.amount ? [`Amount: ${fmt$(event.amount)}`] : []),
      ]

    case 'deferral':
      return [
        'Deferral',
        ...(event.startDate
          ? [`Start: ${event.startDate}`]
          : event.date
            ? [`Start: ${event.date}`]
            : []),
        ...(event.months ? [`Months: ${event.months}`] : []),
      ]

    case 'default':
      return [
        'Default',
        ...(event.date ? [`Date: ${event.date}`] : []),
        ...(event.recovered !== undefined
          ? [`Recovered: ${fmt$(event.recovered)}`]
          : []),
      ]

    default:
      return ['Event']
  }
}

export default function EventBadge({ type, variant = 'round', tooltip, event }: Props) {
  const [hovered, setHovered] = useState(false)
  const s = EVENT_MAP[type]
  const tooltipLines = buildTooltipLines(type, event, tooltip)
  const scaleStyle = { transform: hovered ? 'scale(1.25)' : 'scale(1)', transition: 'transform 0.15s ease' }

  if (variant === 'round') {
    const r = ROUND_BG[type]
    return (
      <Tooltip lines={tooltipLines}>
        <span
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%', fontSize: 13, lineHeight: '1',
            margin: '0 2px', border: '1px solid #e2e8f0',
            background: r.bg, color: r.color,
            cursor: 'pointer', flexShrink: 0,
            ...scaleStyle,
          }}
        >
          {s.icon}
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip lines={tooltipLines}>
      <span
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3,
          height: 20, padding: '2px 6px', fontSize: 11, fontWeight: 600,
          borderRadius: 999, border: `1px solid ${s.border}`,
          background: s.bg, color: s.color,
          cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          ...scaleStyle,
        }}
      >
        {s.icon} {s.label}
      </span>
    </Tooltip>
  )
}
