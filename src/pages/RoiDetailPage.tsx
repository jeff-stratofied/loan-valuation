import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'

import { usePortfolio } from '../hooks/usePortfolio'
import { useUser } from '../context/UserContext'

import AppShell from '../components/AppShell'
import LoanTable from '../components/LoanTable'
import SharedLoanDrawer from '../components/LoanDrawer'
import SharedKpiDrawer from '../components/KpiDrawer'
import RoiChart from '../components/RoiChart'
import OwnershipPie from '../components/OwnershipPie'
import type { LoanSeries } from '../components/RoiChart'
import type { Loan2 } from '../components/LoanTable'

type RoiKpiKey = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4'
type DrawerMode = { kind: 'kpi'; kpi: RoiKpiKey } | { kind: 'loan'; loanId: string } | null
type ViewMode = 'full' | 'compact' | 'table'

type TooltipState = {
  x: number
  y: number
  title?: string
  lines: string[]
} | null

const fmtPct = (v: number, d = 2) => `${Number(v || 0).toFixed(d)}%`
const fmt$ = (v: number) =>
  Number(v || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
const fmtMY = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const TODAY = new Date()
const KPI_CURRENT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)

const filterSelectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const filterBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const drawerThStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: '#94a3b8',
  fontWeight: 700,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #e2e8f0',
  position: 'sticky',
  top: 0,
  background: '#f8fafc',
}
const drawerThR: React.CSSProperties = { ...drawerThStyle, textAlign: 'right' }

function getLoanId(loan: any) {
  return String(loan?.loanId ?? loan?.id ?? '')
}

function getLoanName(loan: any) {
  return loan?.loanName ?? loan?.name ?? ''
}

function getLoanColor(loan: any, fallback = '#0ea5e9') {
  return String(loan?.loanColor ?? loan?.color ?? fallback)
}

function getNominalRatePct(loan: any) {
  const r = Number(loan?.nominalRate ?? 0)
  return r < 1 ? r * 100 : r
}

function getOriginalLoanAmount(loan: any) {
  return Number(loan?.originalLoanAmount ?? loan?.origLoanAmt ?? loan?.loanAmount ?? loan?.principal ?? 0)
}

function getPurchasePrice(loan: any) {
  return Number(loan?.userPurchasePrice ?? loan?.purchasePrice ?? 0)
}

function getOwnershipPct01(loan: any) {
  const raw = Number(loan?.ownershipPct ?? loan?.userOwnershipPct ?? 0)
  return Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw))
}

function getLoanMaturityDate(loan: any) {
  const sched = loan?.amort?.schedule ?? []
  const last = sched.length ? sched[sched.length - 1] : null
  return last?.loanDate instanceof Date ? last.loanDate : last?.loanDate ? new Date(last.loanDate) : null
}

function getRoiSeries(loan: any) {
  return Array.isArray(loan?.roiSeries) ? loan.roiSeries : []
}

function getCurrentRoiEntry(loan: any) {
  const series = getRoiSeries(loan)
  return (
    series.find((r: any) => {
      const d = r.date instanceof Date ? r.date : new Date(r.date)
      return d.getFullYear() === KPI_CURRENT_MONTH.getFullYear() && d.getMonth() === KPI_CURRENT_MONTH.getMonth()
    }) ?? (series.length ? series[series.length - 1] : undefined)
  )
}

function getCurrentRoiPct(loan: any) {
  return Number(getCurrentRoiEntry(loan)?.roi ?? 0) * 100
}

function getProjectedRoiPct(loan: any) {
  const series = getRoiSeries(loan)
  return Number(series.length ? series[series.length - 1]?.roi ?? 0 : 0) * 100
}

function getLoanEventBadges(loan: any) {
  const events = Array.isArray(loan?.events) ? loan.events : []
  const types = new Set(events.map((e: any) => e?.type))
  const out: { type: string; label: string }[] = []
  if (types.has('prepayment')) out.push({ type: 'prepayment', label: '💰 Prepay' })
  if (types.has('deferral')) out.push({ type: 'deferral', label: '⏸ Deferral' })
  if (types.has('default')) out.push({ type: 'default', label: '⚠️ Default' })
  return out
}

function getPrimaryEventType(loan: any) {
  const types = new Set((loan?.events ?? []).map((e: any) => e?.type))
  if (types.has('default')) return 'default'
  if (types.has('deferral')) return 'deferral'
  if (types.has('prepayment')) return 'prepayment'
  return ''
}

function getEventTooltipLines(event: any) {
  const type = event?.type
  if (type === 'prepayment') {
    return [
      'Prepayment',
      `Date: ${event?.date ? fmtMY(new Date(event.date)) : '—'}`,
      `Amount: ${fmt$(Number(event?.amount ?? 0))}`,
    ]
  }
  if (type === 'deferral') {
    return [
      'Deferral',
      `Start: ${event?.startDate || event?.date ? fmtMY(new Date(event.startDate ?? event.date)) : '—'}`,
      `Months: ${String(event?.months ?? event?.durationMonths ?? 0)}`,
    ]
  }
  if (type === 'default') {
    return [
      'Default',
      `Date: ${event?.date ? fmtMY(new Date(event.date)) : '—'}`,
      `Recovered: ${fmt$(Number(event?.recoveredAmount ?? event?.recovered ?? 0))}`,
    ]
  }
  return ['Event']
}

