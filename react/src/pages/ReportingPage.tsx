import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePortfolio } from '../hooks/usePortfolio'
import type { RoiKpis, EarningsKpis, AmortKpis } from '../hooks/usePortfolio'
import RoiChart from '../components/RoiChart'
import type { LoanSeries } from '../components/RoiChart'
import { useUser } from '../context/UserContext'
import AppShell from '../components/AppShell'

function formatPct(val: number): string {
  return val.toFixed(2) + '%'
}
function formatDollar(val: number): string {
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}

const formatCurrency = (value: number) =>
  value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  })

  
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



// ─── ROI Column ──────────────────────────────────────────────
type RoiKpiKey = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4'

interface RoiColumnProps {
  roiKpis: RoiKpis
  roiTimeline: any
  loansWithRoi: any[]
}

function RoiColumn({ roiKpis, roiTimeline, loansWithRoi }: RoiColumnProps) {
  const [hoveredKpi, setHoveredKpi] = useState<RoiKpiKey | null>(null)
  const [focusedLoanId, setFocusedLoanId] = useState<string | number | null>(null)
  const navigate = useNavigate()

  const kpis: { key: RoiKpiKey; label: string; value: string }[] = [
    { key: 'kpi1', label: 'Weighted ROI to Current Month', value: formatPct(roiKpis.weightedRoi) },
    { key: 'kpi2', label: 'Projected Weighted ROI',         value: formatPct(roiKpis.projectedWeightedRoi) },
    { key: 'kpi3', label: 'Capital Recovered',              value: formatPct(roiKpis.capitalRecoveryPct) },
    { key: 'kpi4', label: 'ROI Spread',                     value: formatPct(roiKpis.roiSpread) },
  ]

  const projectedPortfolioValue = useMemo(
  () =>
    loansWithRoi.reduce((sum, loan) => {
      const series = loan.roiSeries ?? []
      const last = series.length > 0 ? series[series.length - 1] : undefined
      return sum + Number(last?.loanValue ?? 0)
    }, 0),
  [loansWithRoi]
)

  const { perLoanSeries, weightedSeries, dates } = useMemo((): {
    perLoanSeries: LoanSeries[]
    weightedSeries: { date: Date; y: number }[]
    dates: Date[]
  } => {
    if (!roiTimeline?.dates?.length) return { perLoanSeries: [], weightedSeries: [], dates: [] }
    return {
      perLoanSeries: roiTimeline.perLoanSeries || [],
      weightedSeries: roiTimeline.weightedSeries || [],
      dates: roiTimeline.dates || [],
    }
  }, [roiTimeline, loansWithRoi])

  return (
    <div style={colStyle}>
      <div style={colHeaderStyle}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Return on Investment</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Portfolio ROI and projections</div>
      </div>

      <div style={kpiGridStyle}>
        {kpis.map(k => (
          <div
            key={k.key}
            style={{
              ...kpiTileStyle,
              boxShadow: hoveredKpi === k.key
                ? '0 8px 24px rgba(15,23,42,0.13)'
                : '0 2px 6px rgba(15,23,42,0.05)',
              transform: hoveredKpi === k.key ? 'translateY(-3px)' : 'translateY(0)',
            }}
            onClick={() => navigate(`/roi?kpi=${k.key}`)}
            onMouseEnter={() => setHoveredKpi(k.key)}
            onMouseLeave={() => setHoveredKpi(null)}
          >
            <div style={kpiLabelStyle}>{k.label}</div>
            <div style={kpiValueStyle}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={drawerStyle}>
        <div style={drawerHeadStyle}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Projected Weighted ROI</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Projection to Maturity</div>
          </div>
        </div>

        <div
          style={{ ...chartWrapStyle, cursor: 'pointer' }}
          onClick={() => navigate('/roi?kpi=kpi2')}
          title="Click to open full ROI view"
        >
          {dates.length > 0 ? (
            <RoiChart
              perLoanSeries={perLoanSeries}
              weightedSeries={weightedSeries}
              dates={dates}
              height={230}
              tickSpacingX={Math.max(1, Math.round(dates.length / 7))}
              weightedColor="#000"
              weightedWidth={2.6}
              weightedLabel="Weighted ROI"
              focusedLoanId={focusedLoanId}
              onFocusLoan={setFocusedLoanId}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13 }}>
              No chart data available
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '10px 12px 0' }}>
          <div style={infoCardStyle}>
            <div style={infoLabelStyle}>Projected Weighted ROI</div>
            <div style={infoValueStyle}>{formatPct(roiKpis.projectedWeightedRoi)}</div>
          </div>
          <div style={{ ...infoCardStyle, width: 180, flexShrink: 0 }}>
  <div style={infoLabelStyle}>Projected Portfolio Value</div>
  <div style={infoValueStyle}>{formatCurrency(projectedPortfolioValue)}</div>
</div>
        </div>

        <RoiLoanTable
          loansWithRoi={loansWithRoi}
          focusedLoanId={focusedLoanId}
          onFocusLoan={setFocusedLoanId}
          onRowClick={() => navigate('/roi?kpi=kpi2')}
        />
      </div>
    </div>
  )
}

// ─── ROI Loan Table ───────────────────────────────────────────
interface RoiLoanTableProps {
  loansWithRoi: any[]
  focusedLoanId: string | number | null
  onFocusLoan: (id: string | number | null) => void
  onRowClick?: () => void
}

function RoiLoanTable({ loansWithRoi, focusedLoanId, onFocusLoan, onRowClick }: RoiLoanTableProps) {
  return (
    <div style={{ padding: '10px 12px 12px' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#374151' }}>
        Projected ROI at Maturity
      </div>
      <div style={{ ...tableWrapStyle, maxHeight: 450, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>Loan</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Matures</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Proj. ROI</th>
            </tr>
          </thead>
          <tbody>
            {loansWithRoi.map(loan => {
              const loanId = String(loan.id ?? loan.loanId ?? '')
              const lastEntry = loan.roiSeries?.[loan.roiSeries.length - 1]
              const projRoi = lastEntry?.roi ?? 0
              const color = loan.loanColor || loan.color || '#64748b'
              const lastRow = loan.amort?.schedule?.[loan.amort.schedule.length - 1]
              const matDate = lastRow?.loanDate ? formatMonthYear(lastRow.loanDate) : '—'

              const isFocused = focusedLoanId != null && String(focusedLoanId) === String(loanId)
              const isDimmed = focusedLoanId != null && !isFocused

              return (
                <tr
                  key={loanId}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    background: isFocused ? 'rgba(148,163,184,0.1)' : 'transparent',
                    opacity: isDimmed ? 0.35 : 1,
                  }}
                  onMouseEnter={() => onFocusLoan(loanId)}
                  onMouseLeave={() => onFocusLoan(null)}
                  onClick={onRowClick}
                >
                  <td style={{ padding: '7px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        width: 10, height: 10,
                        background: color,
                        borderRadius: 2,
                        flexShrink: 0,
                        display: 'inline-block',
                        boxShadow: isFocused ? `0 0 0 2px ${color}40` : 'none',
                      }} />
                      <div>
                        <div style={{ fontWeight: isFocused ? 700 : 500 }}>{loan.loanName || loan.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{loan.school}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '7px 8px', color: '#64748b', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {matDate}
                  </td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color }}>
                    {formatPct(projRoi * 100)}
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

// ─── Earnings Column ─────────────────────────────────────────
type EarningsKpiKey = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4'

interface EarningsColumnProps {
  earningsKpis: EarningsKpis
  loansWithRoi: any[]
}

// ── ChartLensOverlay: circular magnifier rendered inside the chart SVG ──
function ChartLensOverlay({
  cursorX, cursorY, stacks, hovIdx, xS, yS, zeroY, zoom = 2.8, r = 48,
}: {
  cursorX: number; cursorY: number
  stacks: { idx: number; posTotal?: number; total?: number; negTotal?: number; bars: { loanId: string; color: string; val: number; bottom: number; top: number }[] }[]
  hovIdx: number
  xS: (i: number) => number
  yS: (v: number) => number
  zeroY: number
  zoom?: number
  r?: number
}) {
  const cx = cursorX, cy = cursorY
  const clipId = `reporting-lens-${hovIdx}`
  const WINDOW = 12  // wider window so bars fill the whole lens circle
  const start = Math.max(0, hovIdx - WINDOW)
  const end = Math.min(stacks.length - 1, hovIdx + WINDOW)
  const visStacks = stacks.slice(start, end + 1)
  const origBarW = visStacks.length > 1 ? Math.abs(xS(1) - xS(0)) * 0.6 : 6
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
          <line x1={xS(start) - origBarW*3} x2={xS(end) + origBarW*3}
            y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth={0.4} />
          {visStacks.map((stack) => {
            const bx = xS(stack.idx)
            const bW = Math.max(1.5, origBarW)
            const isHov = stack.idx === hovIdx
            let posCum = 0
            return (
              <g key={stack.idx}>
                {stack.bars.map((bar) => {
                  if (bar.val <= 0) return null
                  const yTop = yS(posCum + bar.val), yBot = yS(posCum)
                  posCum += bar.val
                  return <rect key={bar.loanId} x={bx - bW/2} y={Math.min(yTop, yBot)}
                    width={bW} height={Math.max(0.5, Math.abs(yBot - yTop))}
                    fill={bar.color} opacity={isHov ? 1 : 0.45} />
                })}
              </g>
            )
          })}
        </g>
      </g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#94a3b8" strokeWidth={1.5}
        style={{ filter: 'drop-shadow(0 2px 10px rgba(15,23,42,0.18))' }} />
      <circle cx={cx} cy={cy} r={2.5} fill="#64748b" opacity={0.5} />
    </g>
  )
}

function EarningsColumn({ earningsKpis, loansWithRoi }: EarningsColumnProps) {
  const [hoveredKpi, setHoveredKpi] = useState<EarningsKpiKey | null>(null)
  const [focusedLoanId, setFocusedLoanId] = useState<string | null>(null)
  const [hoveredBarIdx, setHoveredBarIdx] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
  const earningsSvgRef = useRef<SVGSVGElement>(null)
  const navigate = useNavigate()

  const kpis: { key: EarningsKpiKey; label: string; value: string }[] = [
    { key: 'kpi1', label: 'Net Earnings to Date', value: formatDollar(earningsKpis.netEarningsToDate) },
    { key: 'kpi2', label: 'Projected Lifetime Earnings', value: formatDollar(earningsKpis.projectedLifetimeEarnings) },
    { key: 'kpi3', label: 'Avg Monthly Earnings to Date', value: formatDollar(earningsKpis.avgMonthlyEarningsToDate) },
    { key: 'kpi4', label: 'Projected Avg Monthly', value: formatDollar(earningsKpis.projectedAvgMonthlyEarnings) },
  ]

  function getOwnershipPct(loan: any): number {
    return Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)
  }

  const { stackedSeries, allDates, monthlyBreakdownByTs } = useMemo(() => {
    const allMs = new Set<number>()
  
    loansWithRoi.forEach((l: any) => {
      ;(l.amort?.schedule ?? []).forEach((r: any) => {
        if (r.isOwned && r.loanDate instanceof Date) {
          allMs.add(new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime())
        }
      })
    })
  
    const allDates = Array.from(allMs).sort((a, b) => a - b).map(t => new Date(t))
  
    const monthlyBreakdownByTs = new Map<number, {
      principal: number
      interest: number
      fees: number
      net: number
    }>()
  
    const stackedSeries = loansWithRoi.map((loan: any) => {
      const id = String(loan.loanId ?? loan.id ?? '')
      const pct = getOwnershipPct(loan)
      const sched: any[] = (loan.amort?.schedule ?? []).filter(
        (r: any) => r.isOwned && r.loanDate instanceof Date
      )
  
      const monthlyNet = new Map<number, number>()
  
      sched.forEach(r => {
        const ts = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
  
        const principal =
          Math.max(
            0,
            Number(r.principalPaid ?? r.scheduledPrincipal ?? 0) -
              Number(r.prepayment ?? r.prepaymentPrincipal ?? 0)
          ) * pct
  
        const interest = (Number(r.interest) || 0) * pct
        const fees = (Number(r.feeThisMonth) || 0) * pct
        const net = principal + interest - fees
  
        monthlyNet.set(ts, net)
      })
  
      let running = 0
      const cumulativeNet = new Map<number, number>()
  
      allDates.forEach(d => {
        const ts = d.getTime()
        running += monthlyNet.get(ts) ?? 0
        cumulativeNet.set(ts, running)
      })
  
      return {
        loanId: id,
        name: loan.loanName ?? loan.name ?? id,
        color: loan.loanColor ?? loan.color ?? '#64748b',
        cumulativeNet,
      }
    })
  
    let runningPrincipal = 0
    let runningInterest = 0
    let runningFees = 0
    let runningNet = 0
  
    allDates.forEach(d => {
      const ts = d.getTime()
  
      let monthPrincipal = 0
      let monthInterest = 0
      let monthFees = 0
  
      loansWithRoi.forEach((loan: any) => {
        const pct = getOwnershipPct(loan)
        const sched: any[] = (loan.amort?.schedule ?? []).filter(
          (r: any) => r.isOwned && r.loanDate instanceof Date
        )
  
        const row = sched.find(
          (r: any) =>
            r.loanDate.getFullYear() === d.getFullYear() &&
            r.loanDate.getMonth() === d.getMonth()
        )
  
        if (!row) return
  
        monthPrincipal +=
          Math.max(
            0,
            Number(row.principalPaid ?? row.scheduledPrincipal ?? 0) -
              Number(row.prepayment ?? row.prepaymentPrincipal ?? 0)
          ) * pct
  
        monthInterest += (Number(row.interest) || 0) * pct
        monthFees += (Number(row.feeThisMonth) || 0) * pct
      })
  
      runningPrincipal += monthPrincipal
      runningInterest += monthInterest
      runningFees += monthFees
      runningNet = runningPrincipal + runningInterest - runningFees
  
      monthlyBreakdownByTs.set(ts, {
        principal: runningPrincipal,
        interest: runningInterest,
        fees: runningFees,
        net: runningNet,
      })
    })
  
    return { stackedSeries, allDates, monthlyBreakdownByTs }
  }, [loansWithRoi])

  const MINI_H = 230
  const MINI_PAD = { top: 10, right: 8, bottom: 28, left: 52 }
  const W = 400
  const H = MINI_H
  const chartW = W - MINI_PAD.left - MINI_PAD.right
  const chartH = H - MINI_PAD.top - MINI_PAD.bottom

  const stacks = useMemo(() => {
    return allDates.map((d, idx) => {
      const ts = d.getTime()
      let cumulative = 0

      const bars = stackedSeries.map(s => {
        const val = s.cumulativeNet.get(ts) ?? 0
        const bottom = cumulative
        cumulative += Math.max(0, val)
        return { loanId: s.loanId, name: s.name, color: s.color, val, bottom, top: cumulative }
      })

      return { idx, date: d, ts, total: cumulative, bars }
    })
  }, [stackedSeries, allDates])

  const maxVal = Math.max(...stacks.map(s => s.total), 1)

  const xScale = (i: number) => MINI_PAD.left + (i / Math.max(allDates.length - 1, 1)) * chartW
  const yScale = (v: number) => MINI_PAD.top + chartH - (v / maxVal) * chartH
  const barW = Math.max(1.5, Math.min(10, chartW / Math.max(allDates.length, 1) - 0.5))

  const xTickStep = Math.max(1, Math.round(allDates.length / 6))
  const xTicks = allDates.map((d, i) => ({ d, i })).filter(({ i }) => i % xTickStep === 0)
  const yTicks = [0, 0.5, 1].map(f => ({ v: f * maxVal, y: yScale(f * maxVal) }))

  const fmt$ = (v: number) =>
    '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const fmtMY = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  const hovStack = hoveredBarIdx !== null ? stacks[hoveredBarIdx] : null

  return (
    <div style={colStyle}>
      <div style={colHeaderStyle}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Earnings</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
          Cash flow and projected returns
        </div>
      </div>

      <div style={kpiGridStyle}>
        {kpis.map(k => (
          <div
            key={k.key}
            style={{
              ...kpiTileStyle,
              boxShadow:
                hoveredKpi === k.key
                  ? '0 8px 24px rgba(15,23,42,0.13)'
                  : '0 2px 6px rgba(15,23,42,0.05)',
              transform: hoveredKpi === k.key ? 'translateY(-3px)' : 'translateY(0)',
            }}
            onClick={() => navigate(`/earnings?kpi=${k.key}`)}
            onMouseEnter={() => setHoveredKpi(k.key)}
            onMouseLeave={() => setHoveredKpi(null)}
          >
            <div style={kpiLabelStyle}>{k.label}</div>
            <div style={kpiValueStyle}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={drawerStyle}>
        <div style={drawerHeadStyle}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Projected Total Net Earnings</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Projected lifetime earnings across all loans
          </div>
        </div>

        <div
          style={{ ...chartWrapStyle, cursor: 'pointer', position: 'relative' }}
          onClick={() => navigate('/earnings?kpi=kpi2')}
          title="Click to open full Earnings view"
        >
          {allDates.length > 0 ? (
            <>
              <svg
                ref={earningsSvgRef}
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: '100%', height: MINI_H }}
                onMouseLeave={() => setHoveredBarIdx(null)}
              >
                {yTicks.map(t => (
                  <g key={t.v}>
                    <line
                      x1={MINI_PAD.left}
                      x2={W - MINI_PAD.right}
                      y1={t.y}
                      y2={t.y}
                      stroke="#e2e8f0"
                      strokeWidth={0.5}
                    />
                    <text
                      x={MINI_PAD.left - 4}
                      y={t.y + 3}
                      textAnchor="end"
                      fontSize={8}
                      fill="#94a3b8"
                    >
                      {t.v >= 1000 ? `$${(t.v / 1000).toFixed(0)}k` : `$${t.v.toFixed(0)}`}
                    </text>
                  </g>
                ))}

                {stacks.map(stack => {
                  const cx = xScale(stack.idx)
                  const isHov = hoveredBarIdx === stack.idx

                  return (
                    <g
                      key={stack.idx}
                      onMouseMove={e => {
                        e.stopPropagation()
                        setHoveredBarIdx(stack.idx)
                        setMousePos({ x: e.clientX, y: e.clientY })
                      }}
                    >
                      <rect
                        x={cx - barW / 2 - 4}
                        y={MINI_PAD.top}
                        width={barW + 8}
                        height={chartH}
                        fill="transparent"
                      />

                      {stack.bars.map(bar => {
                        if (bar.val <= 0) return null

                        const bY = yScale(bar.top)
                        const bH = yScale(bar.bottom) - bY
                        const isBarFocused =
                          focusedLoanId !== null && String(focusedLoanId) === String(bar.loanId)
                        const isBarDimmed = focusedLoanId !== null && !isBarFocused
                        const opacity = isBarDimmed ? 0.2 : isHov || isBarFocused ? 1 : 0.85

                        return (
                          <rect
                            key={bar.loanId}
                            x={cx - barW / 2}
                            y={bY}
                            width={barW}
                            height={Math.max(0, bH)}
                            fill={bar.color}
                            opacity={opacity}
                          />
                        )
                      })}
                    </g>
                  )
                })}

                {xTicks.map(({ d, i }) => (
                  <text
                    key={i}
                    x={xScale(i)}
                    y={H - MINI_PAD.bottom + 12}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#94a3b8"
                  >
                    {d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                  </text>
                ))}

                {/* Circular magnifier lens */}
                {hovStack && earningsSvgRef.current && (() => {
                  const rect = earningsSvgRef.current!.getBoundingClientRect()
                  const r = 48
                  // Convert mouse to SVG space for free movement
                  const rawX = ((mousePos.x - rect.left) / rect.width) * W
                  const rawY = ((mousePos.y - rect.top) / rect.height) * H
                  // Clamp so lens circle never goes outside chart area — prevents white edges
                  const svgX = Math.max(MINI_PAD.left + r, Math.min(W - MINI_PAD.right - r, rawX))
                  const svgY = Math.max(MINI_PAD.top + r, Math.min(H - MINI_PAD.bottom - r, rawY))
                  return (
                    <ChartLensOverlay
                      cursorX={svgX}
                      cursorY={svgY}
                      stacks={stacks}
                      hovIdx={hovStack.idx}
                      xS={xScale}
                      yS={yScale}
                      zeroY={yScale(0)}
                      r={r}
                      zoom={3}
                    />
                  )
                })()}
              </svg>

              {hovStack && (() => {
  const breakdown = monthlyBreakdownByTs.get(hovStack.ts) ?? {
    principal: 0, interest: 0, fees: 0, net: 0,
  }
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: mousePos.x + 14,
        top: mousePos.y - 14,
        transform: 'translateY(-100%)',
        background: '#1e293b',
        color: '#fff',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        lineHeight: 1.7,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        pointerEvents: 'none',
        zIndex: 9999,
        minWidth: 220,
        maxWidth: 300,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: 6 }}>
        Date: {fmtMY(hovStack.date)}
      </div>
      <div>Principal: <b>{fmt$(breakdown.principal)}</b></div>
      <div>Interest: <b>{fmt$(breakdown.interest)}</b></div>
      <div>Fees: <b>{breakdown.fees === 0 ? '-$0.00' : `-${fmt$(breakdown.fees)}`}</b></div>
      <div>Cumulative Net: <b>{fmt$(breakdown.net)}</b></div>
    </div>
  )
})()}
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: '#94a3b8',
                fontSize: 13,
              }}
            >
              No earnings data
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, padding: '10px 12px 0' }}>
          <div style={infoCardStyle}>
            <div style={infoLabelStyle}>Projected Lifetime Earnings</div>
            <div style={infoValueStyle}>{formatDollar(earningsKpis.projectedLifetimeEarnings)}</div>
          </div>

          <div style={{ ...infoCardStyle, width: 180, flexShrink: 0 }}>
            <div style={infoLabelStyle}>Projected Total Fees</div>
            <div style={infoValueStyle}>
              {formatDollar(
                loansWithRoi.reduce((sum, loan) => {
                  const sched =
                    loan.earningsSchedule ??
                    loan.displayEarningsTimeline ??
                    loan.amort?.schedule ??
                    []

                  return (
                    sum +
                    sched.reduce((s: number, r: any) => {
                      const fee =
                        r.monthlyFees !== undefined
                          ? Number(r.monthlyFees ?? 0)
                          : Number(r.feeThisMonth ?? 0) * Number(r.ownershipPct ?? 1)

                      return s + fee
                    }, 0)
                  )
                }, 0)
              )}
            </div>
          </div>
        </div>

        <EarningsLoanTable
          loansWithRoi={loansWithRoi}
          focusedLoanId={focusedLoanId}
          onFocusLoan={setFocusedLoanId}
          onRowClick={() => navigate('/earnings?kpi=kpi2')}
        />
      </div>
    </div>
  )
}

// ─── Earnings Loan Table ──────────────────────────────────────
interface EarningsLoanTableProps {
  loansWithRoi: any[]
  focusedLoanId: string | null
  onFocusLoan: (id: string | null) => void
  onRowClick?: () => void
}

function EarningsLoanTable({ loansWithRoi, focusedLoanId, onFocusLoan, onRowClick }: EarningsLoanTableProps) {
  function getOwnershipPct(loan: any): number {
    return Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)
  }
  function rowNet(r: any, pct: number): number {
    const principal = Math.max(0, (Number(r.principalPaid) || 0) - (Number(r.prepayment) || 0))
    return (principal + (Number(r.interest) || 0) - (Number(r.feeThisMonth) || 0)) * pct
  }
  function loanProjectedNet(loan: any): number {
    const pct = getOwnershipPct(loan)
    return (loan.amort?.schedule ?? [])
      .filter((r: any) => r.isOwned)
      .reduce((s: number, r: any) => s + rowNet(r, pct), 0)
  }
function loanMatDate(loan: any): string {
  const sched = (loan.amort?.schedule ?? []).filter(
    (r: any) => r.isOwned && r.loanDate instanceof Date
  )
  const last = sched.length > 0 ? sched[sched.length - 1] : undefined
  return last?.loanDate
    ? last.loanDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—'
}

  return (
    <div style={{ padding: '10px 12px 12px' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#374151' }}>
        Projected Net Earnings by Loan
      </div>
      <div style={{ ...tableWrapStyle, maxHeight: 450, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thStyle}>Loan</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Matures</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Proj. Net</th>
            </tr>
          </thead>
          <tbody>
            {loansWithRoi.map(loan => {
              const loanId = String(loan.id ?? loan.loanId ?? '')
              const color  = loan.loanColor ?? loan.color ?? '#64748b'
              const projNet = loanProjectedNet(loan)
              const matDate = loanMatDate(loan)
              const isFocused = focusedLoanId != null && String(focusedLoanId) === String(loanId)
              const isDimmed  = focusedLoanId != null && !isFocused

              return (
                <tr
                  key={loanId}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: isFocused ? 'rgba(148,163,184,0.1)' : 'transparent', opacity: isDimmed ? 0.35 : 1 }}
                  onMouseEnter={() => onFocusLoan(loanId)}
                  onMouseLeave={() => onFocusLoan(null)}
                  onClick={onRowClick}
                >
                  <td style={{ padding: '7px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 10, height: 10, background: color, borderRadius: 2, flexShrink: 0, display: 'inline-block' }} />
                      <div>
                        <div style={{ fontWeight: isFocused ? 700 : 500 }}>{loan.loanName ?? loan.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{loan.school}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '7px 8px', color: '#64748b', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>{matDate}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 700, color }}>
                    {'$' + projNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

// ─── Amort Column ─────────────────────────────────────────────
type AmortKpiKey = 'tpv' | 'rates' | 'payments' | 'distribution'

interface AmortColumnProps {
  amortKpis: AmortKpis
  loansWithRoi: any[]
}

// Detect event type for row background color

function AmortColumn({ amortKpis, loansWithRoi }: AmortColumnProps) {
  const [hoveredKpi, setHoveredKpi] = useState<AmortKpiKey | null>(null)
  const [hoveredRowIdx, setHoveredRowIdx] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; row: any } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const navigate = useNavigate()

  const kpis: { key: AmortKpiKey; label: string; value: string }[] = [
    { key: 'tpv',          label: 'Total Portfolio Value', value: formatDollar(amortKpis.totalPortfolioValue) },
    { key: 'rates',        label: 'Avg Rate',              value: formatPct(amortKpis.avgRate / 100) },
    { key: 'payments',     label: 'Monthly Income',        value: formatDollar(amortKpis.monthlyIncome) },
    { key: 'distribution', label: 'Total Invested',        value: formatDollar(amortKpis.totalInvested) },
  ]

  // First loan purchased by this user (earliest purchaseDate)
  const featuredLoan = useMemo(() => {
    if (!loansWithRoi.length) return null
    return [...loansWithRoi].sort((a, b) => {
      const da = a.purchaseDate ?? a.loanStartDate ?? ''
      const db = b.purchaseDate ?? b.loanStartDate ?? ''
      return da.localeCompare(db)
    })[0]
  }, [loansWithRoi])

  const schedule: any[] = useMemo(() =>
    (featuredLoan?.amort?.schedule ?? []).filter((r: any) => r.loanDate instanceof Date),
    [featuredLoan]
  )

  // Purchase month for green line
  const purchaseDate: string =
  featuredLoan?.purchaseDate ??
  featuredLoan?.loanStartDate ??
  ''
  const purchaseMonthTs = useMemo(() => {
    if (!purchaseDate) return null
    const d = new Date(purchaseDate)
    if (isNaN(d.getTime())) return null
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  }, [purchaseDate])

  // Chart geometry
  const W = 400, H = 230
  const PAD = { top: 10, right: 8, bottom: 28, left: 52 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxBalance = useMemo(() =>
    Math.max(...schedule.map(r => Number(r.balance ?? 0)), 1),
    [schedule]
  )
  const maxCumPrincipal = useMemo(() =>
    Math.max(...schedule.map(r => Number(r.cumPrincipal ?? r.cumulativePrincipal ?? 0)), 1),
    [schedule]
  )
  const maxCumInterest = useMemo(() =>
    Math.max(...schedule.map(r => Number(r.cumInterest ?? r.cumulativeInterest ?? 0)), 1),
    [schedule]
  )
  const maxY = Math.max(maxBalance, maxCumPrincipal + maxCumInterest, 1)

  const xScale = (i: number) => PAD.left + (i / Math.max(schedule.length - 1, 1)) * chartW
  const yScale = (v: number) => PAD.top + chartH - (v / maxY) * chartH

  // Build polyline points
  const balancePts  = schedule.map((r, i) => `${xScale(i)},${yScale(Number(r.balance ?? 0))}`).join(' ')

  // Cumulative principal and interest — running totals if fields aren't present
  let runPrin = 0, runInt = 0
  const cumData = schedule.map(r => {
    runPrin += Number(r.principalPaid ?? r.principal ?? 0)
    runInt  += Number(r.interest ?? 0)
    const cumPrin = Number(r.cumPrincipal ?? r.cumulativePrincipal ?? runPrin)
    const cumInt  = Number(r.cumInterest ?? r.cumulativeInterest ?? runInt)
    const total   = Number(r.totalPaid ?? (cumPrin + cumInt))
    return { cumPrin, cumInt, total }
  })

  const cumPrinPts  = schedule.map((_, i) => `${xScale(i)},${yScale(cumData[i].cumPrin)}`).join(' ')
  const cumIntPts   = schedule.map((_, i) => `${xScale(i)},${yScale(cumData[i].cumInt)}`).join(' ')
  const totalPaidPts = schedule.map((_, i) => `${xScale(i)},${yScale(cumData[i].total)}`).join(' ')

  // X ticks
  const xTickStep = Math.max(1, Math.round(schedule.length / 5))
  const xTicks = schedule.map((r, i) => ({ r, i })).filter(({ i }) => i % xTickStep === 0)

  // Y ticks
  const yTicks = [0, 0.5, 1].map(f => ({ v: f * maxY, y: yScale(f * maxY) }))

  // Purchase line x position
  const purchaseLineX = useMemo(() => {
    if (purchaseMonthTs == null) return null
    const idx = schedule.findIndex(r => {
      const ts = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
      return ts >= purchaseMonthTs
    })
    if (idx < 0) return null
    return xScale(idx)
  }, [purchaseMonthTs, schedule])

  // Mouse hover on SVG
  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || schedule.length === 0) return
    const rect = svgRef.current.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const relX = svgX - PAD.left
    const idx = Math.round((relX / chartW) * (schedule.length - 1))
    const clamped = Math.max(0, Math.min(schedule.length - 1, idx))
    setHoveredRowIdx(clamped)
    setTooltip({ x: e.clientX, y: e.clientY, row: schedule[clamped] })
  }

  const fmt$ = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div style={colStyle}>
      {/* Column header */}
      <div style={colHeaderStyle}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Loan Amortization</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>Schedules and balances</div>
      </div>

      {/* KPI tiles — click navigates to amort page with that kpi drawer open */}
      <div style={kpiGridStyle}>
        {kpis.map(k => (
          <div
            key={k.key}
            style={{
              ...kpiTileStyle,
              boxShadow: hoveredKpi === k.key
                ? '0 8px 24px rgba(15,23,42,0.13)'
                : '0 2px 6px rgba(15,23,42,0.05)',
              transform: hoveredKpi === k.key ? 'translateY(-3px)' : 'translateY(0)',
            }}
            onClick={() => navigate(`/amort?kpi=${k.key}`)}
            onMouseEnter={() => setHoveredKpi(k.key)}
            onMouseLeave={() => setHoveredKpi(null)}
          >
            <div style={kpiLabelStyle}>{k.label}</div>
            <div style={kpiValueStyle}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Drawer */}
      <div style={drawerStyle}>
        <div style={drawerHeadStyle}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {featuredLoan ? (featuredLoan.loanName ?? featuredLoan.name) : 'Amortization'}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {featuredLoan?.school ?? ''}
            {featuredLoan?.purchaseDate ? ` · Purchased ${featuredLoan.purchaseDate}` : ''}
          </div>
        </div>

        {/* Chart — click navigates to amort page with this loan's drawer open */}
        <div
          style={{ ...chartWrapStyle, cursor: 'pointer', position: 'relative' }}
          onClick={() => navigate(`/amort${featuredLoan ? `?loan=${featuredLoan.loanId ?? featuredLoan.id}` : ''}`)}
          title="Click to open full Amortization view"
        >
          {schedule.length > 0 ? (
            <>
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: '100%', height: H }}
                onMouseMove={handleSvgMouseMove}
                onMouseLeave={() => { setHoveredRowIdx(null); setTooltip(null) }}
              >
                {/* Grid + Y ticks */}
                {yTicks.map(t => (
                  <g key={t.v}>
                    <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#e2e8f0" strokeWidth={0.5} />
                    <text x={PAD.left - 4} y={t.y + 3} textAnchor="end" fontSize={8} fill="#94a3b8">
                      {t.v >= 1000 ? `$${(t.v / 1000).toFixed(0)}k` : `$${t.v.toFixed(0)}`}
                    </text>
                  </g>
                ))}

                {/* Lines */}
                <polyline points={totalPaidPts} fill="none" stroke="#f43f5e" strokeWidth={1.5} opacity={0.85} />
                <polyline points={cumIntPts}    fill="none" stroke="#a78bfa" strokeWidth={1.2} opacity={0.75} />
                <polyline points={cumPrinPts}   fill="none" stroke="#22d3ee" strokeWidth={1.2} opacity={0.75} />
                <polyline points={balancePts}   fill="none" stroke="#0f172a" strokeWidth={2.2} />

                {/* Purchase month green line */}
                {purchaseLineX != null && (
                  <line
                    x1={purchaseLineX} x2={purchaseLineX}
                    y1={PAD.top} y2={PAD.top + chartH}
                    stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 3"
                  />
                )}

                {/* Hover crosshair */}
                {hoveredRowIdx !== null && (
                  <line
                    x1={xScale(hoveredRowIdx)} x2={xScale(hoveredRowIdx)}
                    y1={PAD.top} y2={PAD.top + chartH}
                    stroke="#64748b" strokeWidth={1} strokeDasharray="3 2" opacity={0.6}
                  />
                )}

                {/* X ticks */}
                {xTicks.map(({ r, i }) => (
                  <text key={i} x={xScale(i)} y={H - PAD.bottom + 12} textAnchor="middle" fontSize={8} fill="#94a3b8">
                    {r.loanDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                  </text>
                ))}
              </svg>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 10, padding: '2px 8px 4px', flexWrap: 'wrap' }}>
                {[
                  { color: '#0f172a', label: 'Balance' },
                  { color: '#22d3ee', label: 'Cum Principal' },
                  { color: '#a78bfa', label: 'Cum Interest' },
                  { color: '#f43f5e', label: 'Total' },
                  { color: '#10b981', label: 'Purchased', dashed: true },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b' }}>
                    <svg width={16} height={8}>
                      <line x1={0} y1={4} x2={16} y2={4}
                        stroke={item.color} strokeWidth={item.label === 'Balance' ? 2 : 1.5}
                        strokeDasharray={item.dashed ? '4 2' : undefined}
                      />
                    </svg>
                    {item.label}
                  </div>
                ))}
              </div>

              {/* Tooltip */}
              {tooltip && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position: 'fixed',
                    left: tooltip.x + 14,
                    top: tooltip.y - 14,
                    transform: 'translateY(-100%)',
                    background: '#1e293b', color: '#fff', borderRadius: 8,
                    padding: '10px 14px', fontSize: 12, lineHeight: 1.7,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none', zIndex: 9999,
                    minWidth: 210,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: 6 }}>
                    {tooltip.row.loanDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </div>
                  <div>Balance: <b>{fmt$(Number(tooltip.row.balance ?? 0))}</b></div>
                  <div>Payment: <b>{fmt$(Number(tooltip.row.payment ?? 0))}</b></div>
                  <div>Principal: <b>{fmt$(Number(tooltip.row.principalPaid ?? tooltip.row.principal ?? 0))}</b></div>
                  <div>Interest: <b>{fmt$(Number(tooltip.row.interest ?? 0))}</b></div>
                  {cumData[hoveredRowIdx!] && (
                    <>
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 4, paddingTop: 4 }}>
                        <div>Cum Principal: <b>{fmt$(cumData[hoveredRowIdx!].cumPrin)}</b></div>
                        <div>Cum Interest: <b>{fmt$(cumData[hoveredRowIdx!].cumInt)}</b></div>
                        <div>Total Paid: <b>{fmt$(cumData[hoveredRowIdx!].total)}</b></div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13 }}>
              No amortization data
            </div>
          )}
        </div>

        {/* Info cards */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 12px 0' }}>
          <div style={infoCardStyle}>
            <div style={infoLabelStyle}>Total Portfolio Value</div>
            <div style={infoValueStyle}>{formatDollar(amortKpis.totalPortfolioValue)}</div>
          </div>
          <div style={{ ...infoCardStyle, width: 100, flexShrink: 0 }}>
            <div style={infoLabelStyle}>Loans</div>
            <div style={infoValueStyle}>{loansWithRoi.length}</div>
          </div>
        </div>

        {/* Amort schedule table for featured loan */}
        <AmortScheduleTable
          loan={featuredLoan}
          purchaseMonthTs={purchaseMonthTs}
          onRowClick={() => navigate(`/amort${featuredLoan ? `?loan=${featuredLoan.loanId ?? featuredLoan.id}` : ''}`)}
        />
      </div>
    </div>
  )
}

// ─── Amort Schedule Table (preview in column) ────────────────
interface AmortScheduleTableProps {
  loan: any
  purchaseMonthTs: number | null
  onRowClick: () => void
}

function AmortScheduleTable({ loan, purchaseMonthTs, onRowClick }: AmortScheduleTableProps) {
  const schedule: any[] = useMemo(() =>
    (loan?.amort?.schedule ?? []).filter((r: any) => r.loanDate instanceof Date),
    [loan]
  )

  if (!loan || schedule.length === 0) {
    return (
      <div style={{ padding: '10px 12px 12px', color: '#94a3b8', fontSize: 13 }}>
        No schedule data
      </div>
    )
  }

  const fmt$ = (v: number) => v === 0 ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function rowBg(r: any): string | undefined {
    const events: any[] = loan.events ?? []
    if (!events.length) return undefined
  
    const rowDate = new Date(r.loanDate)
rowDate.setMonth(rowDate.getMonth() - 1)

const rowTs = new Date(
  rowDate.getFullYear(),
  rowDate.getMonth(),
  1
).getTime()
  
    let isDeferral = false
  
    for (const e of events) {
  
      /* --- PREPAYMENT --- */
      if (e.type === 'prepayment') {
        const d = new Date(e.date || e.startDate)
      
        /* convert payment month → accrual month */
        d.setMonth(d.getMonth() - 1)
      
        const ts = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      
        if (rowTs === ts) return 'rgba(16,185,129,0.08)'
      }
  
      /* --- DEFAULT --- */
      if (e.type === 'default') {
        const d = new Date(e.date || e.startDate)
        const ts = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
        if (rowTs === ts) return 'rgba(239,68,68,0.08)'
      }
  
      /* --- DEFERRAL RANGE --- */
      if (e.type === 'deferral' && e.startDate) {
        const s = new Date(e.startDate)
        const months = e.months ?? e.duration ?? 0
      
        const startTs = new Date(s.getFullYear(), s.getMonth(), 1).getTime()
      
        const end = new Date(s)
        end.setMonth(end.getMonth() + months - 1)
      
        const endTs = new Date(end.getFullYear(), end.getMonth(), 1).getTime()
      
        if (rowTs >= startTs && rowTs <= endTs) {
          isDeferral = true
        }
      }

    }
  
    if (isDeferral) return 'rgba(234,179,8,0.10)'
  
    return undefined
  }

  const purchaseRowIndex = schedule.findIndex((r: any) => {
    if (purchaseMonthTs == null) return false
    const ts = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
    return ts >= purchaseMonthTs
  })
  
  return (
    <div style={{ padding: '10px 12px 12px' }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#374151' }}>
        Amortization Schedule
      </div>
  
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
        — Green line indicates the month the loan was purchased
      </div>
  
      <div style={{ ...tableWrapStyle, maxHeight: 450, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Payment</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Principal</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Interest</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
  
          <tbody>
            {schedule.map((r, i) => {
              const bg = rowBg(r)
              const isPurchase = i === purchaseRowIndex
  
              const payment   = Number(r.payment ?? 0)
              const principal = Number(r.principalPaid ?? r.principal ?? 0)
              const interest  = Number(r.interest ?? 0)
              const balance   = Number(r.balance ?? 0)
  
              return (
                <tr
                  key={i}
                  style={{
                    borderTop: isPurchase ? '2px solid #10b981' : undefined,
                    borderBottom: '1px solid #f1f5f9',
                    background: bg ?? 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={onRowClick}
                >
                  <td style={{ padding: '5px 8px', color: '#374151', whiteSpace: 'nowrap' }}>
                    {r.loanDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </td>
  
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b' }}>
                    {fmt$(payment)}
                  </td>
  
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b' }}>
                    {fmt$(principal)}
                  </td>
  
                  <td style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b' }}>
                    {fmt$(interest)}
                  </td>
  
                  <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                    {fmt$(balance)}
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

// ─── Main Page ────────────────────────────────────────────────

type ActiveTab = 'marketplace' | 'holdings' | 'valuations'

export default function ReportingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { userId } = useUser()

  const initialTab = (searchParams.get('tab') as ActiveTab) || 'holdings'
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab)

  const { roiKpis, earningsKpis, amortKpis, roiTimeline, loansWithRoi, loading, error } = usePortfolio(userId)

  useEffect(() => {
    const tab = (searchParams.get('tab') as ActiveTab) || 'holdings'
    setActiveTab(tab)
  }, [searchParams])

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
          }}
        >
          Error: {error}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div style={{ padding: '0 0 32px' }}>
        {/* Tabs */}
        <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 28, paddingLeft: 4 }}>
            {(['marketplace', 'holdings', 'valuations'] as ActiveTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  if (tab === 'valuations') {
                    navigate('/valuations')
                    return
                  }

                  setActiveTab(tab)
                  navigate(`/?tab=${tab}`)
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '14px 0',
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: activeTab === tab ? '#0f172a' : '#64748b',
                  borderBottom: activeTab === tab ? '2px solid #0ea5e9' : '2px solid transparent',
                  marginBottom: -1,
                }}
              >
                {tab === 'marketplace'
                  ? 'Marketplace'
                  : tab === 'holdings'
                    ? 'My Holdings'
                    : 'Loan Valuations'}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'marketplace' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <img
              src="https://jeff-stratofied.github.io/loan-dashboard/assets/MarketplaceReporting.png"
              alt="Marketplace"
              style={{ maxWidth: '100%', borderRadius: 12 }}
            />
          </div>
        )}

        {activeTab === 'holdings' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <RoiColumn roiKpis={roiKpis} roiTimeline={roiTimeline} loansWithRoi={loansWithRoi} />
            <EarningsColumn earningsKpis={earningsKpis} loansWithRoi={loansWithRoi} />
            <AmortColumn amortKpis={amortKpis} loansWithRoi={loansWithRoi} />
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ─── Shared styles ────────────────────────────────────────────
const colStyle: React.CSSProperties = {
  background: '#ffffff',
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  boxShadow: '0 12px 30px rgba(15,23,42,0.06)',
  display: 'flex',
  flexDirection: 'column',
}

const colHeaderStyle: React.CSSProperties = {
  padding: '16px 20px',
  borderBottom: '1px solid #e2e8f0',
}

const kpiGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 8,
  padding: '12px 12px 0',
}

const kpiTileStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  padding: '11px 13px',
  cursor: 'pointer',
  transition: 'transform 0.15s, box-shadow 0.15s',
}

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  marginBottom: 4,
  lineHeight: 1.3,
}

const kpiValueStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: '#0f172a',
}

const drawerStyle: React.CSSProperties = {
  margin: '12px 12px 12px',
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
  boxShadow: '0 4px 16px rgba(15,23,42,0.06)',
  overflow: 'hidden',
}

const drawerHeadStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid #f1f5f9',
}

const chartWrapStyle: React.CSSProperties = {
  height: 240,
  padding: 8,
  background: 'linear-gradient(180deg, #ffffff, #fcfeff)',
  borderBottom: '1px solid rgba(15,23,42,0.04)',
}

const infoCardStyle: React.CSSProperties = {
  flex: 1,
  background: '#f8fafc',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  display: 'flex',
  flexDirection: 'column',
}

const infoLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  marginBottom: 4,
}

const infoValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: '#0f172a',
}

const tableWrapStyle: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#ffffff',
}

const thStyle: React.CSSProperties = {
  padding: '7px 8px',
  textAlign: 'left',
  color: '#64748b',
  fontWeight: 700,
  fontSize: 12,
  position: 'sticky',
  top: 0,
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
}

const closeBtnStyle: React.CSSProperties = {
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '6px 10px',
  cursor: 'pointer',
  fontSize: 14,
  color: '#0f172a',
}

export { closeBtnStyle }
