import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'

import { useLoans } from '../hooks/useLoans'
import { useUser } from '../context/UserContext'

import LoanTable from '../components/LoanTable'
import LoanDrawer from '../components/LoanDrawer'
import KpiDrawer from '../components/KpiDrawer'

import type { KpiType } from '../components/KpiDrawer'
import type { Loan2 } from '../components/LoanTable'
import AppShell from '../components/AppShell'

import { buildAmortSchedule } from '../utils/amortEngine'
import OwnershipPie from '../components/OwnershipPie'

const fmt$ = (n: number) =>
  Number(n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtPct = (n: number) => `${Number(n || 0).toFixed(2)}%`

const fmtMY = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const fmtShortMY = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const btnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const drawerSectionTitle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--text)',
  marginBottom: 8,
}

const drawerTableWrap: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  maxHeight: '45vh',
  overflow: 'auto',
  background: 'var(--card)',
}

const drawerTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

const drawerThStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: 'var(--muted)',
  fontWeight: 700,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
  position: 'sticky',
  top: 0,
  background: 'var(--background-alt, #f8fafc)',
}

const drawerThR: React.CSSProperties = {
  ...drawerThStyle,
  textAlign: 'right',
}

const drawerTdL: React.CSSProperties = {
  padding: '9px 10px',
  borderBottom: '1px solid var(--border)',
}

const drawerTdR: React.CSSProperties = {
  ...drawerTdL,
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

function KpiTile({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--card)',
        borderRadius: 10,
        padding: '12px 16px',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow)',
        cursor: 'pointer',
        flex: 1,
        minWidth: 0,
        transition: 'transform 0.18s',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '12px 14px',
        background: 'var(--card)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800 }}>{value}</div>
    </div>
  )
}

function getLoanSchedule(loan: any) {
  if (Array.isArray(loan?.amort?.schedule) && loan.amort.schedule.length > 0) {
    return loan.amort.schedule
  }

  return buildAmortSchedule({
    loanId: loan?.loanId ?? loan?.id ?? '',
    loanName: loan?.loanName ?? loan?.name ?? '',
    principal: Number(loan?.principal ?? loan?.origLoanAmt ?? loan?.loanAmount ?? 0),
    nominalRate: Number(loan?.nominalRate ?? 0),
    termYears: Number(loan?.termYears ?? 10),
    graceYears: Number(loan?.graceYears ?? 0),
    loanStartDate: loan?.loanStartDate,
    purchaseDate: loan?.purchaseDate,
    events: loan?.events ?? [],
  })
}

function getLoanPrimaryEventType(loan: any) {
  if (!Array.isArray(loan?.events)) return null
  if (loan.events.some((e: any) => e.type === 'default')) return 'default'
  if (loan.events.some((e: any) => e.type === 'deferral')) return 'deferral'
  if (loan.events.some((e: any) => e.type === 'prepayment')) return 'prepayment'
  return null
}

function sortEvents(events: any[] = []) {
  return [...events].sort((a, b) => {
    const da = new Date(a.date || a.startDate || 0).getTime()
    const db = new Date(b.date || b.startDate || 0).getTime()
    return da - db
  })
}

function EventBadge({
  event,
}: {
  event: any
}) {
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  const tooltipLines =
    event.type === 'prepayment'
      ? [
          'Prepayment',
          `Date: ${event.date ?? '—'}`,
          `Amount: ${fmt$(Number(event.amount ?? 0))}`,
        ]
      : event.type === 'deferral'
        ? [
            'Deferral',
            `Start: ${event.startDate ?? event.date ?? '—'}`,
            `Months: ${String(event.months ?? 0)}`,
          ]
        : [
            'Default',
            `Date: ${event.date ?? '—'}`,
            `Recovered: ${fmt$(Number(event.recovered ?? event.recoveryAmount ?? 0))}`,
          ]

  const cls =
    event.type === 'default'
      ? {
          bg: 'rgba(239,68,68,0.12)',
          color: '#b91c1c',
          border: 'rgba(239,68,68,0.35)',
          label: '⚠️ Default',
        }
      : event.type === 'deferral'
        ? {
            bg: 'rgba(234,179,8,0.15)',
            color: '#92400e',
            border: 'rgba(234,179,8,0.35)',
            label: '⏸ Deferral',
          }
        : {
            bg: 'rgba(34,197,94,0.15)',
            color: '#166534',
            border: 'rgba(34,197,94,0.35)',
            label: '💰 Prepay',
          }

  return (
    <div
  style={{ display: 'inline-flex' }}
  onMouseEnter={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
  onMouseMove={(e) => setTooltipPos({ x: e.clientX, y: e.clientY })}
  onMouseLeave={() => setTooltipPos(null)}
>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          height: 20,
          lineHeight: 1,
          padding: '2px 6px',
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 999,
          border: `1px solid ${cls.border}`,
          background: cls.bg,
          color: cls.color,
          cursor: 'default',
        }}
      >
        {cls.label}
      </span>
      {tooltipPos &&
  createPortal(
    <div
      style={{
        position: 'fixed',
        left: tooltipPos.x + 10,
        top: tooltipPos.y - 10,
        transform: 'translateY(-100%)',
        background: '#0f172a',
        color: '#f8fafc',
        padding: '6px 10px',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
        boxShadow: '0 6px 18px rgba(2,6,23,0.2)',
        border: '1px solid rgba(148,163,184,0.3)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 99999,
      }}
    >
      {tooltipLines.map((line, idx) => (
        <div key={idx} style={{ fontWeight: idx === 0 ? 700 : 400 }}>
          {line}
        </div>
      ))}
    </div>,
    document.body
  )}

    </div>
  )
}

function OwnershipBadge({ loan }: { loan: Loan2 }) {
  const rawPct = Number((loan as any).ownershipPct ?? (loan as any).userOwnershipPct ?? 0)
  const ownershipPct = Math.max(0, Math.min(1, rawPct > 1 ? rawPct / 100 : rawPct))

  const ownershipColor = String((loan as any).loanColor ?? '#0ea5e9')

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      <OwnershipPie userPct={ownershipPct} marketPct={0} color={ownershipColor} size={26} />
    </div>
  )
}