function getEventRowBg(loan: any, d: Date, row: any, index: number) {
  const rowKey = d.getFullYear() * 12 + d.getMonth()
  const isPrepayMonth = (loan?.events ?? []).some((e: any) => {
    if (e?.type !== 'prepayment' || !e?.date) return false
    const ed = e.date instanceof Date ? e.date : new Date(e.date)
    return !isNaN(+ed) && ed.getFullYear() * 12 + ed.getMonth() === rowKey
  })

  if (isPrepayMonth) return 'rgba(22,163,74,0.12)'
  if (row?.isTerminal === true) return 'rgba(220,38,38,0.10)'
  if (row?.isOwned && row?.isDeferred === true) return 'rgba(234,179,8,0.13)'
  return index % 2 === 1 ? 'rgba(15,23,42,0.015)' : 'transparent'
}

function StatBar({
  primaryLabel,
  primaryValue,
  secondaryLabel,
  secondaryValue,
}: {
  primaryLabel: string
  primaryValue: string
  secondaryLabel: string
  secondaryValue: string
}) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <div style={{ flex: 1, background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{primaryLabel}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{primaryValue}</div>
      </div>
      <div style={{ width: 190, background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{secondaryLabel}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{secondaryValue}</div>
      </div>
    </div>
  )
}

function ChartBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'linear-gradient(180deg,#fff,#fcfeff)', borderRadius: 8, border: '1px solid rgba(15,23,42,0.06)', boxShadow: '0 6px 18px rgba(15,23,42,0.06)', padding: 8 }}>
      {children}
    </div>
  )
}

