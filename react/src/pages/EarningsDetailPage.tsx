import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { usePortfolio } from '../hooks/usePortfolio'
import LoanTable from '../components/LoanTable'
import SharedLoanDrawer from '../components/LoanDrawer'
import SharedKpiDrawer from '../components/KpiDrawer'
import OwnershipPie from '../components/OwnershipPie'
import { useUser } from '../context/UserContext'
import AppShell from '../components/AppShell'

type EarningsKpiKey = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4'
type DrawerMode = { kind: 'kpi'; kpi: EarningsKpiKey } | { kind: 'loan'; loanId: string } | null
type ViewMode = 'full' | 'compact' | 'table'

const fmt$ = (v: number) =>
  '$' +
  Number(v || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const fmtMY = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const TODAY = new Date()
const CURRENT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)

const filterSelectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--border, #e2e8f0)',
  background: 'var(--card, #fff)',
  color: 'var(--text, #0f172a)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const filterBtnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid var(--border, #e2e8f0)',
  background: 'var(--card, #fff)',
  color: 'var(--text, #0f172a)',
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

const drawerThR: React.CSSProperties = {
  ...drawerThStyle,
  textAlign: 'right',
}

function getLoanId(loan: any): string {
  return String(loan?.loanId ?? loan?.id ?? '')
}

function getLoanName(loan: any): string {
  return String(loan?.loanName ?? loan?.name ?? '')
}

function getLoanColor(loan: any): string {
  return String(loan?.loanColor ?? loan?.color ?? '#0ea5e9')
}

function getOwnershipPct01(loan: any): number {
  const raw = Number(loan?.ownershipPct ?? loan?.userOwnershipPct ?? 1)
  return Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw))
}

function getNominalRatePct(loan: any): number {
  const r = Number(loan?.nominalRate ?? 0)
  return r < 1 ? r * 100 : r
}

function getOrigAmt(loan: any): number {
  return Number(
    loan?.originalLoanAmount ??
      loan?.origLoanAmt ??
      loan?.loanAmount ??
      loan?.principal ??
      0
  )
}

function getPurchasePrice(loan: any): number {
  return Number(loan?.purchasePrice ?? loan?.userPurchasePrice ?? 0)
}

function getLoanMaturityDate(loan: any): Date | null {
  const sched = getLoanEarningsSchedule(loan)
  const last = sched.length ? sched[sched.length - 1] : null
  return last?.loanDate instanceof Date ? last.loanDate : null
}

function getLoanEventTypes(loan: any): string[] {
  const events = Array.isArray(loan?.events) ? loan.events : []
  const seen = new Set<string>()
  events.forEach((e: any) => {
    if (e?.type) seen.add(String(e.type))
  })
  const ordered: string[] = []
  if (seen.has('prepayment')) ordered.push('prepayment')
  if (seen.has('deferral')) ordered.push('deferral')
  if (seen.has('default')) ordered.push('default')
  return ordered
}

function getRepresentativeEvent(loan: any, type: string): any | null {
  const events = Array.isArray(loan?.events) ? loan.events : []
  return events.find((e: any) => e?.type === type) ?? null
}

function getEventTooltipLines(loan: any, type: string): string[] {
  const event = getRepresentativeEvent(loan, type)

  if (type === 'prepayment') {
    return [
      'Prepayment',
      `Date: ${event?.date ? fmtDate(new Date(event.date)) : '—'}`,
      `Amount: ${fmt$(Number(event?.amount ?? 0))}`,
    ]
  }

  if (type === 'deferral') {
    return [
      'Deferral',
      `Start: ${event?.startDate ? fmtMY(new Date(event.startDate)) : event?.date ? fmtMY(new Date(event.date)) : '—'}`,
      `Months: ${String(event?.months ?? 0)}`,
    ]
  }

  if (type === 'default') {
    const recovered = Number(
      event?.recovered ??
        event?.recoveredAmount ??
        event?.recoveryAmount ??
        event?.amountRecovered ??
        0
    )

    let remaining = 0
    if (event?.date && Array.isArray(loan?.amort?.schedule)) {
      const defDate = new Date(event.date)
      const row = loan.amort.schedule.find((r: any) => {
        if (!(r?.loanDate instanceof Date)) return false
        return (
          r.loanDate.getFullYear() === defDate.getFullYear() &&
          r.loanDate.getMonth() === defDate.getMonth()
        )
      })
      remaining = Math.max(0, Number(row?.balance ?? 0) - recovered)
    }

    return [
      'Default',
      `Date: ${event?.date ? fmtMY(new Date(event.date)) : '—'}`,
      `Recovered: ${fmt$(recovered)}`,
      `Remaining: ${fmt$(remaining)}`,
    ]
  }

  return ['Event']
}

// Earnings helpers
function getLoanEarningsSchedule(loan: any): any[] {
  if (Array.isArray(loan.earningsSchedule) && loan.earningsSchedule.length > 0) {
    return loan.earningsSchedule
  }
  return (loan.amort?.schedule ?? []).filter(
    (r: any) => r.isOwned && r.loanDate instanceof Date
  )
}

function getOwnershipPct(loan: any): number {
  return Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)
}