function AmortMiniChart({
  loan,
  compact = false,
}: {
  loan: Loan2
  compact?: boolean
}) {
  const schedule = useMemo(() => getLoanSchedule(loan), [loan])

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

const series = useMemo(() => {
  let cumPrincipal = 0
  let cumInterest = 0

  return schedule.map((r: any, i: number) => {
    const principalThisMonth =
      Number(r.principalPaid ?? r.scheduledPrincipal ?? 0) + Number(r.prepaymentPrincipal ?? 0)
    const interestThisMonth = Number(r.interest ?? 0)

    cumPrincipal += principalThisMonth
    cumInterest += interestThisMonth

    const loanDate =
      r.loanDate instanceof Date ? r.loanDate : r.loanDate ? new Date(r.loanDate) : null

    return {
      i,
      date: loanDate,
      balance: Number(r.balance ?? 0),
      cumPrincipal,
      cumInterest,
      principalThisMonth,
      interestThisMonth,
    }
  })
}, [schedule])

  if (compact || series.length === 0) return null

  const W = 170
  const H = 48
  const PAD = 6
  const allY = series.flatMap((s) => [s.balance, s.cumPrincipal, s.cumInterest])
  const minY = Math.min(...allY)
  const maxY = Math.max(...allY)
  const range = Math.max(1, maxY - minY)

  const xAt = (i: number) => PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2)
  const yAt = (v: number) => PAD + (H - PAD * 2) - ((v - minY) / range) * (H - PAD * 2)

  const pathFor = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).join(' ')

  const principalPath = pathFor(series.map((s) => s.cumPrincipal))
  const interestPath = pathFor(series.map((s) => s.cumInterest))

  const now = new Date()
  const currentIdx = schedule.findIndex((r: any) => {
    const d = r.loanDate instanceof Date ? r.loanDate : new Date(r.loanDate)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  })

  const purchaseDate = (loan as any).purchaseDate ? new Date((loan as any).purchaseDate) : null
  const purchaseIdx =
    purchaseDate == null
      ? -1
      : schedule.findIndex((r: any) => {
          const d = r.loanDate instanceof Date ? r.loanDate : new Date(r.loanDate)
          return d.getFullYear() === purchaseDate.getFullYear() && d.getMonth() === purchaseDate.getMonth()
        })
        const hoverRow =
        hoverIndex != null && hoverIndex >= 0 && hoverIndex < series.length
          ? series[hoverIndex]
          : null
        
  return (
    <div
    style={{
      width: 170,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      position: 'relative',
      overflow: 'visible',
    }}
  >
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
        Rate {Number((loan as any).nominalRate ?? 0).toFixed(2)}%
      </div>

      <svg
  viewBox={`0 0 ${W} ${H}`}
  style={{ width: 170, height: 48, display: 'block', overflow: 'visible' }}
  onMouseLeave={() => {
    setHoverIndex(null)
    setTooltipPos(null)
  }}
>
        {purchaseIdx >= 0 && (
          <line
            x1={xAt(purchaseIdx)}
            x2={xAt(purchaseIdx)}
            y1={2}
            y2={H - 2}
            stroke="#22c55e"
            strokeDasharray="3 3"
            strokeOpacity="0.8"
          />
        )}

        {currentIdx >= 0 && (
          <line
            x1={xAt(currentIdx)}
            x2={xAt(currentIdx)}
            y1={2}
            y2={H - 2}
            stroke="#111827"
            strokeDasharray="3 3"
            strokeOpacity="0.6"
          />
        )}

        <path d={interestPath} fill="none" stroke="#a78bfa" strokeWidth="1.6" />
        <path d={principalPath} fill="none" stroke="#06b6d4" strokeWidth="1.6" />
        {hoverRow && (
          <>
            <line
              x1={xAt(hoverRow.i)}
              x2={xAt(hoverRow.i)}
              y1={2}
              y2={H - 2}
              stroke="#64748b"
              strokeDasharray="3 3"
              strokeOpacity="0.8"
            />
            <circle cx={xAt(hoverRow.i)} cy={yAt(hoverRow.cumPrincipal)} r="3.5" fill="#06b6d4" />
            <circle cx={xAt(hoverRow.i)} cy={yAt(hoverRow.cumInterest)} r="3.5" fill="#a78bfa" />
          </>
        )}

        {series.map((_, i) => {
          const xPrev = i === 0 ? PAD : xAt(i - 1)
          const xCurr = xAt(i)
          const xNext = i === series.length - 1 ? W - PAD : xAt(i + 1)

          const left = i === 0 ? PAD : (xPrev + xCurr) / 2
          const right = i === series.length - 1 ? W - PAD : (xCurr + xNext) / 2

          return (
            <rect
              key={i}
              x={left}
              y={0}
              width={Math.max(8, right - left)}
              height={H}
              fill="transparent"
              onMouseEnter={(e) => {
                setHoverIndex(i)
                setTooltipPos({ x: e.clientX, y: e.clientY })
              }}
              onMouseMove={(e) => {
                setHoverIndex(i)
                setTooltipPos({ x: e.clientX, y: e.clientY })
              }}
              onMouseLeave={() => {
                setHoverIndex(null)
                setTooltipPos(null)
              }}
            />
          )
        })}

      </svg>
      {hoverRow && tooltipPos &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: tooltipPos.x,
              top: tooltipPos.y - 10,
              transform: 'translate(-50%, -120%)',
              background: '#0f172a',
              color: '#f8fafc',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
              boxShadow: '0 6px 18px rgba(2,6,23,0.2)',
              border: '1px solid rgba(148,163,184,0.3)',
              pointerEvents: 'none',
              zIndex: 99999,
              whiteSpace: 'nowrap',
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {hoverRow.date ? fmtShortMY(hoverRow.date) : '—'}
            </div>
            <div>Scheduled Principal: {fmt$(hoverRow.principalThisMonth)}</div>
            <div>Accrued Interest: {fmt$(hoverRow.interestThisMonth)}</div>
          </div>,
          document.body
        )}

    </div>
  )
}

function AmortLoanTile({
  loan,
  compact = false,
  onOpen,
}: {
  loan: Loan2
  compact?: boolean
  onOpen: (loan: Loan2) => void
}) {
  const schedule = useMemo(() => getLoanSchedule(loan), [loan])

  const maturityDate = useMemo(() => {
    if (!schedule.length) return null
    const start = new Date(String((loan as any).loanStartDate ?? ''))
    if (Number.isNaN(+start)) return null
    start.setMonth(start.getMonth() + schedule.length - 1)
    return start
  }, [loan, schedule])

  const events = useMemo(() => sortEvents((loan as any).events ?? []), [loan])

  const rawPct = Number((loan as any).ownershipPct ?? (loan as any).userOwnershipPct ?? 0)

  const ownershipPct = Math.max(
    0,
    Math.min(1, rawPct > 1 ? rawPct / 100 : rawPct)
  )
  
  const ownershipColor = String((loan as any).loanColor ?? '#0ea5e9')

  return (
    <div
      onClick={() => onOpen(loan)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(loan)
        }
      }}
      tabIndex={0}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: compact ? '8px 10px' : '10px 12px',
        borderRadius: 12,
        background: 'var(--card)',
        minHeight: compact ? 64 : 110,
        cursor: 'pointer',
        overflow: 'visible',
        border: '1px solid var(--border)',
        transition: 'transform .18s ease, box-shadow .18s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-6px)'
        e.currentTarget.style.boxShadow = 'var(--shadow)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div style={{ flex: 1, paddingRight: 10, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>
          {(loan as any).loanName ?? (loan as any).name}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 4,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {events.map((event: any, idx: number) => (
            <EventBadge key={idx} event={event} />
          ))}
          <OwnershipPie
  userPct={ownershipPct}
  marketPct={0}
  color={ownershipColor}
  size={28}