function EventBadge({ event, showTooltip, moveTooltip, hideTooltip }: { event: any; showTooltip: (e: React.MouseEvent, title: string | undefined, lines: string[]) => void; moveTooltip: (e: React.MouseEvent) => void; hideTooltip: () => void }) {
  const type = String(event?.type ?? '')
  const label = type === 'prepayment' ? '💰 Prepay' : type === 'deferral' ? '⏸ Deferral' : type === 'default' ? '⚠️ Default' : 'Event'
  const bg = type === 'prepayment' ? 'rgba(34,197,94,0.18)' : type === 'deferral' ? 'rgba(234,179,8,0.18)' : 'rgba(239,68,68,0.15)'
  const color = type === 'prepayment' ? '#166534' : type === 'deferral' ? '#92400e' : '#b91c1c'
  const borderColor = type === 'prepayment' ? 'rgba(34,197,94,0.35)' : type === 'deferral' ? 'rgba(234,179,8,0.35)' : 'rgba(239,68,68,0.35)'
  const lines = getEventTooltipLines(event)

  return (
    <span
      onMouseEnter={(e) => showTooltip(e, undefined, lines)}
      onMouseMove={moveTooltip}
      onMouseLeave={hideTooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 999,
        border: `1px solid ${borderColor}`,
        background: bg,
        color,
        cursor: 'default',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function OwnershipBadge({ loan, showTooltip, moveTooltip, hideTooltip }: { loan: Loan2; showTooltip: (e: React.MouseEvent, title: string | undefined, lines: string[]) => void; moveTooltip: (e: React.MouseEvent) => void; hideTooltip: () => void }) {
  const pct = getOwnershipPct01(loan)
  const color = getLoanColor(loan)
  return (
    <div
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={(e) => showTooltip(e, undefined, [`${Math.round(pct * 100)}% of Loan Owned`])}
      onMouseMove={moveTooltip}
      onMouseLeave={hideTooltip}
    >
      <OwnershipPie userPct={pct} marketPct={0} color={color} size={26} />
    </div>
  )
}

function RoiMiniChart({ loan, compact, showTooltip, moveTooltip, hideTooltip }: { loan: any; compact?: boolean; showTooltip: (e: React.MouseEvent, title: string | undefined, lines: string[]) => void; moveTooltip: (e: React.MouseEvent) => void; hideTooltip: () => void }) {
  const series = useMemo(() => {
    return getRoiSeries(loan).map((p: any, i: number) => ({
      i,
      date: p.date instanceof Date ? p.date : new Date(p.date),
      roi: Number(p.roi ?? 0),
      loanValue: Number(p.loanValue ?? 0),
    }))
  }, [loan])

  const W = 170
  const H = 48
  const PAD = 4
  const color = getLoanColor(loan)

  if (compact) {
    return <div style={{ width: 1, height: 1 }} />
  }

  if (!series.length) {
    return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 170, height: 48, display: 'block' }} />
  }

  const minY = Math.min(...series.map((s) => s.roi))
  const maxY = Math.max(...series.map((s) => s.roi))
  const rangeY = Math.max(1e-6, maxY - minY)
  const xAt = (i: number) => PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2)
  const yAt = (v: number) => PAD + (H - PAD * 2) - ((v - minY) / rangeY) * (H - PAD * 2)
  const d = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.roi)}`).join(' ')

  const currentIdx = (() => {
    let idx = -1
    series.forEach((s, i) => {
      if (s.date <= KPI_CURRENT_MONTH) idx = i
    })
    return idx
  })()

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 170, height: 48, display: 'block', overflow: 'visible' }}>
      {currentIdx >= 0 && (
        <line
          x1={xAt(currentIdx)}
          x2={xAt(currentIdx)}
          y1={PAD}
          y2={H - PAD}
          stroke="#111827"
          strokeDasharray="3 3"
          strokeOpacity="0.6"
        />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth="2" />
      {series.map((p, i) => {
        const x = xAt(i)
        const y = yAt(p.roi)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="3.5" fill={color} opacity={0} />
            <rect
              x={Math.max(0, x - 6)}
              y={0}
              width={12}
              height={H}
              fill="transparent"
              onMouseEnter={(e) =>
                showTooltip(e, fmtMY(p.date), [`ROI: ${fmtPct(p.roi * 100)}`, `Loan Value: ${fmt$(p.loanValue)}`])
              }
              onMouseMove={moveTooltip}
              onMouseLeave={hideTooltip}
            />
          </g>
        )
      })}
    </svg>
  )
}

function AmortLoanTile({ loan, compact, onOpen, showTooltip, moveTooltip, hideTooltip }: { loan: Loan2; compact?: boolean; onOpen: (loan: Loan2) => void; showTooltip: (e: React.MouseEvent, title: string | undefined, lines: string[]) => void; moveTooltip: (e: React.MouseEvent) => void; hideTooltip: () => void }) {
  const roiPct = getCurrentRoiPct(loan)
  const badges = getLoanEventBadges(loan)
  const maturity = getLoanMaturityDate(loan)

  return (
    <div
      data-drawer-open="true"
      onClick={() => onOpen(loan)}
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
        e.currentTarget.style.boxShadow = '0 12px 30px rgba(15,23,42,0.10)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = ''
        e.currentTarget.style.boxShadow = ''
      }}
    >
      <div style={{ flex: 1, paddingRight: compact ? 0 : 10, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: compact ? 13 : 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getLoanName(loan)}</div>

        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {badges.map((b) => {
            const event = (loan as any)?.events?.find((e: any) => e?.type === b.type)
            return <EventBadge key={b.type} event={event ?? { type: b.type }} showTooltip={showTooltip} moveTooltip={moveTooltip} hideTooltip={hideTooltip} />
          })}
          <OwnershipBadge loan={loan} showTooltip={showTooltip} moveTooltip={moveTooltip} hideTooltip={hideTooltip} />
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginTop: 4, lineHeight: 1.2 }}>{(loan as any).school ?? ''}</div>

        {!compact && (
          <>
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--muted)', marginTop: 8, flexWrap: 'wrap' }}>
              <span>{getNominalRatePct(loan).toFixed(2)}%</span>
              <span>·</span>
              <span>{String((loan as any).termYears ?? 0)} yrs</span>
              <span>·</span>
              <span>Matures: {maturity ? fmtMY(maturity) : '—'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
              <span>Loan {getLoanId(loan)}</span>
            </div>
          </>
        )}
      </div>

      <div style={{ width: compact ? 'auto' : 170, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', position: 'relative', overflow: 'visible' }}>
        <div style={{ fontSize: compact ? 13 : 12, color: 'var(--muted)', marginBottom: compact ? 0 : 6, fontWeight: compact ? 700 : 400 }}>
          ROI {fmtPct(roiPct)}
        </div>
        {!compact && <RoiMiniChart loan={loan} showTooltip={showTooltip} moveTooltip={moveTooltip} hideTooltip={hideTooltip} />}
      </div>
    </div>
  )
}

function LoanDrawerBody({ loan }: { loan: any }) {
  const color = getLoanColor(loan)
  const roiSeries: { date: Date; roi: number; loanValue: number }[] = getRoiSeries(loan)

  const singleSeries: LoanSeries[] = useMemo(
    () => [
      {
        id: getLoanId(loan),
        name: getLoanName(loan),
        color,
        data: roiSeries.map((s) => ({
          date: s.date instanceof Date ? s.date : new Date(s.date),
          y: s.roi,
        })),
      },
    ],
    [loan, roiSeries, color]
  )

  const chartDates = useMemo(() => roiSeries.map((s) => (s.date instanceof Date ? s.date : new Date(s.date))), [roiSeries])
  const origAmt = getOriginalLoanAmount(loan)
  const rate = getNominalRatePct(loan)

  return (
    <>
      <ChartBox>
        <RoiChart
          perLoanSeries={singleSeries}
          weightedSeries={[]}
          dates={chartDates}
          height={240}
          tickSpacingX={Math.max(1, Math.round(chartDates.length / 8))}
          weightedColor={color}
          weightedWidth={0}
          weightedLabel=""
          focusedLoanId={null}
          onFocusLoan={() => {}}
        />
      </ChartBox>

      <StatBar
        primaryLabel="Orig Loan Amount"
        primaryValue={fmt$(origAmt)}
        secondaryLabel="Nominal Rate"
        secondaryValue={rate.toFixed(2) + '%'}
      />

      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>ROI by Month</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '45vh', overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={drawerThStyle}>Month</th>
                <th style={drawerThR}>Balance</th>
                <th style={drawerThR}>Loan Value</th>
                <th style={drawerThR}>ROI</th>
              </tr>
            </thead>
            <tbody>
              {roiSeries.map((s, i) => {
                const d = s.date instanceof Date ? s.date : new Date(s.date)
                const sched = loan.amort?.schedule ?? []
                const row =
                  sched.find(
                    (r: any) =>
                      r.loanDate instanceof Date &&
                      r.loanDate.getFullYear() === d.getFullYear() &&
                      r.loanDate.getMonth() === d.getMonth()
                  ) ?? {}
                const roiPct = (s.roi ?? 0) * 100
                const eventBg = getEventRowBg(loan, d, row, i)

                return (
                  <tr key={i} style={{ background: eventBg }}>
                    <td style={{ padding: '7px 10px', textAlign: 'left', color: '#0f172a' }}>{fmtMY(d)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{row.balance != null ? fmt$(row.balance) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{s.loanValue != null ? fmt$(s.loanValue) : '—'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: roiPct >= 0 ? '#16a34a' : '#dc2626' }}>{roiPct.toFixed(2)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function KpiTable({ loans, mode, focusedLoanId, onFocusLoan, colorById }: { loans: any[]; mode: 'roi-date' | 'projected' | 'capital' | 'spread'; focusedLoanId: string | null; onFocusLoan: (id: string | null) => void; colorById?: Record<string, string> }) {
  const headers = {
    'roi-date': ['Loan', 'Purchase Date', 'Maturity Date', 'ROI to Date'],
    projected: ['Loan', 'Purchase Date', 'Maturity Date', 'Projected ROI'],
    capital: ['Loan', 'Cap Recovered', '% Recovered', 'Remaining'],
    spread: ['Loan', 'Purchase Date', 'Maturity Date', 'ROI to Date', 'Δ vs Best'],
  }[mode]

  const best = mode === 'spread' ? (loans[0]?.roiNow ?? 0) : 0

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '45vh', overflow: 'auto', background: '#fff' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h} style={i === 0 ? drawerThStyle : drawerThR}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loans.map((loan: any) => {
            const loanId = getLoanId(loan)
            const color = (colorById && colorById[loanId]) ?? getLoanColor(loan, '#64748b')
            const isFocused = focusedLoanId != null && focusedLoanId === loanId
            const isDimmed = focusedLoanId != null && !isFocused

            const roiSeries = loan.roiSeries ?? []
            const amortSchedule = loan.amort?.schedule ?? []

            const currentEntry = getCurrentRoiEntry(loan)
            const roiDate = currentEntry?.roi ?? 0
            const roiProj = roiSeries.length > 0 ? (roiSeries[roiSeries.length - 1]?.roi ?? 0) : 0
            const matDate = (() => {
              const last = amortSchedule.length > 0 ? amortSchedule[amortSchedule.length - 1] : undefined
              return last?.loanDate instanceof Date ? fmtMY(last.loanDate) : '—'
            })()
            const purchDate = loan.purchaseDate
              ? (() => {
                  try {
                    return fmtMY(new Date(loan.purchaseDate))
                  } catch {
                    return loan.purchaseDate
                  }
                })()
              : '—'

            let capRecovered = 0
            const capInvested = getPurchasePrice(loan)
            if (mode === 'capital') {
              ;(loan.amort?.schedule ?? []).forEach((r: any) => {
                if (r.isOwned && r.loanDate instanceof Date && r.loanDate <= KPI_CURRENT_MONTH) {
                  const p = Math.max(0, (Number(r.principalPaid) || 0) - (Number(r.prepayment) || 0))
                  capRecovered += (p + (Number(r.interest) || 0) - (Number(r.feeThisMonth) || 0)) * getOwnershipPct01(loan)
                }
              })
            }

            return (
              <tr
                key={loanId}
                style={{ borderBottom: '1px solid #f1f5f9', background: isFocused ? 'rgba(148,163,184,0.08)' : 'transparent', opacity: isDimmed ? 0.3 : 1, transition: 'opacity 0.15s' }}
                onMouseEnter={() => onFocusLoan(loanId)}
                onMouseLeave={() => onFocusLoan(null)}
              >
                <td style={{ padding: '9px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{getLoanName(loan)}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{loan.school}</div>
                    </div>
                  </div>
                </td>
                {(mode === 'roi-date' || mode === 'projected' || mode === 'spread') && (
                  <>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{purchDate}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{matDate}</td>
                  </>
                )}
                {mode === 'roi-date' && <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: roiDate >= 0 ? '#16a34a' : '#dc2626' }}>{fmtPct(roiDate * 100)}</td>}
                {mode === 'projected' && <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color }}>{fmtPct(roiProj * 100)}</td>}
                {mode === 'capital' && (
                  <>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt$(capRecovered)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmtPct(capInvested > 0 ? (capRecovered / capInvested) * 100 : 0)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8' }}>{fmt$(Math.max(0, capInvested - capRecovered))}</td>
                  </>
                )}
                {mode === 'spread' && (
                  <>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: loan.roiNow >= 0 ? '#16a34a' : '#dc2626' }}>{fmtPct(loan.roiNow * 100)}</td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{fmtPct((loan.roiNow - best) * 100)}</td>
                  </>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function KpiDrawerBody({ kpi, loansWithRoi, roiKpis, roiTimeline }: { kpi: RoiKpiKey; loansWithRoi: any[]; roiKpis: any; roiTimeline: any }) {
  const [focusedLoanId, setFocusedLoanId] = useState<string | null>(null)

  const projTimeline = useMemo(
    () => ({
      perLoanSeries: (roiTimeline?.perLoanSeries ?? []) as LoanSeries[],
      weightedSeries: (roiTimeline?.weightedSeries ?? []) as { date: Date; y: number }[],
      dates: (roiTimeline?.dates ?? []) as Date[],
    }),
    [roiTimeline]
  )

  const colorById = useMemo(() => {
    const map: Record<string, string> = {}
    ;(roiTimeline?.perLoanSeries ?? []).forEach((s: any) => {
      if (s.id != null && s.color) map[String(s.id)] = s.color
    })
    return map
  }, [roiTimeline])

  const getColor = useCallback((loan: any): string => {
    const id = getLoanId(loan)
    return colorById[id] ?? getLoanColor(loan, '#64748b')
  }, [colorById])

  const kpi1 = useMemo(() => {
    if (!loansWithRoi.length) return { perLoan: [] as LoanSeries[], weighted: [] as { date: Date; y: number }[], dates: [] as Date[] }
    const validPurchases = loansWithRoi.map((l: any) => new Date(l.purchaseDate)).filter((d) => !isNaN(+d))
    const start = new Date(Math.min(...validPurchases.map((d) => +d)))
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    const dates: Date[] = []
    const cur = new Date(start)
    while (cur <= KPI_CURRENT_MONTH) {
      dates.push(new Date(cur))
      cur.setMonth(cur.getMonth() + 1)
    }

    const totalInvested = loansWithRoi.reduce((s: number, l: any) => s + getPurchasePrice(l), 0)
    const perLoan: LoanSeries[] = loansWithRoi.map((loan: any) => {
      const purchase = new Date(loan.purchaseDate)
      purchase.setHours(0, 0, 0, 0)
      const data = dates.map((d) => {
        if (d < purchase) return { date: d, y: null }
        const e = (loan.roiSeries ?? []).find((r: any) => {
          const rd = r.date instanceof Date ? r.date : new Date(r.date)
          return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth()
        })
        return { date: d, y: e?.roi ?? null }
      })
      return { id: getLoanId(loan), name: getLoanName(loan), color: getColor(loan), data }
    })
    const weighted = dates.map((d) => {
      if (totalInvested <= 0) return { date: d, y: 0 }
      let sum = 0
      loansWithRoi.forEach((l: any) => {
        const e = (l.roiSeries ?? []).find((r: any) => {
          const rd = r.date instanceof Date ? r.date : new Date(r.date)
          return rd.getFullYear() === d.getFullYear() && rd.getMonth() === d.getMonth()
        })
        if (e) sum += e.roi * getPurchasePrice(l)
      })
      return { date: d, y: sum / totalInvested }
    })
    return { perLoan, weighted, dates }
  }, [loansWithRoi, getColor])

  const kpi3 = useMemo(() => {
    if (!loansWithRoi.length) return { perLoan: [] as LoanSeries[], portfolio: [] as { date: Date; y: number }[], dates: [] as Date[] }
    const allMs = new Set<number>()
    loansWithRoi.forEach((l: any) => {
      ;(l.amort?.schedule ?? []).forEach((r: any) => {
        if (r.loanDate instanceof Date && r.loanDate <= KPI_CURRENT_MONTH) {
          allMs.add(new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime())
        }
      })
    })
    const dates = Array.from(allMs).sort((a, b) => a - b).map((ms) => new Date(ms))
    const totalInvested = loansWithRoi.reduce((s: number, l: any) => s + getPurchasePrice(l), 0)
    const perLoan: LoanSeries[] = loansWithRoi.map((loan: any) => {
      const inv = getPurchasePrice(loan)
      if (!inv) return { id: getLoanId(loan), name: getLoanName(loan), color: getColor(loan), data: [] }
      let cum = 0
      const data = dates.map((d) => {
        const row = (loan.amort?.schedule ?? []).find(
          (r: any) => r.loanDate instanceof Date && r.loanDate.getFullYear() === d.getFullYear() && r.loanDate.getMonth() === d.getMonth()
        )
        if (row?.isOwned) {
          const p = Math.max(0, (Number(row.principalPaid) || 0) - (Number(row.prepayment) || 0))
          cum += (p + (Number(row.interest) || 0) - (Number(row.feeThisMonth) || 0)) * getOwnershipPct01(loan)
        }
        return { date: d, y: cum / inv }
      })
      return { id: getLoanId(loan), name: getLoanName(loan), color: getColor(loan), data }
    })
    let cumP = 0
    const portfolio = dates.map((d) => {
      loansWithRoi.forEach((l: any) => {
        const row = (l.amort?.schedule ?? []).find(
          (r: any) => r.loanDate instanceof Date && r.loanDate.getFullYear() === d.getFullYear() && r.loanDate.getMonth() === d.getMonth()
        )
        if (row?.isOwned) {
          const p = Math.max(0, (Number(row.principalPaid) || 0) - (Number(row.prepayment) || 0))
          cumP += (p + (Number(row.interest) || 0) - (Number(row.feeThisMonth) || 0)) * getOwnershipPct01(l)
        }
      })
      return { date: d, y: totalInvested > 0 ? cumP / totalInvested : 0 }
    })
    return { perLoan, portfolio, dates }
  }, [loansWithRoi, getColor])

  const portfolioValue = useMemo(
    () =>
      loansWithRoi.reduce((sum: number, l: any) => {
        const e = getCurrentRoiEntry(l)
        return sum + Number(e?.loanValue ?? 0)
      }, 0),
    [loansWithRoi]
  )

  const projPortfolioValue = useMemo(
    () =>
      loansWithRoi.reduce((sum: number, l: any) => {
        const series = l.roiSeries ?? []
        const last = series.length > 0 ? series[series.length - 1] : undefined
        return sum + Number(last?.loanValue ?? 0)
      }, 0),
    [loansWithRoi]
  )

  const spreadRows = useMemo(
    () =>
      loansWithRoi
        .map((l: any) => ({ ...l, roiNow: Number(getCurrentRoiEntry(l)?.roi ?? 0) }))
        .sort((a: any, b: any) => b.roiNow - a.roiNow),
    [loansWithRoi]
  )

  const chartBaseProps = {
    height: 260,
    focusedLoanId,
    onFocusLoan: (id: string | number | null) => setFocusedLoanId(id ? String(id) : null),
    weightedColor: '#000',
    weightedWidth: 2.6,
    weightedLabel: 'Weighted ROI',
  }

  const configs: Record<RoiKpiKey, { stat: { pLabel: string; pValue: string; sLabel: string; sValue: string }; tableTitle: string; tableMode: 'roi-date' | 'projected' | 'capital' | 'spread'; tableLoans: any[]; chart: React.ReactNode }> = {
    kpi1: {
      stat: { pLabel: 'Weighted ROI to Date', pValue: fmtPct((roiKpis?.weightedRoi ?? 0)), sLabel: 'Portfolio Value', sValue: fmt$(portfolioValue) },
      tableTitle: 'ROI to Date — Owned Loans',
      tableMode: 'roi-date',
      tableLoans: loansWithRoi,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={kpi1.perLoan} weightedSeries={kpi1.weighted} dates={kpi1.dates} tickSpacingX={Math.max(1, Math.round(kpi1.dates.length / 7))} />,
    },
    kpi2: {
      stat: { pLabel: 'Projected Weighted ROI', pValue: fmtPct((roiKpis?.projectedWeightedRoi ?? 0)), sLabel: 'Projected Portfolio Value', sValue: fmt$(projPortfolioValue) },
      tableTitle: 'Projected ROI at Maturity — Owned Loans',
      tableMode: 'projected',
      tableLoans: loansWithRoi,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={projTimeline.perLoanSeries} weightedSeries={projTimeline.weightedSeries} dates={projTimeline.dates} tickSpacingX={Math.max(1, Math.round(projTimeline.dates.length / 7))} />,
    },
    kpi3: {
      stat: { pLabel: 'Capital Recovered', pValue: fmtPct((roiKpis?.capitalRecoveryPct ?? 0)), sLabel: 'As of', sValue: fmtMY(KPI_CURRENT_MONTH) },
      tableTitle: 'Capital Recovery — Owned Loans',
      tableMode: 'capital',
      tableLoans: loansWithRoi,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={kpi3.perLoan} weightedSeries={kpi3.portfolio} dates={kpi3.dates} tickSpacingX={Math.max(1, Math.round(kpi3.dates.length / 7))} weightedColor="#111827" weightedWidth={3} weightedLabel="Portfolio Recovered" />,
    },
    kpi4: {
      stat: { pLabel: 'ROI Spread', pValue: fmtPct((roiKpis?.roiSpread ?? 0)), sLabel: 'Loans', sValue: String(loansWithRoi.length) },
      tableTitle: 'ROI Spread — Owned Loans',
      tableMode: 'spread',
      tableLoans: spreadRows,
      chart: <RoiChart {...chartBaseProps} perLoanSeries={kpi1.perLoan} weightedSeries={[]} dates={kpi1.dates} tickSpacingX={Math.max(1, Math.round(kpi1.dates.length / 7))} weightedWidth={0} weightedLabel="" />,
    },
  }

  const cfg = configs[kpi]

  return (
    <>
      <ChartBox>{cfg.chart}</ChartBox>
      <StatBar primaryLabel={cfg.stat.pLabel} primaryValue={cfg.stat.pValue} secondaryLabel={cfg.stat.sLabel} secondaryValue={cfg.stat.sValue} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>{cfg.tableTitle}</div>
        <KpiTable loans={cfg.tableLoans} mode={cfg.tableMode} focusedLoanId={focusedLoanId} onFocusLoan={setFocusedLoanId} colorById={colorById} />
      </div>
    </>
  )
}

function ViewModeButton({
  active, lines, title, onClick,
}: {
  active: boolean; lines: 1 | 2 | 3; title: string; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} title={title} style={{
      width: 34, height: 30, borderRadius: 8,
      border: `1px solid ${active ? '#0ea5e9' : 'var(--border)'}`,
      background: active ? 'rgba(14,165,233,0.08)' : 'var(--card)',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      gap: 4, padding: 6, cursor: 'pointer',
    }}>
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} style={{
          height: 2, background: active ? '#0ea5e9' : 'var(--muted)',
          borderRadius: 2, display: 'block',
        }} />
      ))}
    </button>
  )
}

export default function RoiDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialKpi = (searchParams.get('kpi') as RoiKpiKey) || null
  const initialLoanId = searchParams.get('loan') || null
  const [drawer, setDrawer] = useState<DrawerMode>(initialLoanId ? { kind: 'loan', loanId: initialLoanId } : initialKpi ? { kind: 'kpi', kpi: initialKpi } : null)
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('roiViewMode') as ViewMode) || 'full')
  const [hoverTooltip, setHoverTooltip] = useState<TooltipState>(null)

  const navigate = useNavigate()
  const { userId } = useUser()
  const { roiKpis, roiTimeline, loansWithRoi, loading, error } = usePortfolio(userId)

  const [filterName, setFilterName] = useState('')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterRate, setFilterRate] = useState('')
  const [sortKey, setSortKey] = useState('')

  useEffect(() => {
    localStorage.setItem('roiViewMode', viewMode)
  }, [viewMode])

  const showTooltip = useCallback((e: React.MouseEvent, title: string | undefined, lines: string[]) => {
    setHoverTooltip({ x: e.clientX + 12, y: e.clientY - 12, title, lines })
  }, [])

  const moveTooltip = useCallback((e: React.MouseEvent) => {
    setHoverTooltip((prev) => (prev ? { ...prev, x: e.clientX + 12, y: e.clientY - 12 } : prev))
  }, [])

  const hideTooltip = useCallback(() => setHoverTooltip(null), [])

  const loanNames = useMemo(() => [...new Set(loansWithRoi.map((l: any) => getLoanName(l)))].filter(Boolean).sort(), [loansWithRoi])
  const schools = useMemo(() => [...new Set(loansWithRoi.map((l: any) => l.school ?? ''))].filter(Boolean).sort(), [loansWithRoi])

  const filteredLoans = useMemo(() => {
    let rows = [...loansWithRoi]
    if (filterName) rows = rows.filter((l: any) => getLoanName(l) === filterName)
    if (filterSchool) rows = rows.filter((l: any) => l.school === filterSchool)
    if (filterRate === 'low') rows = rows.filter((l: any) => getNominalRatePct(l) < 5)
    if (filterRate === 'mid') rows = rows.filter((l: any) => {
      const rp = getNominalRatePct(l)
      return rp >= 5 && rp <= 8
    })
    if (filterRate === 'high') rows = rows.filter((l: any) => getNominalRatePct(l) > 8)
    if (sortKey === 'purchase_asc') rows.sort((a: any, b: any) => String(a.purchaseDate).localeCompare(String(b.purchaseDate)))
    if (sortKey === 'purchase_desc') rows.sort((a: any, b: any) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)))
    if (sortKey === 'amount_asc') rows.sort((a: any, b: any) => getOriginalLoanAmount(a) - getOriginalLoanAmount(b))
    if (sortKey === 'amount_desc') rows.sort((a: any, b: any) => getOriginalLoanAmount(b) - getOriginalLoanAmount(a))
    if (sortKey === 'rate_asc') rows.sort((a: any, b: any) => getNominalRatePct(a) - getNominalRatePct(b))
    if (sortKey === 'rate_desc') rows.sort((a: any, b: any) => getNominalRatePct(b) - getNominalRatePct(a))
    if (sortKey === 'roi_asc') rows.sort((a: any, b: any) => getCurrentRoiPct(a) - getCurrentRoiPct(b))
    if (sortKey === 'roi_desc') rows.sort((a: any, b: any) => getCurrentRoiPct(b) - getCurrentRoiPct(a))
    return rows
  }, [loansWithRoi, filterName, filterSchool, filterRate, sortKey])

  function resetFilters() {
    setFilterName('')
    setFilterSchool('')
    setFilterRate('')
    setSortKey('')
  }

  const kpis: { key: RoiKpiKey; label: string; value: string }[] = [
    { key: 'kpi1', label: 'Weighted ROI to Current Month', value: fmtPct((roiKpis?.weightedRoi ?? 0)) },
    { key: 'kpi2', label: 'Projected Weighted ROI', value: fmtPct((roiKpis?.projectedWeightedRoi ?? 0)) },
    { key: 'kpi3', label: 'Capital Recovered', value: fmtPct((roiKpis?.capitalRecoveryPct ?? 0)) },
    { key: 'kpi4', label: 'ROI Spread', value: fmtPct((roiKpis?.roiSpread ?? 0)) },
  ]

  function handleKpiClick(key: RoiKpiKey) {
    setDrawer({ kind: 'kpi', kpi: key })
    setSearchParams({ kpi: key })
  }

  function handleLoanRowClick(loan: any) {
    const loanId = getLoanId(loan)
    setDrawer({ kind: 'loan', loanId })
    setSearchParams({ loan: loanId })
  }

  function closeDrawer() {
    setDrawer(null)
    setSearchParams({})
  }

  const drawerTitle = (() => {
    if (!drawer) return ''
    if (drawer.kind === 'kpi') {
      return {
        kpi1: 'Weighted ROI to Date',
        kpi2: 'Projected Weighted ROI',
        kpi3: 'Capital Recovery Over Time',
        kpi4: 'ROI Spread',
      }[drawer.kpi]
    }
    const loan = loansWithRoi.find((l) => getLoanId(l) === drawer.loanId)
    return loan ? getLoanName(loan) : drawer.loanId
  })()

  const drawerSubTitle = (() => {
    if (!drawer) return undefined
    if (drawer.kind === 'kpi') {
      return {
        kpi1: 'Current Portfolio Snapshot',
        kpi2: 'Projection to Maturity',
        kpi3: 'Cumulative principal returned as a percentage of purchase price.',
        kpi4: 'Best vs Worst Performing Loans',
      }[drawer.kpi]
    }
    const loan = loansWithRoi.find((l) => getLoanId(l) === drawer.loanId)
    if (!loan) return undefined
    return `${loan.school}\nPurchased ${loan.purchaseDate} · Orig Loan Amt ${fmt$(getOriginalLoanAmount(loan))} · Loan Purchase Price ${fmt$(getPurchasePrice(loan))}`
  })()

  const activeLoan = drawer?.kind === 'loan' ? loansWithRoi.find((l) => getLoanId(l) === drawer.loanId) : null

  const tooltipPortal =
    hoverTooltip && typeof document !== 'undefined'
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              left: hoverTooltip.x,
              top: hoverTooltip.y,
              zIndex: 99999,
              pointerEvents: 'none',
              background: '#0b1736',
              color: 'white',
              borderRadius: 12,
              padding: '10px 12px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.12)',
              maxWidth: 280,
              lineHeight: 1.25,
              fontSize: 12,
              transform: 'translateY(-100%)',
              whiteSpace: 'nowrap',
            }}
          >
            {hoverTooltip.title ? <div style={{ fontWeight: 700, marginBottom: hoverTooltip.lines.length ? 4 : 0 }}>{hoverTooltip.title}</div> : null}
            {hoverTooltip.lines.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </div>,
          document.body
        )
      : null

  if (loading) {
    return (
      <AppShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b', fontSize: 15 }}>Loading portfolio…</div>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#ef4444', fontSize: 15 }}>Error: {error}</div>
      </AppShell>
    )
  }

  return (
    <>
      <AppShell>
        <div
          style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.closest('[data-drawer-shell="true"]')) return
            if (target.closest('[data-drawer-open="true"]')) return
            closeDrawer()
          }}
        >
          <div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
            <button
              type="button"
              data-drawer-open="true"
              onClick={() => navigate('/')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 13, fontWeight: 500, marginBottom: 10, padding: 0 }}
            >
              ← Back to My Holdings
            </button>
            <h1 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Loan Portfolio — ROI</h1>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              ROI to Date = (Loan Value Today – Purchase Price) / Purchase Price
              &nbsp;&nbsp;·&nbsp;&nbsp;
              Projected ROI = (Final Loan Value – Purchase Price) / Purchase Price
            </p>
            <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#64748b' }}>Current Date: {fmtMY(new Date())}</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, padding: '0 20px 14px', flexShrink: 0 }}>
            {kpis.map((k) => (
              <div
                key={k.key}
                data-drawer-open="true"
                onClick={() => handleKpiClick(k.key)}
                style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(15,23,42,0.06)', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px)'
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.10)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ''
                  e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,23,42,0.06)'
                }}
              >
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 20px 12px', flexShrink: 0, flexWrap: 'wrap' }}>
            <select value={filterName} onChange={(e) => setFilterName(e.target.value)} style={filterSelectStyle}>
              <option value="">Name</option>
              {loanNames.map((n: string) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <select value={filterSchool} onChange={(e) => setFilterSchool(e.target.value)} style={filterSelectStyle}>
              <option value="">School</option>
              {schools.map((s: string) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={filterRate} onChange={(e) => setFilterRate(e.target.value)} style={filterSelectStyle}>
              <option value="">Rate</option>
              <option value="low">Below 5%</option>
              <option value="mid">5% – 8%</option>
              <option value="high">Above 8%</option>
            </select>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} style={filterSelectStyle}>
              <option value="">Sort</option>
              <option value="purchase_asc">Purchase Date ↑</option>
              <option value="purchase_desc">Purchase Date ↓</option>
              <option value="amount_asc">Orig Amt ↑</option>
              <option value="amount_desc">Orig Amt ↓</option>
              <option value="rate_asc">Rate ↑</option>
              <option value="rate_desc">Rate ↓</option>
              <option value="roi_asc">ROI ↑</option>
              <option value="roi_desc">ROI ↓</option>
            </select>
            <button onClick={resetFilters} style={filterSelectStyle}>Reset</button>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} role="group" aria-label="View mode">
                  <ViewModeButton active={viewMode === 'full'} lines={1} title="Full tiles" onClick={() => setViewMode('full')} />
                  <ViewModeButton active={viewMode === 'compact'} lines={2} title="Compact tiles" onClick={() => setViewMode('compact')} />
                  <ViewModeButton active={viewMode === 'table'} lines={3} title="Table view" onClick={() => setViewMode('table')} />
                </div>
              </div>
              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{filteredLoans.length} loan{filteredLoans.length !== 1 ? 's' : ''}</span>
              <button style={filterBtnStyle}>Download CSV</button>
              <button style={filterBtnStyle}>Copy CSV</button>
              <button style={filterBtnStyle}>Print</button>
            </div>
          </div>

          <div style={{ flex: 1, padding: '0 20px 20px', overflow: 'hidden', minHeight: 0 }}>
            {viewMode === 'table' ? (
              <LoanTable loans={filteredLoans} onRowClick={handleLoanRowClick} />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, overflowY: 'auto', overflowX: 'hidden', maxHeight: '100%', paddingRight: 6 }}>
                {filteredLoans.map((loan: any) => (
                  <AmortLoanTile
                    key={getLoanId(loan)}
                    loan={loan}
                    compact={viewMode === 'compact'}
                    onOpen={handleLoanRowClick}
                    showTooltip={showTooltip}
                    moveTooltip={moveTooltip}
                    hideTooltip={hideTooltip}
                  />
                ))}
              </div>
            )}
          </div>

          <SharedKpiDrawer
            open={drawer?.kind === 'kpi'}
            kpi={drawer?.kind === 'kpi' ? drawer.kpi : null}
            onClose={closeDrawer}
            title={drawerTitle}
            subTitle={drawerSubTitle}
          >
            {drawer?.kind === 'kpi' && (
              <KpiDrawerBody
                kpi={drawer.kpi}
                loansWithRoi={filteredLoans}
                roiKpis={roiKpis}
                roiTimeline={roiTimeline}
              />
            )}
          </SharedKpiDrawer>

          <SharedLoanDrawer
            loan={activeLoan}
            open={drawer?.kind === 'loan'}
            onClose={closeDrawer}
            title={drawerTitle}
            subTitle={drawerSubTitle}
          >
            {drawer?.kind === 'loan' && activeLoan && <LoanDrawerBody loan={activeLoan} />}
          </SharedLoanDrawer>
        </div>
      </AppShell>
      {tooltipPortal}
    </>
  )
}