function getRowMonthlyNet(r: any): number {
  if (r.monthlyNet !== undefined) return Number(r.monthlyNet ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  const principal =
    Math.max(
      0,
      Number(r.principalPaid ?? r.scheduledPrincipal ?? 0) -
        Number(r.prepayment ?? r.prepaymentPrincipal ?? 0)
    ) * pct
  const interest = (Number(r.interest) || 0) * pct
  const fee = (Number(r.feeThisMonth) || 0) * pct
  return principal + interest - fee
}

function getRowMonthlyPrincipal(r: any): number {
  if (r.monthlyPrincipal !== undefined) return Number(r.monthlyPrincipal ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  return (
    Math.max(
      0,
      Number(r.principalPaid ?? r.scheduledPrincipal ?? 0) -
        Number(r.prepayment ?? r.prepaymentPrincipal ?? 0)
    ) * pct
  )
}

function getRowMonthlyInterest(r: any): number {
  if (r.monthlyInterest !== undefined) return Number(r.monthlyInterest ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  return (Number(r.interest) || 0) * pct
}

function getRowMonthlyFees(r: any): number {
  if (r.monthlyFees !== undefined) return Number(r.monthlyFees ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  return (Number(r.feeThisMonth) || 0) * pct
}

function loanNetToDate(loan: any): number {
  return getLoanEarningsSchedule(loan)
    .filter((r: any) => r.loanDate instanceof Date && r.loanDate <= CURRENT_MONTH)
    .reduce((s: number, r: any) => s + getRowMonthlyNet(r), 0)
}

function loanFeesToDate(loan: any): number {
  return getLoanEarningsSchedule(loan)
    .filter((r: any) => r.loanDate instanceof Date && r.loanDate <= CURRENT_MONTH)
    .reduce((s: number, r: any) => s + getRowMonthlyFees(r), 0)
}

function allOwnedMonths(loans: any[]): Date[] {
  const ms = new Set<number>()
  loans.forEach((l) => {
    getLoanEarningsSchedule(l).forEach((r: any) => {
      if (r.loanDate instanceof Date) {
        ms.add(
          new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
        )
      }
    })
  })
  return Array.from(ms)
    .sort((a, b) => a - b)
    .map((t) => new Date(t))
}

function ownedMonthsToDate(loans: any[]): Date[] {
  return allOwnedMonths(loans).filter((d) => d <= CURRENT_MONTH)
}

function Tooltip({
  x,
  y,
  children,
}: {
  x: number
  y: number
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        position: 'fixed',
        left: x + 14,
        top: y - 14,
        transform: 'translateY(-100%)',
        background: '#1e293b',
        color: '#fff',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        lineHeight: 1.7,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        pointerEvents: 'none',
        zIndex: 99999,
        minWidth: 190,
        maxWidth: 260,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  )
}

// ── ChartLensOverlay: circular magnifier rendered inside the chart SVG ──
function ChartLensOverlay({
  cursorX, cursorY, stacks, hovIdx, xS, yS, zeroY, zoom = 2.8, r = 56,
}: {
  cursorX: number
  cursorY: number
  stacks: { idx: number; posTotal: number; negTotal: number; bars: { loanId: string; color: string; val: number; bottom: number; top: number }[] }[]
  hovIdx: number
  xS: (i: number) => number
  yS: (v: number) => number
  zeroY: number
  zoom?: number
  r?: number
}) {
  const cx = cursorX
  const cy = cursorY
  const clipId = `lens-clip-${hovIdx}`
  const WINDOW = 5
  const start = Math.max(0, hovIdx - WINDOW)
  const end = Math.min(stacks.length - 1, hovIdx + WINDOW)
  const visStacks = stacks.slice(start, end + 1)
  const origBarW = visStacks.length > 1 ? Math.abs(xS(1) - xS(0)) * 0.6 : 8
  const tx = cx - cx * zoom
  const ty = cy - cy * zoom

  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.93)" />
      <g clipPath={`url(#${clipId})`}>
        <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}>
          <line
            x1={xS(start) - origBarW * 3} x2={xS(end) + origBarW * 3}
            y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth={0.4}
          />
          {visStacks.map((stack) => {
            const bx = xS(stack.idx)
            const bW = Math.max(1.5, origBarW)
            const isHov = stack.idx === hovIdx
            let posCum = 0, negCum = 0
            return (
              <g key={stack.idx}>
                {stack.bars.map((bar) => {
                  if (bar.val === 0) return null
                  if (bar.val >= 0) {
                    const yTop = yS(posCum + bar.val)
                    const yBot = yS(posCum)
                    posCum += bar.val
                    return (
                      <rect key={bar.loanId}
                        x={bx - bW / 2} y={Math.min(yTop, yBot)}
                        width={bW} height={Math.max(0.5, Math.abs(yBot - yTop))}
                        fill={bar.color} opacity={isHov ? 1 : 0.45}
                      />
                    )
                  } else {
                    const yTop = yS(negCum)
                    const yBot = yS(negCum + bar.val)
                    negCum += bar.val
                    return (
                      <rect key={bar.loanId}
                        x={bx - bW / 2} y={Math.min(yTop, yBot)}
                        width={bW} height={Math.max(0.5, Math.abs(yBot - yTop))}
                        fill={bar.color} opacity={isHov ? 1 : 0.45}
                      />
                    )
                  }
                })}
              </g>
            )
          })}
        </g>
      </g>
      <circle cx={cx} cy={cy} r={r}
        fill="none" stroke="#94a3b8" strokeWidth={1.5}
        style={{ filter: 'drop-shadow(0 2px 10px rgba(15,23,42,0.18))' }}
      />
      <circle cx={cx} cy={cy} r={2.5} fill="#64748b" opacity={0.5} />
    </g>
  )
}

interface BarSeries {
  loanId: string
  name: string
  color: string
  data: Map<number, number>
}

function StackedBarChart({
  series,
  dates,
  height = 260,
  cumulative = false,
  visibleIds,
  focusedId,
  showTodayLine = true,
  compact = false,
  tooltipMode = 'portfolio',
  tooltipBreakdownByTs,
}: {
  series: BarSeries[]
  dates: Date[]
  height?: number
  cumulative?: boolean
  visibleIds?: Set<string>
  focusedId?: string | null
  showTodayLine?: boolean
  compact?: boolean
  tooltipMode?: 'portfolio' | 'loan-breakdown'
  tooltipBreakdownByTs?: Map<
    number,
    {
      principal: number
      interest: number
      fees: number
      net: number
    }
  >
}) {
  const [hovered, setHovered] = useState<{ idx: number; x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const visible = visibleIds ? series.filter((s) => visibleIds.has(s.loanId)) : series

  const resolvedSeries = useMemo(() => {
    if (!cumulative) return visible
    return visible.map((s) => {
      let running = 0
      const data = new Map<number, number>()
      dates.forEach((d) => {
        const ts = d.getTime()
        running += s.data.get(ts) ?? 0
        data.set(ts, running)
      })
      return { ...s, data }
    })
  }, [visible, dates, cumulative])

  const stacks = useMemo(
    () =>
      dates.map((d, idx) => {
        const ts = d.getTime()
        let posCum = 0
        let negCum = 0

        const bars = resolvedSeries.map((s) => {
          const val = s.data.get(ts) ?? 0

          if (val >= 0) {
            const bottom = posCum
            posCum += val
            return { loanId: s.loanId, color: s.color, val, bottom, top: posCum }
          }

          const top = negCum
          negCum += val
          return { loanId: s.loanId, color: s.color, val, bottom: negCum, top }
        })

        return {
          idx,
          date: d,
          ts,
          posTotal: posCum,
          negTotal: negCum,
          bars,
        }
      }),
    [resolvedSeries, dates]
  )

  const maxPos = Math.max(...stacks.map((s) => s.posTotal), 1)
  const minNeg = Math.min(...stacks.map((s) => s.negTotal), 0)
  const range = maxPos - minNeg || 1

  const PAD = { top: 20, right: 16, bottom: 36, left: 72 }
  const W = 860
  const H = height
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const barW = Math.max(2, Math.min(18, cW / Math.max(dates.length, 1) - 1))
  const xS = (i: number) => PAD.left + (i / Math.max(dates.length - 1, 1)) * cW
  const yS = (v: number) => PAD.top + cH - ((v - minNeg) / range) * cH
  const zeroY = yS(0)

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = minNeg + f * range
    return { v, y: yS(v) }
  })

  const xStep = Math.max(1, Math.round(dates.length / 8))
  const xTicks = dates.map((d, i) => ({ d, i })).filter(({ i }) => i % xStep === 0)
  const todayIdx = dates.findIndex(
    (d) =>
      d.getFullYear() === CURRENT_MONTH.getFullYear() &&
      d.getMonth() === CURRENT_MONTH.getMonth()
  )

  const hovStack = hovered !== null ? stacks[hovered.idx] : null

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.max(
      0,
      Math.min(
        dates.length - 1,
        Math.round(((svgX - PAD.left) / cW) * (dates.length - 1))
      )
    )
    setHovered({ idx, x: e.clientX, y: e.clientY })
  }

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        ref={svgRef}
        data-stacked-bar-chart
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height }}
        onMouseMove={handleSvgMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke={Math.abs(t.v) < 0.0001 ? '#94a3b8' : '#e2e8f0'}
              strokeWidth={Math.abs(t.v) < 0.0001 ? 1 : 0.5}
            />
            <text x={PAD.left - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
              {t.v < 0
                ? `-$${Math.abs(t.v) >= 1000 ? (Math.abs(t.v) / 1000).toFixed(0) + 'k' : Math.abs(t.v).toFixed(0)}`
                : t.v >= 1000
                  ? `$${(t.v / 1000).toFixed(0)}k`
                  : `$${t.v.toFixed(0)}`}
            </text>
          </g>
        ))}

        {stacks.map((stack) => {
          const cx = xS(stack.idx)
          const isHov = hovered?.idx === stack.idx

          return (
            <g key={stack.idx}>
              {stack.bars.map((bar) => {
                if (bar.val === 0) return null
                const yTop = yS(bar.top)
                const yBottom = yS(bar.bottom)
                const rectY = Math.min(yTop, yBottom)
                const rectH = Math.max(0, Math.abs(yBottom - yTop))
                const isDimmed = focusedId != null && focusedId !== bar.loanId

                return (
                  <rect
                    key={bar.loanId}
                    x={cx - barW / 2}
                    y={rectY}
                    width={barW}
                    height={rectH}
                    fill={bar.color}
                    opacity={isDimmed ? 0.12 : isHov ? 1 : 0.85}
                  />
                )
              })}

              {isHov && (
                <rect
                  x={cx - barW / 2 - 1}
                  y={20}
                  width={barW + 2}
                  height={cH}
                  fill="rgba(15,23,42,0.04)"
                  rx={2}
                />
              )}
            </g>
          )
        })}

        {showTodayLine && todayIdx >= 0 && (
          <line
            x1={xS(todayIdx)}
            x2={xS(todayIdx)}
            y1={20}
            y2={H - 36}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />
        )}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={zeroY}
          y2={zeroY}
          stroke="#94a3b8"
          strokeWidth={1}
        />

        {xTicks.map(({ d, i }) => (
          <text key={i} x={xS(i)} y={H - 36 + 14} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {fmtMY(d)}
          </text>
        ))}

        {/* ── CIRCULAR MAGNIFIER LENS (inside SVG) ── */}
        {hovStack && hovered && (() => {
          const rect = svgRef.current?.getBoundingClientRect()
          if (!rect) return null
          const svgX = ((hovered.x - rect.left) / rect.width) * W
          const svgY = ((hovered.y - rect.top) / rect.height) * H
          return (
            <ChartLensOverlay
              cursorX={svgX}
              cursorY={svgY}
              stacks={stacks}
              hovIdx={hovStack.idx}
              xS={xS}
              yS={yS}
              zeroY={zeroY}
            />
          )
        })()}
      </svg>

      {/* ── OLD MAGNIFIER LENS BLOCK REMOVED ── */}

      {hovStack &&
        hovered &&
        (() => {
          const activeSeries = series.filter((s) => !visibleIds || visibleIds.has(s.loanId))
          const cumulativeNet =
            (stacks[hovStack.idx]?.posTotal ?? 0) + (stacks[hovStack.idx]?.negTotal ?? 0)

          if (tooltipMode === 'loan-breakdown') {
            const principalSeries = activeSeries.find((s) => s.loanId === 'principal')
            const interestSeries = activeSeries.find((s) => s.loanId === 'interest')
            const feesSeries = activeSeries.find((s) => s.loanId === 'fees')

            const cumulativePrincipal = principalSeries?.data.get(hovStack.ts) ?? 0
            const cumulativeInterest = interestSeries?.data.get(hovStack.ts) ?? 0
            const feesRaw = feesSeries?.data.get(hovStack.ts) ?? 0
            const cumulativeFees = Math.abs(feesRaw)
            const cumulativeNet = cumulativePrincipal + cumulativeInterest - cumulativeFees

            return (
              <Tooltip x={hovered.x} y={hovered.y}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    marginBottom: 6,
                    borderBottom: '1px solid rgba(255,255,255,0.15)',
                    paddingBottom: 6,
                  }}
                >
                  Date: {fmtMY(hovStack.date)}
                </div>
                <div>Principal: <b>{fmt$(cumulativePrincipal)}</b></div>
                <div>Interest: <b>{fmt$(cumulativeInterest)}</b></div>
                <div>Fees: <b>{cumulativeFees === 0 ? '-$0.00' : `-${fmt$(cumulativeFees)}`}</b></div>
                <div>Cumulative Net: <b>{fmt$(cumulativeNet)}</b></div>
              </Tooltip>
            )
          }

          const breakdown = tooltipBreakdownByTs?.get(hovStack.ts)
          if (breakdown) {
            return (
              <Tooltip x={hovered.x} y={hovered.y}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    marginBottom: 6,
                    borderBottom: '1px solid rgba(255,255,255,0.15)',
                    paddingBottom: 6,
                  }}
                >
                  Date: {fmtMY(hovStack.date)}
                </div>
                <div>Principal: <b>{fmt$(breakdown.principal)}</b></div>
                <div>Interest: <b>{fmt$(breakdown.interest)}</b></div>
                <div>Fees: <b>{breakdown.fees === 0 ? '-$0.00' : `-${fmt$(breakdown.fees)}`}</b></div>
                <div>Cumulative Net: <b>{fmt$(breakdown.net)}</b></div>
              </Tooltip>
            )
          }

          const visibleBars = hovStack.bars.filter((b) => b.val !== 0)
          const monthNet = activeSeries.reduce((x, s) => x + (s.data.get(hovStack.ts) ?? 0), 0)

          return (
            <Tooltip x={hovered.x} y={hovered.y}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 4,
                  borderBottom: '1px solid rgba(255,255,255,0.15)',
                  paddingBottom: 6,
                }}
              >
                {fmtMY(hovStack.date)}
              </div>

              <div
                style={{
                  marginBottom: 6,
                  borderBottom: '1px solid rgba(255,255,255,0.12)',
                  paddingBottom: 6,
                }}
              >
                <div>Month Net: <b>{fmt$(monthNet)}</b></div>
                <div>Cumulative: <b>{fmt$(cumulativeNet)}</b></div>
              </div>

              {!compact &&
                visibleBars
                  .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
                  .map((bar) => {
                    const s = series.find((ss) => ss.loanId === bar.loanId)
                    const dispVal = s?.data.get(hovStack.ts) ?? bar.val
                    return (
                      <div key={bar.loanId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            background: bar.color,
                            borderRadius: 2,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: '#94a3b8', fontSize: 11, flex: 1 }}>{s?.name}</span>
                        <span style={{ fontWeight: 600 }}>{fmt$(dispVal)}</span>
                      </div>
                    )
                  })}
            </Tooltip>
          )
        })()}
    </div>
  )
}