/>
        </div>

        <div
          style={{
            display: compact ? 'none' : 'block',
            fontSize: 13,
            color: 'var(--text)',
            marginTop: 6,
            fontWeight: 700,
          }}
        >
          {(loan as any).school}
        </div>

        <div
          style={{
            display: compact ? 'none' : 'flex',
            gap: 8,
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>Rate: {Number((loan as any).nominalRate ?? 0).toFixed(2)}%</span>
          <span>·</span>
          <span>Term: {Number((loan as any).termYears ?? 0)}y</span>
          <span>·</span>
          <span>
            Matures: {maturityDate ? maturityDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
          </span>
        </div>

        <div
          style={{
            display: compact ? 'none' : 'block',
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 6,
          }}
        >
          Loan {(loan as any).loanId ?? (loan as any).id}
        </div>
      </div>

      <AmortMiniChart loan={loan} compact={compact} />
    </div>
  )
}

function ViewModeButton({
  active,
  lines,
  title,
  onClick,
}: {
  active: boolean
  lines: 1 | 2 | 3
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 34,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${active ? '#0ea5e9' : 'var(--border)'}`,
        background: active ? 'rgba(14,165,233,0.08)' : 'var(--card)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 4,
        padding: 6,
        cursor: 'pointer',
      }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          style={{
            height: 2,
            background: active ? '#0ea5e9' : 'var(--muted)',
            borderRadius: 2,
            display: 'block',
          }}
        />
      ))}
    </button>
  )
}

function AmortLoanDrawerBody({ loan }: { loan: Loan2 }) {
  const [tab, setTab] = useState<'schedule' | 'investment'>('schedule')
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setTab('schedule')
    setHoverIndex(null)
    setTooltipPos(null)
  }, [loan?.loanId, loan?.id])

  const schedule = useMemo(() => getLoanSchedule(loan), [loan])

const investmentSchedule = useMemo(() => {
  const rawPct = Number((loan as any).ownershipPct ?? (loan as any).userOwnershipPct ?? 1)
  const pct = Math.max(0, Math.min(1, rawPct > 1 ? rawPct / 100 : rawPct))

  return schedule.map((row: any) => ({
    ...row,
    payment: Number(row.payment ?? 0) * pct,
    scheduledPrincipal: Number(row.scheduledPrincipal ?? row.principalPaid ?? 0) * pct,
    prepaymentPrincipal: Number(row.prepaymentPrincipal ?? row.prepayment ?? 0) * pct,
    interest: Number(row.interest ?? 0) * pct,
    balance: Number(row.balance ?? 0) * pct,
  }))
}, [schedule, loan])

  const activeSchedule = tab === 'investment' ? investmentSchedule : schedule

  const principal = Number((loan as any).principal ?? (loan as any).origLoanAmt ?? (loan as any).loanAmount ?? 0)
  const purchasePrice = Number((loan as any).purchasePrice ?? (loan as any).investedCapital ?? principal)
  const rate = Number((loan as any).nominalRate ?? 0)

  const purchaseDate = useMemo(() => {
    const raw = (loan as any).purchaseDate
    if (!raw) return null
    const d = raw instanceof Date ? raw : new Date(raw)
    return Number.isNaN(+d) ? null : d
  }, [loan])

  const currentMonth = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }, [])

  const chartRows = useMemo(() => {
    let cumPrincipal = 0
    let cumInterest = 0

    return activeSchedule.map((row: any, index: number) => {
      const loanDate =
        row.loanDate instanceof Date ? row.loanDate : row.loanDate ? new Date(row.loanDate) : null

      const principalPaid =
        Number(row.scheduledPrincipal ?? row.principalPaid ?? 0) +
        Number(row.prepaymentPrincipal ?? row.prepayment ?? 0)

      const interestPaid = Number(row.interest ?? 0)

      cumPrincipal += principalPaid
      cumInterest += interestPaid

      return {
        index,
        date: loanDate,
        balance: Number(row.balance ?? 0),
        principalPaid,
        interestPaid,
        cumPrincipal,
        cumInterest,
        totalPaid: cumPrincipal + cumInterest,
        row,
      }
    })
  }, [activeSchedule])

  type ChartRow = (typeof chartRows)[number]

  const chartMax = useMemo(() => {
    const values = chartRows.flatMap((r: ChartRow) => [r.balance, r.cumPrincipal, r.cumInterest, r.totalPaid])
    return Math.max(...values, 1)
  }, [chartRows])

  const hoverRow =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < chartRows.length
      ? chartRows[hoverIndex]
      : null

  const purchaseMarkerIndex = useMemo(() => {
    if (!purchaseDate) return -1
    return chartRows.findIndex(
      (r: ChartRow) =>
        !!r.date &&
        r.date.getFullYear() === purchaseDate.getFullYear() &&
        r.date.getMonth() === purchaseDate.getMonth()
    )
  }, [chartRows, purchaseDate])

  const currentMarkerIndex = useMemo(() => {
    return chartRows.findIndex(
      (r: ChartRow) =>
        !!r.date &&
        r.date.getFullYear() === currentMonth.getFullYear() &&
        r.date.getMonth() === currentMonth.getMonth()
    )
  }, [chartRows, currentMonth])

  const totalPayments = activeSchedule.reduce((sum: number, row: any) => sum + Number(row.payment ?? 0), 0)
  const totalInterest = chartRows.length ? chartRows[chartRows.length - 1].cumInterest : 0
  const totalPrincipal = chartRows.length ? chartRows[chartRows.length - 1].cumPrincipal : 0

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r: number) => ({
    value: chartMax * r,
    label: fmt$(chartMax * r),
  }))

  const chartHeight = 250
  const chartWidth = 520
  const leftPad = 58
  const rightPad = 10
  const topPad = 12
  const bottomPad = 28
  const plotWidth = chartWidth - leftPad - rightPad
  const plotHeight = chartHeight - topPad - bottomPad

  function xAt(index: number) {
    if (chartRows.length <= 1) return leftPad
    return leftPad + (index / (chartRows.length - 1)) * plotWidth
  }

  function yAt(value: number) {
    return topPad + plotHeight - (Math.max(0, value) / chartMax) * plotHeight
  }

  function buildPath(values: number[]) {
    if (!values.length) return ''
    return values
      .map((v: number, i: number) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`)
      .join(' ')
  }

  const balancePath = buildPath(chartRows.map((r: ChartRow) => r.balance))
  const principalPath = buildPath(chartRows.map((r: ChartRow) => r.cumPrincipal))
  const interestPath = buildPath(chartRows.map((r: ChartRow) => r.cumInterest))
  const totalPath = buildPath(chartRows.map((r: ChartRow) => r.totalPaid))

  const purchaseX = purchaseMarkerIndex >= 0 ? xAt(purchaseMarkerIndex) : null
  const currentX = currentMarkerIndex >= 0 ? xAt(currentMarkerIndex) : null

  return (
    <>
      <div
        style={{
          background: 'linear-gradient(180deg,#fff,#fcfeff)',
          borderRadius: 8,
          border: '1px solid rgba(15,23,42,0.06)',
          boxShadow: '0 6px 18px rgba(15,23,42,0.06)',
          padding: 8,
        }}
      >
        <div style={{ position: 'relative' }}>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            style={{ width: '100%', height: 240, display: 'block' }}
            onMouseLeave={() => {
              setHoverIndex(null)
              setTooltipPos(null)
            }}
          >
            {yTicks.map((tick, i) => {
              const y = yAt(tick.value)
              return (
                <g key={i}>
                  <line
                    x1={leftPad}
                    x2={chartWidth - rightPad}
                    y1={y}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                  <text
                    x={leftPad - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="11"
                    fill="#64748b"
                  >
                    {tick.label}
                  </text>
                </g>
              )
            })}

            {purchaseX != null && (
              <line
                x1={purchaseX}
                x2={purchaseX}
                y1={topPad}
                y2={topPad + plotHeight}
                stroke="#22c55e"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
            )}

            {currentX != null && (
              <line
                x1={currentX}
                x2={currentX}
                y1={topPad}
                y2={topPad + plotHeight}
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
            )}

            {hoverRow && (
              <line
                x1={xAt(hoverRow.index)}
                x2={xAt(hoverRow.index)}
                y1={topPad}
                y2={topPad + plotHeight}
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.8"
              />
            )}

            <path d={balancePath} fill="none" stroke="#0f172a" strokeWidth="2.5" />
            <path d={principalPath} fill="none" stroke="#06b6d4" strokeWidth="2.25" />
            <path d={interestPath} fill="none" stroke="#a78bfa" strokeWidth="2.25" />
            <path d={totalPath} fill="none" stroke="#fb7185" strokeWidth="2.25" />

            {hoverRow && (
              <>
                <circle cx={xAt(hoverRow.index)} cy={yAt(hoverRow.balance)} r="4" fill="#0f172a" stroke="#fff" strokeWidth="1.5" />
                <circle cx={xAt(hoverRow.index)} cy={yAt(hoverRow.cumPrincipal)} r="4" fill="#06b6d4" stroke="#fff" strokeWidth="1.5" />
                <circle cx={xAt(hoverRow.index)} cy={yAt(hoverRow.cumInterest)} r="4" fill="#a78bfa" stroke="#fff" strokeWidth="1.5" />
                <circle cx={xAt(hoverRow.index)} cy={yAt(hoverRow.totalPaid)} r="4" fill="#fb7185" stroke="#fff" strokeWidth="1.5" />
              </>
            )}

            {chartRows.map((_: ChartRow, i: number) => {
              const xPrev = i === 0 ? leftPad : xAt(i - 1)
              const xCurr = xAt(i)
              const xNext = i === chartRows.length - 1 ? chartWidth - rightPad : xAt(i + 1)

              const left = i === 0 ? leftPad : (xPrev + xCurr) / 2
              const right = i === chartRows.length - 1 ? chartWidth - rightPad : (xCurr + xNext) / 2

              return (
                <rect
                  key={i}
                  x={left}
                  y={topPad}
                  width={Math.max(8, right - left)}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={(e) => {
                    setHoverIndex(i)
                    setTooltipPos({ x: e.clientX, y: e.clientY })
                  }}
                  onMouseMove={(e) => {
                    setHoverIndex(i)
                    setTooltipPos({ x: e.clientX, y: e.clientY })
                  }}
                  onMouseLeave={() => {
                    setHoverIndex(null)
                    setTooltipPos(null)
                  }}
                />
              )
            })}

            {chartRows.length > 0 &&
              [0, Math.floor(chartRows.length * 0.3), Math.floor(chartRows.length * 0.6), chartRows.length - 1]
                .filter((v, i, arr) => arr.indexOf(v) === i)
                .map((idx) => {
                  const row = chartRows[idx]
                  if (!row?.date) return null
                  return (
                    <text
                      key={idx}
                      x={xAt(idx)}
                      y={chartHeight - 6}
                      textAnchor="middle"
                      fontSize="11"
                      fill="#64748b"
                    >
                      {fmtShortMY(row.date)}
                    </text>
                  )
                })}
          </svg>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '4px 6px 2px',
            color: '#64748b',
            fontSize: 12,
          }}
        >
          <LegendDot color="#0f172a" label="Remaining Balance" />
          <LegendDot color="#06b6d4" label="Cum. Principal Paid" />
          <LegendDot color="#a78bfa" label="Cum. Interest Paid" />
          <LegendDot color="#fb7185" label="Total Paid" />
        </div>
      </div>

      {hoverRow && tooltipPos &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: tooltipPos.x,
              top: tooltipPos.y - 10,
              transform: 'translate(-50%, -120%)',
              background: '#0f172a',
              color: '#f8fafc',
              padding: '6px 10px',
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.6,
              boxShadow: '0 6px 18px rgba(2,6,23,0.2)',
              border: '1px solid rgba(148,163,184,0.3)',
              pointerEvents: 'none',
              zIndex: 99999,
              whiteSpace: 'nowrap',
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {hoverRow.date ? fmtShortMY(hoverRow.date) : '—'}
            </div>
            <div>Remaining Balance {fmt$(hoverRow.balance)}</div>
            <div>Principal Paid to Date {fmt$(hoverRow.cumPrincipal)}</div>
            <div>Interest Paid to Date {fmt$(hoverRow.cumInterest)}</div>
            <div>Total Paid {fmt$(hoverRow.totalPaid)}</div>
          </div>,
          document.body
        )}

      <div style={{ display: 'flex', gap: 10 }}>
        <div
          style={{
            flex: 1,
            background: '#f8fafc',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Invested Capital</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{fmt$(purchasePrice)}</div>
        </div>

        <div
          style={{
            width: 110,
            background: '#f8fafc',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Rate</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{fmtPct(rate)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
        <button
          onClick={() => setTab('schedule')}
          style={{
            padding: '7px 16px',
            borderRadius: 10,
            border: tab === 'schedule' ? '2px solid #0ea5e9' : '1px solid var(--border)',
            background: tab === 'schedule' ? '#f0f9ff' : 'transparent',
            color: tab === 'schedule' ? '#0ea5e9' : 'var(--muted)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Loan Schedule
        </button>
        <button
          onClick={() => setTab('investment')}
          style={{
            padding: '7px 16px',
            borderRadius: 10,
            border: tab === 'investment' ? '2px solid #0ea5e9' : '1px solid var(--border)',
            background: tab === 'investment' ? '#f0f9ff' : 'transparent',
            color: tab === 'investment' ? '#0ea5e9' : 'var(--muted)',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          My Investment
        </button>
      </div>

      <div>
        <div style={{ ...drawerSectionTitle, marginBottom: 4 }}>Amortization</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
          <span style={{ color: '#22c55e', fontWeight: 700 }}>―</span> Green line indicates the month the loan was purchased
        </div>

        <div style={drawerTableWrap}>
          <table style={drawerTableStyle}>
            <thead>
              <tr>
                <th style={drawerThStyle}>Month</th>
                <th style={drawerThR}>Payment</th>
                <th style={drawerThR}>Principal</th>
                <th style={drawerThR}>Interest</th>
                <th style={drawerThR}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {activeSchedule.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 16, color: 'var(--muted)' }}>
                    No amortization schedule available.
                  </td>
                </tr>
              ) : (
                activeSchedule.map((row: any, index: number) => {
                  const loanDate =
                    row.loanDate instanceof Date ? row.loanDate : row.loanDate ? new Date(row.loanDate) : null

                  const principalPaid =
                    Number(row.scheduledPrincipal ?? row.principalPaid ?? 0) +
                    Number(row.prepaymentPrincipal ?? row.prepayment ?? 0)

                  const isPurchaseMonth =
                    !!purchaseDate &&
                    !!loanDate &&
                    purchaseDate.getFullYear() === loanDate.getFullYear() &&
                    purchaseDate.getMonth() === loanDate.getMonth()

                  const isPrePurchaseMonth =
                    !!purchaseDate &&
                    !!loanDate &&
                    (
                      loanDate.getFullYear() < purchaseDate.getFullYear() ||
                      (
                        loanDate.getFullYear() === purchaseDate.getFullYear() &&
                        loanDate.getMonth() < purchaseDate.getMonth()
                      )
                    )

                  const rowType = String(row.eventType ?? row.status ?? row.phase ?? '').toLowerCase()

                  const isGraceMonth =
                    row.isGrace === true ||
                    row.inGrace === true ||
                    rowType.includes('grace')

                  const isDeferralMonth =
                    row.isOwned === true &&
                    !isGraceMonth &&
                    (
                      rowType.includes('defer') ||
                      row.deferral === true ||
                      row.deferralMonth === true
                    )

                  const bg =
                    row.eventType === 'prepayment'
                      ? 'rgba(22,163,74,0.12)'
                      : isDeferralMonth
                        ? 'rgba(234,179,8,0.13)'
                        : row.isTerminal === true
                          ? 'rgba(220,38,38,0.10)'
                          : index % 2 === 1
                            ? 'rgba(15,23,42,0.015)'
                            : 'transparent'

                  const purchaseBorder = isPurchaseMonth ? '2px solid #22c55e' : undefined
                  const textColor = isPrePurchaseMonth ? '#94a3b8' : undefined

                  return (
                    <tr key={index} style={{ background: bg }}>
                      <td style={{ ...drawerTdL, borderTop: purchaseBorder, color: textColor }}>
                        {loanDate ? fmtShortMY(loanDate) : '—'}
                      </td>

                      <td style={{ ...drawerTdR, borderTop: purchaseBorder, color: textColor }}>
                        {fmt$(row.payment)}
                      </td>

                      <td style={{ ...drawerTdR, borderTop: purchaseBorder, color: textColor }}>
                        {fmt$(principalPaid)}
                      </td>

                      <td style={{ ...drawerTdR, borderTop: purchaseBorder, color: textColor }}>
                        {fmt$(row.interest)}
                      </td>

                      <td
                        style={{
                          ...drawerTdR,
                          borderTop: purchaseBorder,
                          color: textColor,
                          fontWeight: 700,
                        }}
                      >
                        {fmt$(row.balance)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
        <StatCard label="Total Scheduled Payments" value={fmt$(totalPayments)} />
        <StatCard label="Total Interest" value={fmt$(totalInterest)} />
        <StatCard label="Total Principal Paid" value={fmt$(totalPrincipal)} />
        <StatCard label="Schedule Rows" value={String(activeSchedule.length)} />
      </div>
    </>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: color,
          display: 'inline-block',
        }}
      />
      <span>{label}</span>
    </span>
  )
}

type AmortTooltipState = { x: number; y: number; lines: string[]; idx?: number }

const fmtKpiMY = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

const amortTodayKey = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

function buildAmortLoanTPVSeries(loan: Loan2): Record<string, number> {
  const schedule = getLoanSchedule(loan)
  const result: Record<string, number> = {}
  let cumP = 0
  let cumI = 0
  const ownershipPct = Number((loan as any).ownershipPct ?? (loan as any).userOwnershipPct ?? 1)

  schedule.forEach((row: any) => {
    if (!row.isOwned) return
    cumP += Number(row.scheduledPrincipal ?? 0) + Number(row.prepaymentPrincipal ?? 0)
    cumI += Number(row.interest ?? 0)

    const loanDate =
      row.loanDate instanceof Date ? row.loanDate : row.loanDate ? new Date(row.loanDate) : null
    if (!loanDate || Number.isNaN(+loanDate)) return

    const key = `${loanDate.getFullYear()}-${String(loanDate.getMonth() + 1).padStart(2, '0')}`
    result[key] = (cumP + cumI) * ownershipPct + Number(row.balance ?? 0) * ownershipPct * 0.95
  })

  return result
}

function getLoanTpvForExactMonth(loan: Loan2, monthKey: string): number {
  const series = buildAmortLoanTPVSeries(loan)
  return Number(series[monthKey] || 0)
}

function getLoanTpvAtOrBeforeMonth(loan: Loan2, monthKey: string): number {
  const series = buildAmortLoanTPVSeries(loan)
  const keys = Object.keys(series).sort()
  if (keys.length === 0) return 0

  const lastKey = keys[keys.length - 1]

  // after the loan's final month, TPV should be 0
  if (monthKey > lastKey) return 0

  // exact month
  if (series[monthKey] != null) return Number(series[monthKey] || 0)

  // fallback only while still within the loan's timeline
  const fallbackKey = keys.filter((k) => k <= monthKey).pop()
  return fallbackKey ? Number(series[fallbackKey] || 0) : 0
}

function getLoanProjectedTpv(loan: Loan2): number {
  const series = buildAmortLoanTPVSeries(loan)
  const keys = Object.keys(series).sort()
  if (keys.length === 0) return 0
  return Number(series[keys[keys.length - 1]] || 0)
}



function buildAmortPaymentSeries(loan: Loan2): Record<string, number> {
  const schedule = getLoanSchedule(loan)
  const result: Record<string, number> = {}
  const ownershipPct = Number((loan as any).ownershipPct ?? (loan as any).userOwnershipPct ?? 1)

  schedule.forEach((row: any) => {
    if (!row.isOwned) return

    const loanDate =
      row.loanDate instanceof Date ? row.loanDate : row.loanDate ? new Date(row.loanDate) : null
    if (!loanDate || Number.isNaN(+loanDate)) return

    const key = `${loanDate.getFullYear()}-${String(loanDate.getMonth() + 1).padStart(2, '0')}`
    result[key] = (result[key] || 0) + Number(row.payment ?? 0) * ownershipPct
  })

  return result
}

function AmortMetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        borderRadius: 8,
        padding: '12px 16px',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  )
}

const amortKpiTh: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--muted)',
  borderBottom: '1px solid var(--border)',
  position: 'sticky',
  top: 0,
  background: 'var(--surface)',
  whiteSpace: 'nowrap',
}

const amortKpiTd: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px dashed rgba(15,23,42,0.04)',
  whiteSpace: 'nowrap',
}

function AmortTpvDrawer({
  loans,
  onTooltip,
}: {
  loans: Loan2[]
  onTooltip: (t: AmortTooltipState | null) => void
}) {
  const [hiddenLoans, setHiddenLoans] = useState<Set<string>>(new Set())
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const stackData = useMemo(() => {
    const data: Record<string, Record<string, number>> = {}
    loans.forEach((loan) => {
      Object.entries(buildAmortLoanTPVSeries(loan)).forEach(([key, val]) => {
        data[key] ??= {}
        data[key][String((loan as any).loanId ?? (loan as any).id ?? '')] = val
      })
    })
    return data
  }, [loans])

  const months = useMemo(() => Object.keys(stackData).sort(), [stackData])

  const currentTPV = useMemo(() => {
  return loans.reduce((sum, loan) => {
    const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
    if (hiddenLoans.has(loanId)) return sum
    return sum + getLoanTpvAtOrBeforeMonth(loan, amortTodayKey)
  }, 0)
}, [loans, hiddenLoans])

const maxTPV = useMemo(
  () =>
    Math.max(
      ...months.map((monthKey) =>
        loans.reduce((sum, loan) => {
          const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
          if (hiddenLoans.has(loanId)) return sum
          return sum + getLoanTpvForExactMonth(loan, monthKey)
        }, 0)
      ),
      1
    ),
  [months, loans, hiddenLoans]
)

  const totalInvested = loans.reduce(
    (s, l) => s + Number((l as any).purchasePrice ?? (l as any).investedCapital ?? 0),
    0
  )

  const W = 480
  const H = 240
  const ML = 60
  const MR = 16
  const MT = 12
  const MB = 28
  const innerH = H - MT - MB
  const barW = months.length > 0 ? (W - ML - MR) / months.length : 1

  const yTicks = [0, 1, 2, 3, 4].map((i) => ({
    val: (i / 4) * maxTPV,
    y: MT + innerH - (i / 4) * innerH,
  }))

  function toggleLoan(id: string) {
    setHiddenLoans((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div>
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid rgba(15,23,42,0.08)',
          padding: 12,
          boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={ML} x2={W - MR} y1={t.y} y2={t.y} stroke="rgba(15,23,42,0.06)" strokeWidth={1} />
              <text x={ML - 8} y={t.y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                ${Math.round(t.val).toLocaleString()}
              </text>
            </g>
          ))}

          {months.map((monthKey, i) => {
            const x = ML + i * barW
            let yCursor = MT + innerH
            const total = loans.reduce((sum, loan) => {
  const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
  if (hiddenLoans.has(loanId)) return sum
  return sum + getLoanTpvForExactMonth(loan, monthKey)
}, 0)

            return (
              <g key={monthKey}>
                {loans.map((loan) => {
                  const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
                  if (hiddenLoans.has(loanId)) return null

                  const val = getLoanTpvForExactMonth(loan, monthKey)
                  const bh = (val / maxTPV) * innerH
                  if (bh <= 0) return null

                  yCursor -= bh

                  return (
                    <rect
                      key={loanId}
                      x={x}
                      y={yCursor}
                      width={Math.max(barW - 1, 1)}
                      height={bh}
                      fill={(loan as any).loanColor ?? '#0ea5e9'}
                      opacity={hoveredId && hoveredId !== loanId ? 0.15 : 1}
                      style={{ transition: 'opacity 0.15s' }}
                    />
                  )
                })}

                <rect
                  x={x}
                  y={MT}
                  width={barW}
                  height={innerH}
                  fill="transparent"
                  onMouseMove={(e) =>
                    onTooltip({
                      x: e.clientX,
                      y: e.clientY - 90,
                      lines: [fmtKpiMY(monthKey), `TPV ${fmt$(total)}`],
                    })
                  }
                  onMouseLeave={() => onTooltip(null)}
                />
              </g>
            )
          })}

          {months.map((m, i) => {
            const skip = months.length > 24 ? 24 : months.length > 12 ? 6 : 2
            if (i % skip !== 0) return null
            return (
              <text key={m} x={ML + i * barW + barW / 2} y={H - MB + 14} fontSize={10} textAnchor="middle" fill="#475569">
                {fmtKpiMY(m)}
              </text>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, margin: '12px 0' }}>
        <AmortMetricBox label="Current Month TPV" value={fmt$(currentTPV)} />
        <AmortMetricBox label="Total Invested" value={fmt$(totalInvested)} />
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'auto',
          maxHeight: '40vh',
          background: 'var(--card)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['Loan On/Off', 'Loan', 'Current TPV', 'Projected TPV'].map((h) => (
                <th key={h} style={amortKpiTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => {
              const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
              const curVal = getLoanTpvAtOrBeforeMonth(loan, amortTodayKey)
const projVal = getLoanProjectedTpv(loan)
              const hidden = hiddenLoans.has(loanId)

              return (
                <tr
                  key={loanId}
                  onMouseEnter={() => setHoveredId(loanId)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ background: hoveredId === loanId ? 'rgba(148,163,184,0.12)' : undefined }}
                >
                  <td style={amortKpiTd}>
                    <span
                      onClick={() => toggleLoan(loanId)}
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: (loan as any).loanColor ?? '#0ea5e9',
                        display: 'inline-block',
                        cursor: 'pointer',
                        opacity: hidden ? 0.25 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    />
                  </td>
                  <td style={amortKpiTd}>
                    <div style={{ fontWeight: 600 }}>{(loan as any).loanName ?? (loan as any).name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(loan as any).school}</div>
                  </td>
                  <td style={amortKpiTd}>{fmt$(curVal)}</td>
                  <td style={amortKpiTd}>{fmt$(projVal)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AmortRatesDrawer({
  loans,
  onTooltip,
}: {
  loans: Loan2[]
  onTooltip: (t: AmortTooltipState | null) => void
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const rates = loans.map((l) => Number((l as any).nominalRate ?? 0))
  const minRate = Math.min(...rates)
  const maxRate = Math.max(...rates)
  const avgRate = rates.reduce((s, r) => s + r, 0) / Math.max(rates.length, 1)
  const BINS = 5
  const binWidth = (maxRate - minRate) / BINS || 1

  const binLoans: Loan2[][] = Array.from({ length: BINS }, () => [])
  loans.forEach((l) => {
    const rate = Number((l as any).nominalRate ?? 0)
    let idx = Math.floor((rate - minRate) / binWidth)
    idx = Math.max(0, Math.min(BINS - 1, idx))
    binLoans[idx].push(l)
  })

  const maxCount = Math.max(...binLoans.map((b) => b.length), 1)

  const W = 480
  const H = 220
  const PAD = 36
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2
  const bw = (innerW / BINS) * 0.7
  const gap = (innerW / BINS - bw) / 2

  return (
    <div>
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid rgba(15,23,42,0.08)',
          padding: 12,
          boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
          <line x1={PAD} x2={PAD} y1={PAD} y2={H - PAD} stroke="#cbd5e1" />
          <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="#cbd5e1" />

          {binLoans.map((loansInBin, i) => {
            if (!loansInBin.length) return null

            const x = PAD + i * (innerW / BINS) + gap
            let yCursor = H - PAD
            const unitH = innerH / maxCount

            return (
              <g key={i}>
                {loansInBin.map((loan) => {
                  yCursor -= unitH
                  const y = yCursor
                  const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')

                  return (
                    <rect
                      key={loanId}
                      x={x}
                      y={y}
                      width={bw}
                      height={unitH}
                      fill={(loan as any).loanColor ?? '#0ea5e9'}
                      opacity={hoveredId && hoveredId !== loanId ? 0.15 : 1}
                      style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredId(loanId)}
                      onMouseMove={(e) =>
                        onTooltip({
                          x: e.clientX,
                          y: e.clientY - 70,
                          lines: [
                            String((loan as any).loanName ?? (loan as any).name ?? ''),
                            `${Number((loan as any).nominalRate ?? 0).toFixed(2)}%`,
                          ],
                        })
                      }
                      onMouseLeave={() => {
                        setHoveredId(null)
                        onTooltip(null)
                      }}
                    />
                  )
                })}

                <text x={x + bw / 2} y={H - PAD + 14} fontSize={10} textAnchor="middle" fill="#475569">
                  {(minRate + i * binWidth).toFixed(2)}–{(minRate + (i + 1) * binWidth).toFixed(2)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, margin: '12px 0' }}>
        <AmortMetricBox label="Avg Rate" value={`${avgRate.toFixed(2)}%`} />
        <AmortMetricBox label="Rate Range" value={`${minRate.toFixed(2)}% – ${maxRate.toFixed(2)}%`} />
      </div>

      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--muted)' }}>Loans sorted by rate</p>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'auto',
          maxHeight: '40vh',
          background: 'var(--card)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['', 'Loan', 'Rate', 'Purchase', 'Balance'].map((h) => (
                <th key={h} style={amortKpiTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...loans]
              .sort((a, b) => Number((b as any).nominalRate ?? 0) - Number((a as any).nominalRate ?? 0))
              .map((loan) => {
                const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
                return (
                  <tr
                    key={loanId}
                    onMouseEnter={() => setHoveredId(loanId)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{ background: hoveredId === loanId ? 'rgba(148,163,184,0.12)' : undefined }}
                  >
                    <td style={amortKpiTd}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: (loan as any).loanColor ?? '#0ea5e9',
                          display: 'inline-block',
                        }}
                      />
                    </td>
                    <td style={amortKpiTd}>
                      <div style={{ fontWeight: 600 }}>{(loan as any).loanName ?? (loan as any).name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(loan as any).school}</div>
                    </td>
                    <td style={{ ...amortKpiTd, color: (loan as any).loanColor ?? '#0ea5e9', fontWeight: 600 }}>
                      {Number((loan as any).nominalRate ?? 0).toFixed(2)}%
                    </td>
                    <td style={amortKpiTd}>{String((loan as any).purchaseDate ?? '')}</td>
                    <td style={{ ...amortKpiTd, textAlign: 'right' }}>
                      {fmt$(Number((loan as any).balance ?? 0))}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AmortPaymentsDrawer({
  loans,
  onTooltip,
}: {
  loans: Loan2[]
  onTooltip: (t: AmortTooltipState | null) => void
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const { months, paymentsByMonth } = useMemo(() => {
    const combined: Record<string, number> = {}

    loans.forEach((loan) => {
      Object.entries(buildAmortPaymentSeries(loan)).forEach(([key, val]) => {
        combined[key] = (combined[key] || 0) + Number(val)
      })
    })

    const months = Object.keys(combined).sort()
    return {
      months,
      paymentsByMonth: months.map((m) => combined[m] || 0),
    }
  }, [loans])

  const todayIdx = months.indexOf(amortTodayKey)
  const currentIncome = paymentsByMonth[todayIdx >= 0 ? todayIdx : 0] ?? 0
  const totalInvested = loans.reduce(
    (s, l) => s + Number((l as any).purchasePrice ?? (l as any).investedCapital ?? 0),
    0
  )

  const W = 480
  const H = 220
  const PAD = 40
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2
  const maxV = Math.max(...paymentsByMonth, 1)
  const stepX = paymentsByMonth.length > 1 ? innerW / (paymentsByMonth.length - 1) : innerW
  const todayX = todayIdx >= 0 ? PAD + todayIdx * stepX : -1

  const points = paymentsByMonth
    .map((v, i) => `${(PAD + i * stepX).toFixed(1)},${(PAD + innerH * (1 - v / maxV)).toFixed(1)}`)
    .join(' ')

  const yTicks = [0, 1, 2, 3, 4].map((i) => ({
    val: (i / 4) * maxV,
    y: PAD + innerH * (1 - i / 4),
  }))

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mouseX = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.max(0, Math.min(months.length - 1, Math.round((mouseX - PAD) / stepX)))
    setHoverIdx(idx)
    onTooltip({
      x: e.clientX,
      y: e.clientY - 90,
      idx,
      lines: [fmtKpiMY(months[idx]), `Monthly Income ${fmt$(paymentsByMonth[idx])}`],
    })
  }

  function handleMouseLeave() {
    setHoverIdx(null)
    onTooltip(null)
  }

  return (
    <div>
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid rgba(15,23,42,0.08)',
          padding: 12,
          boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block', cursor: 'crosshair' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD} x2={W - PAD} y1={t.y} y2={t.y} stroke="rgba(15,23,42,0.06)" strokeWidth={1} />
              <text x={PAD - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#64748b">
                ${Math.round(t.val).toLocaleString()}
              </text>
            </g>
          ))}

          <polyline points={points} fill="none" stroke="#fb7185" strokeWidth={2} />

          {todayX > 0 && (
            <line
              x1={todayX}
              x2={todayX}
              y1={PAD}
              y2={H - PAD}
              stroke="#111827"
              strokeDasharray="3 4"
              strokeOpacity={0.6}
            />
          )}

          {months.map((m, i) => {
            if (i % 24 !== 0) return null
            return (
              <text key={m} x={PAD + i * stepX} y={H - PAD + 14} fontSize={10} textAnchor="middle" fill="#475569">
                {fmtKpiMY(m)}
              </text>
            )
          })}

          {hoverIdx !== null &&
            (() => {
              const cx = PAD + hoverIdx * stepX
              const cy = PAD + innerH * (1 - paymentsByMonth[hoverIdx] / maxV)
              return (
                <>
                  <line x1={cx} x2={cx} y1={PAD} y2={H - PAD} stroke="#111827" strokeDasharray="3 4" strokeOpacity={0.5} />
                  <circle cx={cx} cy={cy} r={4} fill="#fb7185" stroke="#fff" strokeWidth={1.5} />
                </>
              )
            })()}
        </svg>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, margin: '12px 0' }}>
        <AmortMetricBox label="Current Monthly Income" value={fmt$(currentIncome)} />
        <AmortMetricBox label="Total Invested" value={fmt$(totalInvested)} />
      </div>

      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--muted)' }}>Monthly expected payments</p>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'auto',
          maxHeight: '38vh',
          background: 'var(--card)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={amortKpiTh}>Month</th>
              <th style={{ ...amortKpiTh, textAlign: 'right' }}>Payments</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m, i) => (
              <tr key={m} style={{ background: i % 2 === 1 ? 'rgba(15,23,42,0.02)' : undefined }}>
                <td style={amortKpiTd}>{fmtKpiMY(m)}</td>
                <td style={{ ...amortKpiTd, textAlign: 'right' }}>{fmt$(paymentsByMonth[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AmortDistributionDrawer({
  loans,
  onTooltip,
}: {
  loans: Loan2[]
  onTooltip: (t: AmortTooltipState | null) => void
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const { months, loansByMonth } = useMemo(() => {
    const map: Record<string, Loan2[]> = {}

    loans.forEach((l) => {
      const rawPurchase = String((l as any).purchaseDate ?? '')
      const key = rawPurchase.length >= 7 ? rawPurchase.slice(0, 7) : ''
      if (!key) return
      map[key] ??= []
      map[key].push(l)
    })

    const months = Object.keys(map).sort()
    return { months, loansByMonth: map }
  }, [loans])

  const totalInvested = loans.reduce(
    (s, l) => s + Number((l as any).purchasePrice ?? (l as any).investedCapital ?? 0),
    0
  )

  const maxVal = Math.max(
    ...months.map((m) =>
      loansByMonth[m].reduce(
        (s, l) => s + Number((l as any).purchasePrice ?? (l as any).investedCapital ?? 0),
        0
      )
    ),
    1
  )

  const W = 480
  const H = 240
  const PAD = 56
  const innerW = W - PAD * 2
  const innerH = H - PAD * 2
  const bw = months.length > 0 ? (innerW / months.length) * 0.7 : 1
  const gap = months.length > 0 ? (innerW / months.length - bw) / 2 : 0
  const scale = innerH / maxVal

  const yTicks = [0, 1, 2, 3, 4].map((i) => ({
    val: (i / 4) * maxVal,
    y: PAD + innerH - (i / 4) * innerH,
  }))

  return (
    <div>
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          border: '1px solid rgba(15,23,42,0.08)',
          padding: 12,
          boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
          <line x1={PAD} x2={PAD} y1={PAD} y2={H - PAD} stroke="#cbd5e1" />
          <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="#cbd5e1" />

          {yTicks.map((t, i) => (
            <text key={i} x={PAD - 10} y={t.y + 4} fontSize={10} textAnchor="end" fill="#64748b">
              ${Math.round(t.val).toLocaleString()}
            </text>
          ))}

          {months.map((m, i) => {
            const loansInMonth = loansByMonth[m]
            const x = PAD + i * (innerW / months.length) + gap
            let yCursor = H - PAD

            return (
              <g key={m}>
                {loansInMonth.map((loan) => {
                  const purchasePrice = Number((loan as any).purchasePrice ?? (loan as any).investedCapital ?? 0)
                  const segH = purchasePrice * scale
                  yCursor -= segH
                  const y = yCursor
                  const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')

                  return (
                    <rect
                      key={loanId}
                      x={x}
                      y={y}
                      width={bw}
                      height={segH}
                      fill={(loan as any).loanColor ?? '#0ea5e9'}
                      opacity={hoveredId && hoveredId !== loanId ? 0.15 : 1}
                      style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredId(loanId)}
                      onMouseMove={(e) =>
                        onTooltip({
                          x: e.clientX,
                          y: e.clientY - 90,
                          lines: [
                            String((loan as any).loanName ?? (loan as any).name ?? ''),
                            `Purchased ${String((loan as any).purchaseDate ?? '')}`,
                            `Rate ${Number((loan as any).nominalRate ?? 0).toFixed(2)}%`,
                          ],
                        })
                      }
                      onMouseLeave={() => {
                        setHoveredId(null)
                        onTooltip(null)
                      }}
                    />
                  )
                })}

                {i % 2 === 0 && (
                  <text x={x + bw / 2} y={H - PAD + 14} fontSize={10} textAnchor="middle" fill="#475569">
                    {fmtKpiMY(m)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, margin: '12px 0' }}>
        <AmortMetricBox label="Total Invested" value={fmt$(totalInvested)} />
        <AmortMetricBox label="Loan Count" value={String(loans.length)} />
      </div>

      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--muted)' }}>Loans — Invested Capital</p>
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'auto',
          maxHeight: '38vh',
          background: 'var(--card)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              {['', 'Loan', 'Rate', 'Purchase Price'].map((h) => (
                <th key={h} style={amortKpiTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loans.map((loan) => {
              const loanId = String((loan as any).loanId ?? (loan as any).id ?? '')
              return (
                <tr
                  key={loanId}
                  onMouseEnter={() => setHoveredId(loanId)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{ background: hoveredId === loanId ? 'rgba(148,163,184,0.12)' : undefined }}
                >
                  <td style={amortKpiTd}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: (loan as any).loanColor ?? '#0ea5e9',
                        display: 'inline-block',
                      }}
                    />
                  </td>
                  <td style={amortKpiTd}>
                    <div style={{ fontWeight: 600 }}>{(loan as any).loanName ?? (loan as any).name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(loan as any).school}</div>
                  </td>
                  <td style={{ ...amortKpiTd, color: (loan as any).loanColor ?? '#0ea5e9', fontWeight: 600 }}>
                    {Number((loan as any).nominalRate ?? 0).toFixed(2)}%
                  </td>
                  <td style={amortKpiTd}>
                    {fmt$(Number((loan as any).purchasePrice ?? (loan as any).investedCapital ?? 0))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AmortKpiDrawerContent({
  kpi,
  loansWithAmort,
}: {
  kpi: KpiType
  loansWithAmort: Loan2[]
}) {
  const [tooltip, setTooltip] = useState<AmortTooltipState | null>(null)
  const handleTooltip = useCallback((t: AmortTooltipState | null) => setTooltip(t), [])

  return (
    <>
      {kpi === 'tpv' && <AmortTpvDrawer loans={loansWithAmort} onTooltip={handleTooltip} />}
      {kpi === 'rates' && <AmortRatesDrawer loans={loansWithAmort} onTooltip={handleTooltip} />}
      {kpi === 'payments' && <AmortPaymentsDrawer loans={loansWithAmort} onTooltip={handleTooltip} />}
      {kpi === 'distribution' && <AmortDistributionDrawer loans={loansWithAmort} onTooltip={handleTooltip} />}

      {tooltip &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: tooltip.x + 10,
              top: tooltip.y,
              background: '#0f172a',
              color: '#f8fafc',
              padding: '7px 12px',
              borderRadius: 8,
              fontSize: 12,
              lineHeight: 1.7,
              pointerEvents: 'none',
              zIndex: 9999,
              whiteSpace: 'nowrap',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            {tooltip.lines.map((l, i) => (
              <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                {l}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

export default function AmortDetailPage() {
  const { userId, isMarket } = useUser()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const initialKpi = (searchParams.get('kpi') as KpiType) || null
  const initialLoanId = searchParams.get('loan') || null

  const { loans, loading, error } = useLoans(userId)

  const today = new Date()

  const [selectedLoan, setSelectedLoan] = useState<Loan2 | null>(null)
  const [loanDrawerOpen, setLoanDrawerOpen] = useState(false)
  const [activeKpi, setActiveKpi] = useState<KpiType | null>(initialKpi)

  const [filterName, setFilterName] = useState('')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterRate, setFilterRate] = useState('')
  const [sortKey, setSortKey] = useState('')
  const [viewMode, setViewMode] = useState<'full' | 'compact' | 'table'>(() => {
    const saved = localStorage.getItem('amortView')
    return saved === 'compact' || saved === 'table' ? saved : 'full'
  })

  useEffect(() => {
    localStorage.setItem('amortView', viewMode)
  }, [viewMode])

  // totalPortfolioValue computed after loansWithAmort below

  const totalInvested = useMemo(
    () => loans.reduce((sum, loan) => sum + loan.purchasePrice, 0),
    [loans]
  )

  const avgRate = useMemo(
    () => (loans.length ? loans.reduce((sum, loan) => sum + loan.nominalRate, 0) / loans.length : 0),
    [loans]
  )

  const monthlyIncome = useMemo(
    () => loans.reduce((sum, loan) => sum + (loan.balance * loan.ownershipPct * loan.nominalRate / 100 / 12), 0),
    [loans]
  )

  const loanNames = useMemo(() => [...new Set(loans.map(loan => loan.loanName))].sort(), [loans])
  const schools = useMemo(() => [...new Set(loans.map(loan => loan.school))].sort(), [loans])

  const filtered = useMemo(() => {
    const rows = [...loans]

    if (filterName) {
      return rows
        .filter(loan => loan.loanName === filterName)
        .filter(loan => !filterSchool || loan.school === filterSchool)
        .filter(loan => {
          if (!filterRate) return true
          if (filterRate === 'low') return loan.nominalRate < 5
          if (filterRate === 'mid') return loan.nominalRate >= 5 && loan.nominalRate <= 8
          if (filterRate === 'high') return loan.nominalRate > 8
          return true
        })
        .sort((a, b) => sortLoans(a, b, sortKey))
    }

    return rows
      .filter(loan => !filterSchool || loan.school === filterSchool)
      .filter(loan => {
        if (!filterRate) return true
        if (filterRate === 'low') return loan.nominalRate < 5
        if (filterRate === 'mid') return loan.nominalRate >= 5 && loan.nominalRate <= 8
        if (filterRate === 'high') return loan.nominalRate > 8
        return true
      })
      .sort((a, b) => sortLoans(a, b, sortKey))
  }, [loans, filterName, filterSchool, filterRate, sortKey])

  const loansWithAmort = useMemo(
    () => filtered.map(loan => ({
      ...loan,
      // Reuse schedule from loanEngine (built in useLoans) if available,
      // fall back to amortEngine only if missing — ensures KPI and drawer use same data
      amort: {
        schedule: Array.isArray(loan?.amort?.schedule) && loan.amort.schedule.length > 0
          ? loan.amort.schedule
          : buildAmortSchedule(loan)
      }
    })),
    [filtered]
  )

  // TPV = (cumPrincipal + cumInterest) * ownershipPct + balance * ownershipPct * 0.95
  // Matches the drawer chart formula exactly — uses loansWithAmort so schedules are built
const totalPortfolioValueCalc = useMemo(() => {
  return loansWithAmort.reduce((sum, loan) => {
    return sum + getLoanTpvAtOrBeforeMonth(loan as Loan2, amortTodayKey)
  }, 0)
}, [loansWithAmort])

  useEffect(() => {
    if (initialLoanId) {
      const loan = loansWithAmort.find(
        (l) => String((l as any).loanId ?? (l as any).id) === String(initialLoanId)
      )

      if (loan) {
        setSelectedLoan(loan as Loan2)
        setLoanDrawerOpen(true)
        setActiveKpi(null)
      }
      return
    }

    if (initialKpi) {
      setActiveKpi(initialKpi)
      setLoanDrawerOpen(false)
      return
    }

    setLoanDrawerOpen(false)
    setActiveKpi(null)
  }, [initialLoanId, initialKpi, loansWithAmort])

  function openLoanDrawer(loan: Loan2) {
    setActiveKpi(null)
    setSelectedLoan(loan)
    setLoanDrawerOpen(true)
    setSearchParams({ loan: String((loan as any).loanId ?? (loan as any).id ?? '') })
  }

  function openKpi(kpi: KpiType) {
    setLoanDrawerOpen(false)
    setActiveKpi(kpi)
    setSearchParams({ kpi })
  }

  function resetFilters() {
    setFilterName('')
    setFilterSchool('')
    setFilterRate('')
    setSortKey('')
  }

  function closeDrawers() {
    setLoanDrawerOpen(false)
    setActiveKpi(null)
    setSearchParams({})
  }

  function downloadCsv() {
    const rows = loansWithAmort.map((loan: any) => [
      loan.loanId ?? loan.id ?? '',
      loan.loanName ?? loan.name ?? '',
      loan.school ?? '',
      loan.loanStartDate ?? '',
      loan.purchaseDate ?? '',
      Number(loan.principal ?? 0),
      Number(loan.purchasePrice ?? 0),
      Number(loan.nominalRate ?? 0).toFixed(2),
      Number(loan.termYears ?? 0),
      Number(loan.graceYears ?? 0),
      Number(loan.balance ?? 0),
    ])

    const csv = [
      ['ID', 'Loan', 'School', 'Loan Start', 'Purchase Date', 'Orig Amt', 'Purchase $', 'Rate', 'Term', 'Grace', 'Balance'],
      ...rows,
    ]
      .map(r => r.map(v => `"${String(v)}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'amort-loans.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyCsv() {
    const rows = loansWithAmort.map((loan: any) => [
      loan.loanId ?? loan.id ?? '',
      loan.loanName ?? loan.name ?? '',
      loan.school ?? '',
      loan.loanStartDate ?? '',
      loan.purchaseDate ?? '',
      Number(loan.principal ?? 0),
      Number(loan.purchasePrice ?? 0),
      Number(loan.nominalRate ?? 0).toFixed(2),
      Number(loan.termYears ?? 0),
      Number(loan.graceYears ?? 0),
      Number(loan.balance ?? 0),
    ])

    const csv = [
      ['ID', 'Loan', 'School', 'Loan Start', 'Purchase Date', 'Orig Amt', 'Purchase $', 'Rate', 'Term', 'Grace', 'Balance'],
      ...rows,
    ]
      .map(r => r.map(v => `"${String(v)}"`).join(','))
      .join('\n')

    await navigator.clipboard.writeText(csv)
  }

  const kpiTiles = isMarket
    ? [
        { label: 'Total Available Value', value: fmt$(totalPortfolioValueCalc), kpi: 'tpv' as KpiType },
        { label: 'Avg Rate', value: avgRate.toFixed(2) + '%', kpi: 'rates' as KpiType },
        { label: 'Est. Monthly Income', value: fmt$(monthlyIncome), kpi: 'payments' as KpiType },
        { label: 'Loans Available', value: String(loans.length), kpi: 'distribution' as KpiType },
      ]
    : [
        { label: 'Total Portfolio Value', value: fmt$(totalPortfolioValueCalc), kpi: 'tpv' as KpiType },
        { label: 'Avg Rate', value: avgRate.toFixed(2) + '%', kpi: 'rates' as KpiType },
        { label: 'Monthly Income', value: fmt$(monthlyIncome), kpi: 'payments' as KpiType },
        { label: 'Total Invested', value: fmt$(totalInvested), kpi: 'distribution' as KpiType },
      ]

  const drawerTitle = (() => {
    if (activeKpi) {
      return {
        tpv: 'Total Portfolio Value',
        rates: 'Average Rate',
        payments: 'Monthly Income',
        distribution: isMarket ? 'Loans Available' : 'Total Invested',
      }[activeKpi]
    }

    if (selectedLoan) {
      return (selectedLoan as any).loanName ?? (selectedLoan as any).name ?? 'Loan'
    }

    return ''
  })()

  const drawerSubTitle = (() => {
    if (activeKpi) {
      return {
        tpv: 'TPV = sum of current month loan values; (cumulative principal + interest − fees) + Mark-to-Market (95%) of remaining balance',
        rates: 'Nominal rates across the filtered loan set.',
        payments: 'Estimated monthly interest income based on owned balances and nominal rates.',
        distribution: isMarket
          ? 'Loan count and composition across the filtered marketplace set.'
          : 'Invested capital across the filtered portfolio.',
      }[activeKpi]
    }

    if (!selectedLoan) return undefined

    const school = (selectedLoan as any).school ?? '—'
    const purchaseDate = (selectedLoan as any).purchaseDate ?? '—'
    const loanStartDate = (selectedLoan as any).loanStartDate ?? '—'
    const origAmt = Number(
      (selectedLoan as any).principal ??
      (selectedLoan as any).origLoanAmt ??
      (selectedLoan as any).loanAmount ??
      0
    )

    return `${school}\nPurchased ${purchaseDate} · Loan Start ${loanStartDate} · Orig Loan Amt ${fmt$(origAmt)}`
  })()

  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 900 : false

  return (
    <AppShell>
      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('[data-drawer-shell="true"]')) return
          if (target.closest('[data-drawer-open="true"]')) return
          closeDrawers()
        }}
      >
        <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
          <button
            data-drawer-open="true"
            onClick={(e) => {
              e.stopPropagation()
              navigate('/')
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 10,
              padding: 0,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = '#0ea5e9'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = '#64748b'
            }}
          >
            ← Back to My Holdings
          </button>

          <h1 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
            {isMarket ? 'Marketplace – Available Loans' : 'Loan Portfolio – Amortization Schedules'}
          </h1>

          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            {isMarket
              ? 'Browse loans available for purchase. Click a loan to see its schedule.'
              : 'Click on a loan to see and export the amortization schedule.'}
          </p>

          <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#64748b' }}>
            Current Date: {fmtMY(today)}
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 10,
            padding: '0 20px 14px',
            flexShrink: 0,
            width: '100%',
          }}
        >
          {kpiTiles.map(tile => (
            <div key={tile.label} data-drawer-open="true">
              <KpiTile
                label={tile.label}
                value={tile.value}
                onClick={() => openKpi(tile.kpi)}
              />
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '0 20px 12px',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          <select value={filterName} onChange={e => setFilterName(e.target.value)} style={selectStyle}>
            <option value="">Name</option>
            {loanNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)} style={selectStyle}>
            <option value="">School</option>
            {schools.map(school => (
              <option key={school} value={school}>{school}</option>
            ))}
          </select>

          <select value={filterRate} onChange={e => setFilterRate(e.target.value)} style={selectStyle}>
            <option value="">Rate</option>
            <option value="low">Below 5%</option>
            <option value="mid">5% – 8%</option>
            <option value="high">Above 8%</option>
          </select>

          <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={selectStyle}>
            <option value="">Sort</option>
            <option value="purchase_asc">Purchase Date ↑</option>
            <option value="purchase_desc">Purchase Date ↓</option>
            <option value="start_asc">Loan Start ↑</option>
            <option value="start_desc">Loan Start ↓</option>
            <option value="amount_asc">Orig Amt ↑</option>
            <option value="amount_desc">Orig Amt ↓</option>
            <option value="rate_asc">Rate ↑</option>
            <option value="rate_desc">Rate ↓</option>
          </select>

          <button onClick={resetFilters} style={selectStyle}>Reset</button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} role="group" aria-label="View mode">
              <ViewModeButton
                active={viewMode === 'full'}
                lines={1}
                title="Full tiles"
                onClick={() => setViewMode('full')}
              />
              <ViewModeButton
                active={viewMode === 'compact'}
                lines={2}
                title="Compact tiles"
                onClick={() => setViewMode('compact')}
              />
              <ViewModeButton
                active={viewMode === 'table'}
                lines={3}
                title="Table view"
                onClick={() => setViewMode('table')}
              />
            </div>

            <button style={btnStyle} onClick={downloadCsv}>Download CSV</button>
            <button style={btnStyle} onClick={copyCsv}>Copy CSV</button>
            <button style={btnStyle} onClick={() => window.print()}>Print</button>
          </div>
        </div>

        <div style={{ flex: 1, padding: '0 20px 20px', overflow: 'hidden', minHeight: 0 }}>
          {loading && (
            <div style={{ padding: '40px 0', color: '#64748b', fontSize: 14 }}>Loading loans…</div>
          )}

          {error && (
            <div style={{ padding: '40px 0', color: '#ef4444', fontSize: 14 }}>Error loading loans: {error}</div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: '40px 0', color: '#64748b', fontSize: 14 }}>
              {isMarket ? 'No loans currently available in the marketplace.' : 'No loans found.'}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && viewMode === 'table' && (
            <LoanTable loans={loansWithAmort} onRowClick={openLoanDrawer} lastColumnMode="amort" />
          )}

          {!loading && !error && filtered.length > 0 && viewMode !== 'table' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isNarrow ? '1fr' : 'repeat(2, minmax(0, 1fr))',
                gap: 12,
                height: '100%',
                overflow: 'auto',
                paddingRight: 6,
                gridAutoRows: 'min-content',
              }}
            >
              {loansWithAmort.map((loan) => (
                <AmortLoanTile
                  key={String((loan as any).loanId ?? (loan as any).id)}
                  loan={loan as Loan2}
                  compact={viewMode === 'compact'}
                  onOpen={openLoanDrawer}
                />
              ))}
            </div>
          )}
        </div>

        <LoanDrawer
          loan={selectedLoan}
          open={loanDrawerOpen}
          onClose={closeDrawers}
          title={drawerTitle}
          subTitle={drawerSubTitle}
        >
          {loanDrawerOpen && selectedLoan && <AmortLoanDrawerBody loan={selectedLoan} />}
        </LoanDrawer>

        <KpiDrawer
          kpi={activeKpi}
          open={activeKpi !== null}
          onClose={closeDrawers}
          title={drawerTitle}
          subTitle={drawerSubTitle}
        >
          {activeKpi && (
            <AmortKpiDrawerContent
              kpi={activeKpi}
              loansWithAmort={loansWithAmort as Loan2[]}
            />
          )}
        </KpiDrawer>
      </div>
    </AppShell>
  )
}

function sortLoans(a: Loan2, b: Loan2, sortKey: string) {
  if (sortKey === 'purchase_asc') return a.purchaseDate.localeCompare(b.purchaseDate)
  if (sortKey === 'purchase_desc') return b.purchaseDate.localeCompare(a.purchaseDate)
  if (sortKey === 'start_asc') return a.loanStartDate.localeCompare(b.loanStartDate)
  if (sortKey === 'start_desc') return b.loanStartDate.localeCompare(a.loanStartDate)
  if (sortKey === 'amount_asc') return a.principal - b.principal
  if (sortKey === 'amount_desc') return b.principal - a.principal
  if (sortKey === 'rate_asc') return a.nominalRate - b.nominalRate
  if (sortKey === 'rate_desc') return b.nominalRate - a.nominalRate
  return 0
}