function LineChart({
  data,
  height = 260,
  color = '#0ea5e9',
  showTodayLine = true,
}: {
  data: { date: Date; y: number; cumNet?: number }[]
  height?: number
  color?: string
  showTodayLine?: boolean
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })

  const PAD = { top: 20, right: 16, bottom: 36, left: 80 }
  const W = 860
  const H = height
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const vals = data.map((d) => d.y)
  const minV = Math.min(...vals, 0)
  const maxV = Math.max(...vals, 1)
  const range = maxV - minV || 1
  const xS = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * cW
  const yS = (v: number) => PAD.top + cH - ((v - minV) / range) * cH
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    v: minV + f * range,
    y: yS(minV + f * range),
  }))
  const xStep = Math.max(1, Math.round(data.length / 7))
  const xTicks = data.map((d, i) => ({ d, i })).filter(({ i }) => i % xStep === 0)
  const todayIdx = data.findIndex(
    (d) =>
      d.date.getFullYear() === CURRENT_MONTH.getFullYear() &&
      d.date.getMonth() === CURRENT_MONTH.getMonth()
  )
  const pathD = data
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xS(i).toFixed(1)} ${yS(pt.y).toFixed(1)}`)
    .join(' ')

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height }}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const svgX = ((e.clientX - rect.left) / rect.width) * W
          const idx = Math.max(
            0,
            Math.min(
              data.length - 1,
              Math.round(((svgX - PAD.left) / cW) * (data.length - 1))
            )
          )
          setHovered(idx)
          setMouse({ x: e.clientX, y: e.clientY })
        }}
      >
        {yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="#e2e8f0"
              strokeWidth={0.5}
            />
            <text x={PAD.left - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
              {t.v >= 1000 ? `$${(t.v / 1000).toFixed(0)}k` : `$${t.v.toFixed(0)}`}
            </text>
          </g>
        ))}
        <path
          d={`${pathD} L ${xS(data.length - 1)} ${yS(minV)} L ${xS(0)} ${yS(minV)} Z`}
          fill={color}
          opacity={0.08}
        />
        <path d={pathD} fill="none" stroke={color} strokeWidth={2.2} />
        {showTodayLine && todayIdx >= 0 && (
          <line
            x1={xS(todayIdx)}
            x2={xS(todayIdx)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />
        )}
        {hovered !== null && (
          <circle
            cx={xS(hovered)}
            cy={yS(data[hovered].y)}
            r={5}
            fill={color}
            stroke="#fff"
            strokeWidth={2}
          />
        )}
        {xTicks.map(({ d, i }) => (
          <text key={i} x={xS(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {fmtMY(d.date)}
          </text>
        ))}
      </svg>
      {hovered !== null && (
        <Tooltip x={mouse.x} y={mouse.y}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 6,
              borderBottom: '1px solid rgba(255,255,255,0.15)',
              paddingBottom: 6,
            }}
          >
            {fmtMY(data[hovered].date)}
          </div>
          <div>Avg / Month: <b>{fmt$(data[hovered].y)}</b></div>
          {data[hovered].cumNet != null && (
            <div>Net to Date: <b>{fmt$(data[hovered].cumNet!)}</b></div>
          )}
        </Tooltip>
      )}
    </div>
  )
}

function StatBar({
  items,
}: {
  items: { label: string; value: string; flex?: number }[]
}) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            flex: item.flex ?? 1,
            background: '#f8fafc',
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: '#94a3b8',
              marginBottom: 4,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: item.flex != null && item.flex < 1 ? 16 : 22,
              fontWeight: 800,
              color: '#0f172a',
            }}
          >
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function ChartBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg,#fff,#fcfeff)',
        borderRadius: 8,
        border: '1px solid rgba(15,23,42,0.06)',
        boxShadow: '0 6px 18px rgba(15,23,42,0.06)',
        padding: 8,
      }}
    >
      {children}
    </div>
  )
}

function LoanEarningsDrawerBody({ loan }: { loan: any }) {
  const sched = getLoanEarningsSchedule(loan)
  const netToDate = loanNetToDate(loan)
  const feesToDate = loanFeesToDate(loan)

  const chartDates = useMemo(() => {
    const seen = new Set<number>()
    const out: Date[] = []
    sched.forEach((r: any) => {
      if (!(r.loanDate instanceof Date)) return
      const t = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
      if (!seen.has(t)) {
        seen.add(t)
        out.push(new Date(t))
      }
    })
    return out.sort((a, b) => a.getTime() - b.getTime())
  }, [sched])

  const principalSeries: BarSeries = useMemo(() => {
    let running = 0
    const data = new Map<number, number>()

    chartDates.forEach((d) => {
      const ts = d.getTime()
      const row = sched.find(
        (r: any) =>
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === d.getFullYear() &&
          r.loanDate.getMonth() === d.getMonth()
      )
      running += row ? getRowMonthlyPrincipal(row) : 0
      data.set(ts, running)
    })

    return { loanId: 'principal', name: 'Principal', color: '#0ea5e9', data }
  }, [sched, chartDates])

  const interestSeries: BarSeries = useMemo(() => {
    let running = 0
    const data = new Map<number, number>()

    chartDates.forEach((d) => {
      const ts = d.getTime()
      const row = sched.find(
        (r: any) =>
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === d.getFullYear() &&
          r.loanDate.getMonth() === d.getMonth()
      )
      running += row ? getRowMonthlyInterest(row) : 0
      data.set(ts, running)
    })

    return { loanId: 'interest', name: 'Interest', color: '#22c55e', data }
  }, [sched, chartDates])

  const feesSeries: BarSeries = useMemo(() => {
    let running = 0
    const data = new Map<number, number>()

    chartDates.forEach((d) => {
      const ts = d.getTime()
      const row = sched.find(
        (r: any) =>
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === d.getFullYear() &&
          r.loanDate.getMonth() === d.getMonth()
      )
      running += row ? getRowMonthlyFees(row) : 0
      data.set(ts, -running)
    })

    return { loanId: 'fees', name: 'Fees', color: '#ef4444', data }
  }, [sched, chartDates])

  return (
    <>
      <ChartBox>
        <StackedBarChart
          series={[principalSeries, interestSeries, feesSeries]}
          dates={chartDates}
          height={240}
          showTodayLine
          visibleIds={new Set(['principal', 'interest', 'fees'])}
          tooltipMode="loan-breakdown"
        />
      </ChartBox>

      <StatBar
        items={[
          { label: 'Net Earnings to Date', value: fmt$(netToDate), flex: 2 },
          { label: 'Fees to Date', value: fmt$(feesToDate), flex: 1 },
        ]}
      />

      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>
          Earnings Breakdown by Month
        </div>
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            maxHeight: '45vh',
            overflow: 'auto',
            background: '#fff',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={drawerThStyle}>Date</th>
                <th style={drawerThR}>Principal</th>
                <th style={drawerThR}>Interest</th>
                <th style={drawerThR}>Fees</th>
                <th style={drawerThR}>Net Earnings</th>
              </tr>
            </thead>
            <tbody>
              {sched.map((r: any, i: number) => {
                const principal = getRowMonthlyPrincipal(r)
                const interest = getRowMonthlyInterest(r)
                const fee = getRowMonthlyFees(r)
                const net = getRowMonthlyNet(r)
                const isCurrent =
                  r.loanDate instanceof Date &&
                  r.loanDate.getFullYear() === CURRENT_MONTH.getFullYear() &&
                  r.loanDate.getMonth() === CURRENT_MONTH.getMonth()
                const isDeferral = r.isDeferralMonth ?? r.isDeferred ?? false
                const isPrepay = (r.prepaymentPrincipal ?? r.prepayment ?? 0) > 0
                const isTerminal = r.isTerminal ?? false
                const rowBg = isPrepay
                  ? 'rgba(22,163,74,0.12)'
                  : isTerminal
                    ? 'rgba(220,38,38,0.10)'
                    : isDeferral
                      ? 'rgba(234,179,8,0.13)'
                      : i % 2 === 1
                        ? 'rgba(15,23,42,0.015)'
                        : 'transparent'

                return (
                  <tr key={i} style={{ background: isCurrent ? 'rgba(14,165,233,0.08)' : rowBg }}>
                    <td
                      style={{
                        padding: '7px 10px',
                        color: isCurrent ? '#0ea5e9' : '#0f172a',
                        fontWeight: isCurrent ? 700 : 400,
                      }}
                    >
                      {r.loanDate instanceof Date ? fmtMY(r.loanDate) : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>
                      {fmt$(principal)}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>
                      {fmt$(interest)}
                    </td>
                    <td
                      style={{
                        padding: '7px 10px',
                        textAlign: 'right',
                        color: fee > 0 ? '#dc2626' : '#64748b',
                      }}
                    >
                      {fee !== 0 ? `-${fmt$(fee)}` : '-$0.00'}
                    </td>
                    <td
                      style={{
                        padding: '7px 10px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: net >= 0 ? '#16a34a' : '#dc2626',
                      }}
                    >
                      {fmt$(net)}
                    </td>
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

function KpiEarningsDrawerBody({
  kpi,
  loansWithRoi,
}: {
  kpi: EarningsKpiKey
  loansWithRoi: any[]
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(
    () => new Set(loansWithRoi.map((l: any) => String(l.loanId ?? l.id ?? '')))
  )

  const toggleId = useCallback((id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allDates = useMemo(() => allOwnedMonths(loansWithRoi), [loansWithRoi])
  const historicDates = useMemo(() => ownedMonthsToDate(loansWithRoi), [loansWithRoi])

  const series: BarSeries[] = useMemo(
    () =>
      loansWithRoi.map((loan: any) => {
        const id = String(loan.loanId ?? loan.id ?? '')
        const data = new Map<number, number>()
        getLoanEarningsSchedule(loan).forEach((r: any) => {
          if (!(r.loanDate instanceof Date)) return
          const ts = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
          data.set(ts, getRowMonthlyNet(r))
        })
        return {
          loanId: id,
          name: loan.loanName ?? loan.name ?? id,
          color: loan.loanColor ?? loan.color ?? '#64748b',
          data,
        }
      }),
    [loansWithRoi]
  )

  const cumulativeBreakdownByTs = useMemo(() => {
    const sourceDates = kpi === 'kpi1' ? historicDates : allDates
    let runningPrincipal = 0
    let runningInterest = 0
    let runningFees = 0

    const out = new Map<
      number,
      { principal: number; interest: number; fees: number; net: number }
    >()

    sourceDates.forEach((d) => {
      const ts = d.getTime()

      let monthPrincipal = 0
      let monthInterest = 0
      let monthFees = 0

      loansWithRoi.forEach((loan: any) => {
        getLoanEarningsSchedule(loan).forEach((r: any) => {
          if (!(r.loanDate instanceof Date)) return
          if (
            r.loanDate.getFullYear() === d.getFullYear() &&
            r.loanDate.getMonth() === d.getMonth()
          ) {
            monthPrincipal += getRowMonthlyPrincipal(r)
            monthInterest += getRowMonthlyInterest(r)
            monthFees += getRowMonthlyFees(r)
          }
        })
      })

      runningPrincipal += monthPrincipal
      runningInterest += monthInterest
      runningFees += monthFees

      out.set(ts, {
        principal: runningPrincipal,
        interest: runningInterest,
        fees: runningFees,
        net: runningPrincipal + runningInterest - runningFees,
      })
    })

    return out
  }, [loansWithRoi, historicDates, allDates, kpi])

  const loanTotals = useMemo(
    () =>
      loansWithRoi.map((loan: any) => {
        const id = String(loan.loanId ?? loan.id ?? '')
        const sched = getLoanEarningsSchedule(loan)
        const toDate = sched.filter(
          (r: any) => r.loanDate instanceof Date && r.loanDate <= CURRENT_MONTH
        )
        const allRows = sched
        const netToDate = toDate.reduce((s: number, r: any) => s + getRowMonthlyNet(r), 0)
        const projNet = allRows.reduce((s: number, r: any) => s + getRowMonthlyNet(r), 0)
        const principal = toDate.reduce(
          (s: number, r: any) => s + getRowMonthlyPrincipal(r),
          0
        )
        const interest = toDate.reduce(
          (s: number, r: any) => s + getRowMonthlyInterest(r),
          0
        )
        const fees = toDate.reduce((s: number, r: any) => s + getRowMonthlyFees(r), 0)
        const projPrincipal = allRows.reduce(
          (s: number, r: any) => s + getRowMonthlyPrincipal(r),
          0
        )
        const projInterest = allRows.reduce(
          (s: number, r: any) => s + getRowMonthlyInterest(r),
          0
        )
        const projFees = allRows.reduce(
          (s: number, r: any) => s + getRowMonthlyFees(r),
          0
        )
        const monthsToDate = toDate.length
        const totalMonths = allRows.length
        const avgToDate = monthsToDate > 0 ? netToDate / monthsToDate : 0
        const avgProj = totalMonths > 0 ? projNet / totalMonths : 0
        const lastRow = sched.length > 0 ? sched[sched.length - 1] : null
        const matDate: Date | null = lastRow?.loanDate instanceof Date ? lastRow.loanDate : null
        const purchaseDate = loan.purchaseDate
          ? (() => {
              try {
                return new Date(loan.purchaseDate)
              } catch {
                return null
              }
            })()
          : null
        const purchasePrice = Number(loan.purchasePrice ?? loan.userPurchasePrice ?? 0)

        return {
          id,
          loan,
          netToDate,
          projNet,
          principal,
          interest,
          fees,
          projPrincipal,
          projInterest,
          projFees,
          monthsToDate,
          totalMonths,
          avgToDate,
          avgProj,
          matDate,
          purchaseDate,
          purchasePrice,
        }
      }),
    [loansWithRoi]
  )

  const totalNetToDate = loanTotals.reduce((s, t) => s + t.netToDate, 0)
  const totalProjNet = loanTotals.reduce((s, t) => s + t.projNet, 0)
  const totalFeesToDate = loanTotals.reduce((s, t) => s + t.fees, 0)
  const totalProjFees = loanTotals.reduce((s, t) => s + t.projFees, 0)
  const avgMonthlyToDate = historicDates.length > 0 ? totalNetToDate / historicDates.length : 0
  const avgMonthlyProj = allDates.length > 0 ? totalProjNet / allDates.length : 0

  const avgToDateLine = useMemo(() => {
    let cumNet = 0
    return historicDates.map((d, idx) => {
      const ts = d.getTime()
      series.forEach((s) => {
        cumNet += s.data.get(ts) ?? 0
      })
      return { date: d, y: cumNet / (idx + 1), cumNet }
    })
  }, [series, historicDates])

  const avgProjLine = useMemo(() => {
    let cumNet = 0
    return allDates.map((d, idx) => {
      const ts = d.getTime()
      series.forEach((s) => {
        cumNet += s.data.get(ts) ?? 0
      })
      return { date: d, y: cumNet / (idx + 1), cumNet }
    })
  }, [series, allDates])

  function ToggleCell({ t }: { t: (typeof loanTotals)[0] }) {
    const color = t.loan.loanColor ?? t.loan.color ?? '#64748b'
    const isOn = visibleIds.has(t.id)
    const isFoc = focusedId === t.id
    return (
      <td style={{ padding: '9px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleId(t.id)
            }}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              flexShrink: 0,
              background: isOn ? color : '#e2e8f0',
              border: isFoc ? `2px solid ${color}` : '2px solid transparent',
              cursor: 'pointer',
              padding: 0,
              transition: 'background 0.15s',
            }}
            title={isOn ? 'Hide from chart' : 'Show on chart'}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: isOn ? color : '#94a3b8' }}>
              {t.loan.loanName ?? t.loan.name}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.loan.school}</div>
          </div>
        </div>
      </td>
    )
  }

  function FocusRow({
    t,
    children,
  }: {
    t: (typeof loanTotals)[0]
    children: React.ReactNode
  }) {
    const isFoc = focusedId === t.id
    const isDim = focusedId != null && !isFoc
    return (
      <tr
        style={{
          borderBottom: '1px solid #f1f5f9',
          background: isFoc ? 'rgba(148,163,184,0.08)' : 'transparent',
          opacity: isDim ? 0.3 : 1,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={() => setFocusedId(t.id)}
        onMouseLeave={() => setFocusedId(null)}
      >
        {children}
      </tr>
    )
  }

  const cfgs = {
    kpi1: {
      stat: [
        { label: 'Net Earnings to Date', value: fmt$(totalNetToDate), flex: 2 },
        { label: 'Total Fees to Date', value: fmt$(totalFeesToDate), flex: 1 },
      ],
      chart: (
        <StackedBarChart
          series={series}
          dates={historicDates}
          height={260}
          cumulative
          visibleIds={visibleIds}
          focusedId={focusedId}
          showTodayLine
          compact
          tooltipBreakdownByTs={cumulativeBreakdownByTs}
        />
      ),
      title: 'Total Net Earnings to Date',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
              <th style={drawerThR}>Net Earnings</th>
              <th style={drawerThR}>Principal</th>
              <th style={drawerThR}>Interest</th>
              <th style={drawerThR}>Fees</th>
            </tr>
          </thead>
          <tbody>
            {loanTotals.map((t) => (
              <FocusRow key={t.id} t={t}>
                <ToggleCell t={t} />
                <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                  {fmt$(t.netToDate)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>
                  {fmt$(t.principal)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>
                  {fmt$(t.interest)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: t.fees > 0 ? '#dc2626' : '#94a3b8' }}>
                  {t.fees > 0 ? `-${fmt$(t.fees)}` : '-$0.00'}
                </td>
              </FocusRow>
            ))}
          </tbody>
        </table>
      ),
    },
    kpi2: {
      stat: [
        { label: 'Projected Net Earnings', value: fmt$(totalProjNet), flex: 2 },
        { label: 'Projected Total Fees', value: fmt$(totalProjFees), flex: 1 },
      ],
      chart: (
        <StackedBarChart
          series={series}
          dates={allDates}
          height={260}
          cumulative
          visibleIds={visibleIds}
          focusedId={focusedId}
          showTodayLine
          compact
          tooltipBreakdownByTs={cumulativeBreakdownByTs}
        />
      ),
      title: 'Projected Total Net Earnings',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
              <th style={drawerThR}>Projected Net</th>
              <th style={drawerThR}>Principal</th>
              <th style={drawerThR}>Interest</th>
              <th style={drawerThR}>Fees</th>
            </tr>
          </thead>
          <tbody>
            {loanTotals.map((t) => (
              <FocusRow key={t.id} t={t}>
                <ToggleCell t={t} />
                <td
                  style={{
                    padding: '9px 10px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: t.loan.loanColor ?? t.loan.color ?? '#0f172a',
                  }}
                >
                  {fmt$(t.projNet)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>
                  {fmt$(t.projPrincipal)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>
                  {fmt$(t.projInterest)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: t.projFees > 0 ? '#dc2626' : '#94a3b8' }}>
                  {t.projFees > 0 ? `-${fmt$(t.projFees)}` : '-$0.00'}
                </td>
              </FocusRow>
            ))}
          </tbody>
        </table>
      ),
    },
    kpi3: {
      stat: [
        { label: 'Avg Monthly Earnings to Date', value: fmt$(avgMonthlyToDate), flex: 2 },
        { label: 'Months Counted', value: String(historicDates.length), flex: 1 },
      ],
      chart: <LineChart data={avgToDateLine} height={260} color="#0ea5e9" showTodayLine />,
      title: 'Avg Monthly Earnings to Date',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
              <th style={drawerThR}>Avg Monthly Earnings to Date</th>
              <th style={drawerThR}>Purchase Date</th>
              <th style={drawerThR}>Maturity Date</th>
            </tr>
          </thead>
          <tbody>
            {loanTotals.map((t) => (
              <FocusRow key={t.id} t={t}>
                <td style={{ padding: '9px 10px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.loan.loanName ?? t.loan.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.loan.school}</div>
                  </div>
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>
                  {fmt$(t.avgToDate)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                  {t.purchaseDate ? fmtDate(t.purchaseDate) : '—'}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                  {t.matDate ? fmtMY(t.matDate) : '—'}
                </td>
              </FocusRow>
            ))}
          </tbody>
        </table>
      ),
    },
    kpi4: {
      stat: [
        { label: 'Avg / Month (Projected)', value: fmt$(avgMonthlyProj), flex: 2 },
        { label: 'Months Through Maturity', value: String(allDates.length), flex: 1 },
      ],
      chart: <LineChart data={avgProjLine} height={260} color="#0ea5e9" showTodayLine />,
      title: 'Projected Avg Monthly Earnings',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
              <th style={drawerThR}>Proj Avg Monthly</th>
              <th style={drawerThR}>Projected Net</th>
              <th style={drawerThR}>Purchase Price</th>
              <th style={drawerThR}>Maturity Date</th>
            </tr>
          </thead>
          <tbody>
            {loanTotals.map((t) => (
              <FocusRow key={t.id} t={t}>
                <td style={{ padding: '9px 10px' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.loan.loanName ?? t.loan.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.loan.school}</div>
                  </div>
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>
                  {fmt$(t.avgProj)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>
                  {fmt$(t.projNet)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>
                  {fmt$(t.purchasePrice)}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>
                  {t.matDate ? fmtMY(t.matDate) : '—'}
                </td>
              </FocusRow>
            ))}
          </tbody>
        </table>
      ),
    },
  } as const

  const cfg = cfgs[kpi]

  return (
    <>
      <ChartBox>{cfg.chart}</ChartBox>
      <StatBar items={cfg.stat as any} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>
          {cfg.title}
        </div>
        <div
          style={{
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            maxHeight: '45vh',
            overflow: 'auto',
            background: '#fff',
          }}
        >
          {cfg.table}
        </div>
      </div>
    </>
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
      title={title}
      onClick={onClick}
      data-drawer-open="true"
      style={{
        width: 34,
        height: 30,
        borderRadius: 8,
        border: `1px solid ${active ? '#0ea5e9' : 'var(--border, #e2e8f0)'}`,
        background: active ? 'rgba(14,165,233,0.08)' : 'var(--card, #fff)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 4,
        padding: 6,
        cursor: 'pointer',
      }}
      aria-pressed={active}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          style={{
            display: 'block',
            width: '100%',
            height: 2,
            borderRadius: 2,
            background: active ? '#0ea5e9' : '#64748b',
          }}
        />
      ))}
    </button>
  )
}

function TileEventBadge({
  loan,
  type,
  onShow,
  onMove,
  onHide,
}: {
  loan: any
  type: string
  onShow: (e: React.MouseEvent, lines: string[]) => void
  onMove: (e: React.MouseEvent) => void
  onHide: () => void
}) {
  const label =
    type === 'prepayment'
      ? '💰 Prepay'
      : type === 'deferral'
        ? '⏸ Deferral'
        : '⚠️ Default'

  const styleMap: Record<string, React.CSSProperties> = {
    prepayment: {
      background: 'rgba(34, 197, 94, 0.18)',
      color: '#166534',
      borderColor: 'rgba(34, 197, 94, 0.35)',
    },
    deferral: {
      background: 'rgba(234, 179, 8, 0.18)',
      color: '#92400e',
      borderColor: 'rgba(234, 179, 8, 0.35)',
    },
    default: {
      background: 'rgba(239, 68, 68, 0.15)',
      color: '#b91c1c',
      borderColor: 'rgba(239, 68, 68, 0.35)',
    },
  }

  return (
    <span
      onMouseEnter={(e) => onShow(e, getEventTooltipLines(loan, type))}
      onMouseMove={onMove}
      onMouseLeave={onHide}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 999,
        border: '1px solid',
        cursor: 'default',
        whiteSpace: 'nowrap',
        ...styleMap[type],
      }}
    >
      {label}
    </span>
  )
}

function TileOwnershipBadge({ loan }: { loan: any }) {
  const pct = getOwnershipPct01(loan)

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      <OwnershipPie userPct={pct} marketPct={0} color={getLoanColor(loan)} size={26} />
    </div>
  )
}

function EarningsMiniChart({
  loan,
  onShow,
  onMove,
  onHide,
}: {
  loan: any
  onShow: (e: React.MouseEvent, lines: string[]) => void
  onMove: (e: React.MouseEvent) => void
  onHide: () => void
}) {
  const [lens, setLens] = useState<{ x: number; y: number; idx: number } | null>(null)

  const data = useMemo(
    () =>
      getLoanEarningsSchedule(loan).filter(
        (r: any) => r.loanDate instanceof Date || r.ownershipDate instanceof Date
      ),
    [loan]
  )

  const W = 170
  const H = 48
  const padL = 4
  const padR = 4
  const padT = 4
  const padB = 4

  if (!data.length) {
    return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 170, height: 48, display: 'block' }} />
  }

  let maxAbs = 0
  data.forEach((d: any) => {
    const pos = Number(d.cumPrincipal ?? 0) + Number(d.cumInterest ?? 0)
    const neg = -Number(d.cumFees ?? 0)
    maxAbs = Math.max(maxAbs, pos, Math.abs(neg))
  })
  if (maxAbs <= 0) maxAbs = 1

  const yZero = H / 2
  const halfHeight = (H - padT - padB) / 2
  const scale = halfHeight / maxAbs
  const count = data.length
  const barW = (W - padL - padR) / Math.max(1, count)

  const currentIdx = (() => {
    const idx = data.findIndex((d: any) => {
      const dt = d.loanDate instanceof Date ? d.loanDate : d.ownershipDate
      return (
        dt instanceof Date &&
        dt.getFullYear() === TODAY.getFullYear() &&
        dt.getMonth() === TODAY.getMonth()
      )
    })
    if (idx === -1) return Math.max(0, data.length - 1)
    return idx
  })()

  const ratio = data.length > 1 ? currentIdx / (data.length - 1) : 0
  const currentX = padL + ratio * (W - padL - padR)

  return (
    <>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: 170, height: 48, display: 'block', overflow: 'visible' }}
    >
      <line
        x1={padL}
        x2={W - padR}
        y1={yZero}
        y2={yZero}
        stroke="#cbd5e1"
        strokeWidth="0.8"
      />

      {data.map((d: any, i: number) => {
        const x = padL + i * barW
        const principal = Number(d.cumPrincipal ?? 0)
        const interest = Number(d.cumInterest ?? 0)
        const negFees = -Number(d.cumFees ?? 0)

        const hPrin = principal * scale
        const hInt = interest * scale
        const hFees = Math.abs(negFees) * scale

        const yInt = yZero - hInt
        const yPrin = yZero - hInt - hPrin
        const yFee = yZero
        const width = Math.max(1, barW - 2)

        const rowDate =
          d.loanDate instanceof Date
            ? d.loanDate
            : d.ownershipDate instanceof Date
              ? d.ownershipDate
              : null

        const lines = [
          `Date: ${rowDate ? fmtDate(rowDate) : '—'}`,
          `Principal: ${fmt$(Number(d.cumPrincipal ?? 0))}`,
          `Interest: ${fmt$(Number(d.cumInterest ?? 0))}`,
          `Fees: -${fmt$(Number(d.cumFees ?? 0))}`,
          `Net: ${fmt$(Number(d.netEarnings ?? 0))}`,
        ]

        return (
          <g key={i}>
            <rect x={x + 1} y={yPrin} width={width} height={hPrin} fill="#0ea5e9" />
            <rect x={x + 1} y={yInt} width={width} height={hInt} fill="#22c55e" />
            <rect x={x + 1} y={yFee} width={width} height={hFees} fill="#ef4444" />
            <rect
              x={x}
              y={0}
              width={Math.max(width + 2, 8)}
              height={H}
              fill="transparent"
              onMouseEnter={(e) => {
                onShow(e, lines)
                setLens({ x: e.clientX, y: e.clientY, idx: i })
              }}
              onMouseMove={(e) => {
                onMove(e)
                setLens({ x: e.clientX, y: e.clientY, idx: i })
              }}
              onMouseLeave={() => {
                onHide()
                setLens(null)
              }}
            />
          </g>
        )
      })}

      <line
        x1={currentX}
        x2={currentX}
        y1={0}
        y2={H}
        stroke="#64748b"
        strokeDasharray="4,3"
        strokeWidth="1"
      />

      {/* Sparkline lens — inside SVG */}
      {lens && lens.idx >= 0 && lens.idx < data.length && (() => {
        const sparkStacks = data.map((d: any, i: number) => ({
          idx: i,
          posTotal: Number(d.cumPrincipal ?? 0) + Number(d.cumInterest ?? 0),
          negTotal: -Number(d.cumFees ?? 0),
          bars: [
            { loanId: 'principal', color: '#0ea5e9', val: Number(d.cumPrincipal ?? 0), bottom: 0, top: Number(d.cumPrincipal ?? 0) },
            { loanId: 'interest',  color: '#22c55e', val: Number(d.cumInterest ?? 0),  bottom: 0, top: Number(d.cumInterest ?? 0) },
            { loanId: 'fees',      color: '#ef4444', val: -Number(d.cumFees ?? 0),     bottom: -Number(d.cumFees ?? 0), top: 0 },
          ],
        }))
        const sparkXS = (i: number) => padL + i * barW + barW / 2
        const sparkYS = (v: number) => yZero - v * scale
        return (
          <ChartLensOverlay
            cursorX={padL + lens.idx * barW + barW / 2}
            cursorY={yZero}
            stacks={sparkStacks}
            hovIdx={lens.idx}
            xS={sparkXS}
            yS={sparkYS}
            zeroY={yZero}
            r={22}
            zoom={3.5}
          />
        )
      })()}
    </svg>
  </>
  )
}

function EarningsLoanTile({
  loan,
  compact,
  onOpen,
  onShow,
  onMove,
  onHide,
}: {
  loan: any
  compact?: boolean
  onOpen: (loan: any) => void
  onShow: (e: React.MouseEvent, lines: string[]) => void
  onMove: (e: React.MouseEvent) => void
  onHide: () => void
}) {
  const sched = getLoanEarningsSchedule(loan)
  const lastIdx = sched.length ? sched.length - 1 : 0

  const fallbackRow = {
    netEarnings: 0,
    ownershipDate: new Date(loan.loanStartDate),
    loanDate: new Date(loan.loanStartDate),
  }

  const loanStart = loan.loanStartDate ? new Date(loan.loanStartDate) : new Date()
  const diffMonthsFromStartRaw =
    (TODAY.getFullYear() - loanStart.getFullYear()) * 12 +
    (TODAY.getMonth() - loanStart.getMonth())
  const diffMonthsFromStart = Number.isFinite(diffMonthsFromStartRaw)
    ? Math.max(1, diffMonthsFromStartRaw)
    : 1

  const currentIdx = Math.max(0, Math.min(diffMonthsFromStart - 1, lastIdx))
  const atCurrent = sched.length ? sched[currentIdx] || sched[lastIdx] : fallbackRow
  const currentMonthLabel = fmtMY(new Date())
  const eventTypes = getLoanEventTypes(loan)
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
        background: 'var(--card, #fff)',
        minHeight: compact ? 64 : 110,
        cursor: 'pointer',
        overflow: 'visible',
        border: '1px solid var(--border, #e2e8f0)',
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
        <div
          style={{
            fontWeight: 700,
            fontSize: compact ? 13 : 14,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {getLoanName(loan)}
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
          {eventTypes.map((type) => (
            <TileEventBadge
              key={type}
              loan={loan}
              type={type}
              onShow={onShow}
              onMove={onMove}
              onHide={onHide}
            />
          ))}
          <TileOwnershipBadge loan={loan} />
        </div>

        <div
          style={{
            fontWeight: 700,
            fontSize: compact ? 13 : 14,
            marginTop: 2,
            color: 'var(--text, #0f172a)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {loan.school || 'No school listed'}
        </div>

        {!compact && (
          <>
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: 'var(--muted, #64748b)',
              }}
            >
              Rate: {getNominalRatePct(loan).toFixed(2)}% · Term: {String(loan.termYears ?? 0)} yrs ·
              {' '}Matures: {maturity ? fmtMY(maturity) : '—'}
            </div>

            <div
              style={{
                marginTop: 4,
                fontSize: 12,
                color: 'var(--muted, #64748b)',
              }}
            >
              Loan {getLoanId(loan)}
            </div>
          </>
        )}
      </div>

      <div
        style={{
          width: compact ? 'auto' : 170,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          overflow: 'visible',
        }}
      >
        <div
          style={{
            fontSize: compact ? 13 : 12,
            color: 'var(--muted, #64748b)',
            marginBottom: compact ? 0 : 6,
            textAlign: 'right',
            width: '100%',
            fontWeight: compact ? 700 : 400,
          }}
        >
          Net Earnings {compact ? '' : currentMonthLabel + ': '}{fmt$(Number(atCurrent?.netEarnings ?? 0)).replace('.00', '')}
        </div>
        {!compact && (
          <EarningsMiniChart loan={loan} onShow={onShow} onMove={onMove} onHide={onHide} />
        )}
      </div>
    </div>
  )
}

export default function EarningsDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialKpi = (searchParams.get('kpi') as EarningsKpiKey) || null
  const initialLoanId = searchParams.get('loan') || null

  const [drawerOpen, setDrawerOpen] = useState(!!(initialKpi || initialLoanId))
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(
    initialLoanId
      ? { kind: 'loan', loanId: initialLoanId }
      : initialKpi
        ? { kind: 'kpi', kpi: initialKpi }
        : null
  )

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('earningsViewMode')
    return saved === 'compact' || saved === 'table' ? saved : 'full'
  })

  const [hoverTooltip, setHoverTooltip] = useState<{
    x: number
    y: number
    lines: string[]
  } | null>(null)

  const navigate = useNavigate()
  const { userId } = useUser()
  const { loansWithRoi, earningsKpis, loading, error } = usePortfolio(userId)

  const [filterName, setFilterName] = useState('')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterRate, setFilterRate] = useState('')
  const [sortKey, setSortKey] = useState('')

  useEffect(() => {
    localStorage.setItem('earningsViewMode', viewMode)
  }, [viewMode])

  const showHover = useCallback((e: React.MouseEvent, lines: string[]) => {
    setHoverTooltip({ x: e.clientX, y: e.clientY, lines })
  }, [])

  const moveHover = useCallback((e: React.MouseEvent) => {
    setHoverTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev))
  }, [])

  const hideHover = useCallback(() => setHoverTooltip(null), [])

  const loanNames = useMemo(
    () =>
      [...new Set(loansWithRoi.map((l: any) => l.loanName ?? l.name ?? ''))]
        .filter(Boolean)
        .sort(),
    [loansWithRoi]
  )

  const schools = useMemo(
    () =>
      [...new Set(loansWithRoi.map((l: any) => l.school ?? ''))]
        .filter(Boolean)
        .sort(),
    [loansWithRoi]
  )

  const filteredLoans = useMemo(() => {
    let rows = [...loansWithRoi]
    if (filterName) rows = rows.filter((l: any) => (l.loanName ?? l.name) === filterName)
    if (filterSchool) rows = rows.filter((l: any) => l.school === filterSchool)

    if (filterRate === 'low') {
      rows = rows.filter((l: any) => getNominalRatePct(l) < 5)
    }
    if (filterRate === 'mid') {
      rows = rows.filter((l: any) => {
        const rp = getNominalRatePct(l)
        return rp >= 5 && rp <= 8
      })
    }
    if (filterRate === 'high') {
      rows = rows.filter((l: any) => getNominalRatePct(l) > 8)
    }

    if (sortKey === 'purchase_asc') {
      rows.sort((a: any, b: any) => String(a.purchaseDate).localeCompare(String(b.purchaseDate)))
    }
    if (sortKey === 'purchase_desc') {
      rows.sort((a: any, b: any) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)))
    }
    if (sortKey === 'start_asc') {
      rows.sort((a: any, b: any) => String(a.loanStartDate).localeCompare(String(b.loanStartDate)))
    }
    if (sortKey === 'start_desc') {
      rows.sort((a: any, b: any) => String(b.loanStartDate).localeCompare(String(a.loanStartDate)))
    }
    if (sortKey === 'amount_asc') {
      rows.sort((a: any, b: any) => getOrigAmt(a) - getOrigAmt(b))
    }
    if (sortKey === 'amount_desc') {
      rows.sort((a: any, b: any) => getOrigAmt(b) - getOrigAmt(a))
    }
    if (sortKey === 'rate_asc') {
      rows.sort((a: any, b: any) => getNominalRatePct(a) - getNominalRatePct(b))
    }
    if (sortKey === 'rate_desc') {
      rows.sort((a: any, b: any) => getNominalRatePct(b) - getNominalRatePct(a))
    }
    if (sortKey === 'earnings_asc') {
      rows.sort((a: any, b: any) => loanNetToDate(a) - loanNetToDate(b))
    }
    if (sortKey === 'earnings_desc') {
      rows.sort((a: any, b: any) => loanNetToDate(b) - loanNetToDate(a))
    }

    return rows
  }, [loansWithRoi, filterName, filterSchool, filterRate, sortKey])

  function resetFilters() {
    setFilterName('')
    setFilterSchool('')
    setFilterRate('')
    setSortKey('')
  }

  function handleKpiClick(key: EarningsKpiKey) {
    setDrawerMode({ kind: 'kpi', kpi: key })
    setDrawerOpen(true)
    setSearchParams({ kpi: key })
  }

  function handleLoanRowClick(loan: any) {
    const loanId = String(loan.loanId ?? loan.id ?? '')
    setDrawerMode({ kind: 'loan', loanId })
    setDrawerOpen(true)
    setSearchParams({ loan: loanId })
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setDrawerMode(null)
    setSearchParams({})
  }

  const drawerTitle = (() => {
    if (!drawerMode) return ''
    if (drawerMode.kind === 'kpi') {
      return (
        {
          kpi1: 'Total Net Earnings to Date',
          kpi2: 'Projected Total Net Earnings',
          kpi3: 'Avg Monthly Earnings to Date',
          kpi4: 'Projected Avg Monthly Earnings',
        } as Record<EarningsKpiKey, string>
      )[drawerMode.kpi]
    }

    const loan = loansWithRoi.find((l: any) => String(l.loanId ?? l.id) === drawerMode.loanId)
    const pct = loan ? Math.round(getOwnershipPct(loan) * 100) : null
    return loan
      ? `${loan.loanName ?? loan.name ?? drawerMode.loanId}${pct != null && pct !== 100 ? ` (${pct}% owned)` : ''}`
      : drawerMode.loanId
  })()

  const drawerSubTitle = (() => {
    if (!drawerMode) return undefined
    if (drawerMode.kind === 'kpi') {
      return (
        {
          kpi1: 'Portfolio-level earnings across all loans.',
          kpi2: 'Projected lifetime earnings across all loans, assuming full term.',
          kpi3: 'Total net earnings divided by months since the first month with earnings data.',
          kpi4: 'Average net earnings per month (historical → projected) across the full lifetime of the portfolio.',
        } as Record<EarningsKpiKey, string>
      )[drawerMode.kpi]
    }

    const loan = loansWithRoi.find((l: any) => String(l.loanId ?? l.id) === drawerMode.loanId)
    if (!loan) return undefined

    const origAmt = getOrigAmt(loan)
    const sched = getLoanEarningsSchedule(loan)
    const lastRow = sched.length > 0 ? sched[sched.length - 1] : null
    const matDate = lastRow?.loanDate instanceof Date ? `Matures ${fmtMY(lastRow.loanDate)}` : ''
    return `${loan.school ?? ''}\nPurchased ${loan.purchaseDate} · ${matDate} · Orig Loan Amt ${fmt$(origAmt)}`
  })()

  const activeLoan =
    drawerMode?.kind === 'loan'
      ? loansWithRoi.find((l: any) => String(l.loanId ?? l.id) === drawerMode.loanId)
      : null

  const loansForTable = useMemo(
    () =>
      filteredLoans.map((l: any) => ({
        ...l,
        _earningsToDate: loanNetToDate(l),
      })),
    [filteredLoans]
  )

  const kpis: { key: EarningsKpiKey; label: string; value: string }[] = [
    { key: 'kpi1', label: 'Net Earnings to Date', value: fmt$(earningsKpis?.netEarningsToDate ?? 0) },
    { key: 'kpi2', label: 'Projected Lifetime Earnings', value: fmt$(earningsKpis?.projectedLifetimeEarnings ?? 0) },
    { key: 'kpi3', label: 'Avg Monthly Earnings to Date', value: fmt$(earningsKpis?.avgMonthlyEarningsToDate ?? 0) },
    { key: 'kpi4', label: 'Projected Avg Monthly', value: fmt$(earningsKpis?.projectedAvgMonthlyEarnings ?? 0) },
  ]

  const tooltipPortal =
    hoverTooltip && typeof document !== 'undefined'
      ? createPortal(
          <Tooltip x={hoverTooltip.x} y={hoverTooltip.y}>
            {hoverTooltip.lines.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </Tooltip>,
          document.body
        )
      : null

  if (loading) {
    return (
      <AppShell>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '60vh',
            color: '#64748b',
            fontSize: 15,
          }}
        >
          Loading portfolio…
        </div>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '60vh',
            color: '#ef4444',
            fontSize: 15,
          }}
        >
          Error: {error}
        </div>
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
            >
              ← Back to My Holdings
            </button>

            <h1 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>
              Loan Portfolio — Earnings
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
              Cumulative principal, interest, and fees for each loan and for the portfolio.
            </p>
            <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#64748b' }}>
              Current Date: {fmtMY(new Date())}
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 10,
              padding: '0 20px 14px',
              flexShrink: 0,
            }}
          >
            {kpis.map((k) => (
              <div
                key={k.key}
                data-drawer-open="true"
                onClick={() => handleKpiClick(k.key)}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
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
            <select value={filterName} onChange={(e) => setFilterName(e.target.value)} style={filterSelectStyle}>
              <option value="">Name</option>
              {loanNames.map((n: string) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>

            <select value={filterSchool} onChange={(e) => setFilterSchool(e.target.value)} style={filterSelectStyle}>
              <option value="">School</option>
              {schools.map((s: string) => (
                <option key={s} value={s}>
                  {s}
                </option>
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
              <option value="start_asc">Loan Start Date ↑</option>
              <option value="start_desc">Loan Start Date ↓</option>
              <option value="amount_asc">Orig Amount ↑</option>
              <option value="amount_desc">Orig Amount ↓</option>
              <option value="rate_asc">Interest Rate ↑</option>
              <option value="rate_desc">Interest Rate ↓</option>
              <option value="earnings_asc">Earnings ↑</option>
              <option value="earnings_desc">Earnings ↓</option>
            </select>

            <button onClick={resetFilters} style={filterSelectStyle}>
              Reset
            </button>

            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
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

              <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>
                {filteredLoans.length} loan{filteredLoans.length !== 1 ? 's' : ''}
              </span>

              <button style={filterBtnStyle}>Download CSV</button>
              <button style={filterBtnStyle}>Copy CSV</button>
              <button style={filterBtnStyle} onClick={() => window.print()}>
                Print
              </button>
            </div>
          </div>

          <div style={{ flex: 1, padding: '0 20px 20px', overflow: 'hidden', minHeight: 0 }}>
            {viewMode === 'table' ? (
              <LoanTable loans={loansForTable} onRowClick={handleLoanRowClick} lastColumnMode="earnings" />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gridAutoRows: 'min-content',
                  gap: 12,
                  height: '100%',
                  overflow: 'auto',
                  paddingRight: 6,
                }}
              >
                {filteredLoans.map((loan: any) => (
                  <EarningsLoanTile
                    key={getLoanId(loan)}
                    loan={loan}
                    compact={viewMode === 'compact'}
                    onOpen={handleLoanRowClick}
                    onShow={showHover}
                    onMove={moveHover}
                    onHide={hideHover}
                  />
                ))}
              </div>
            )}
          </div>

          <SharedKpiDrawer
            open={drawerOpen && drawerMode?.kind === 'kpi'}
            kpi={drawerMode?.kind === 'kpi' ? drawerMode.kpi : null}
            onClose={closeDrawer}
            title={drawerTitle}
            subTitle={drawerSubTitle}
          >
            {drawerMode?.kind === 'kpi' && (
              <KpiEarningsDrawerBody kpi={drawerMode.kpi} loansWithRoi={loansWithRoi} />
            )}
          </SharedKpiDrawer>

          <SharedLoanDrawer
            loan={activeLoan}
            open={drawerOpen && drawerMode?.kind === 'loan'}
            onClose={closeDrawer}
            title={drawerTitle}
            subTitle={drawerSubTitle}
          >
            {drawerMode?.kind === 'loan' && activeLoan && <LoanEarningsDrawerBody loan={activeLoan} />}
          </SharedLoanDrawer>
        </div>
      </AppShell>
      {tooltipPortal}
    </>
  )
}