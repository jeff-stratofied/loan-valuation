import React, { useState, useMemo } from 'react'
import OwnershipPie from './OwnershipPie'
import EventBadge from './EventBadge'
import type { EventType, LoanEvent } from './EventBadge'

export interface Loan2 {
  loanId?: string
  id?: string
  loanName?: string
  name?: string
  school?: string
  loanStartDate?: string
  purchaseDate?: string
  principal?: number
  origLoanAmt?: number
  loanAmount?: number
  purchasePrice?: number
  userPurchasePrice?: number
  nominalRate?: number
  termYears?: number
  graceYears?: number
  balance?: number
  ownershipPct?: number
  userOwnershipPct?: number
  ownershipLots?: any[]
  events?: LoanEvent[]
  loanColor?: string
  color?: string
  visible?: boolean
  isMarketLoan?: boolean
  amort?: { schedule: any[] }
  roiSeries?: { date: Date | string; roi: number; loanValue: number }[]
  // injected by EarningsDetailPage
  _earningsToDate?: number
}

interface Props {
  loans: Loan2[]
  onRowClick: (loan: Loan2) => void
  /** 'roi' (default) shows ROI column; 'earnings' swaps it for Net Earnings to Date */
  lastColumnMode?: 'roi' | 'earnings' | 'amort'
}

type SortDir = 'asc' | 'desc'
interface SortState { key: string; dir: SortDir }

const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
const fmtMY = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const EVENT_ROW_BG: Record<string, string> = {
  prepayment: 'rgba(34,197,94,0.16)',
  deferral:   'rgba(234,179,8,0.20)',
  default:    'rgba(239,68,68,0.20)',
}
const EVENT_PRIORITY = ['default', 'deferral', 'prepayment']

function getEventRowBg(events: LoanEvent[]): string | undefined {
  if (!events?.length) return undefined
  const types = events.map(e => e.type)
  for (const p of EVENT_PRIORITY) {
    if (types.includes(p as EventType)) return EVENT_ROW_BG[p]
  }
  return undefined
}

const TODAY = new Date()
const KPI_CURRENT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)

function getLoanId(loan: Loan2): string { return String(loan.loanId ?? loan.id ?? '') }
function getLoanName(loan: Loan2): string { return loan.loanName ?? loan.name ?? '' }
function getLoanColor(loan: Loan2): string { return loan.color ?? loan.loanColor ?? '#64748b' }
function getNominalRate(loan: Loan2): number {
  const r = Number(loan.nominalRate ?? 0)
  return r < 1 ? r * 100 : r
}
function getOrigAmt(loan: Loan2): number {
  return Number(loan.principal ?? loan.origLoanAmt ?? loan.loanAmount ?? 0)
}
function getPurchasePrice(loan: Loan2): number {
  return Number(loan.purchasePrice ?? loan.userPurchasePrice ?? 0)
}
function getOwnershipPct(loan: Loan2): number {
  return Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 0)
}
function getLatestRoi(loan: Loan2): number {
  const series = loan.roiSeries ?? []
  const entry = series.find(r => {
    const rd = r.date instanceof Date ? r.date : new Date(r.date)
    return rd.getFullYear() === KPI_CURRENT_MONTH.getFullYear() && rd.getMonth() === KPI_CURRENT_MONTH.getMonth()
  }) ?? (series.length > 0 ? series[series.length - 1] : undefined)
  return entry?.roi ?? 0
}

const COLUMNS_ROI = [
  { key: 'loanId',        label: 'ID' },
  { key: 'event',         label: 'Event' },
  { key: 'ownershipPct',  label: '% Owned' },
  { key: 'loanName',      label: 'Loan' },
  { key: 'school',        label: 'School' },
  { key: 'loanStartDate', label: 'Loan Start' },
  { key: 'purchaseDate',  label: 'Purchase Date' },
  { key: 'principal',     label: 'Orig Amt' },
  { key: 'purchasePrice', label: 'Purchase $' },
  { key: 'nominalRate',   label: 'Rate' },
  { key: 'termYears',     label: 'Term' },
  { key: 'graceYears',    label: 'Grace' },
  { key: 'roiToDate',     label: 'ROI' },
]

const COLUMNS_EARNINGS = [
  { key: 'loanId',        label: 'ID' },
  { key: 'event',         label: 'Event' },
  { key: 'ownershipPct',  label: '% Owned' },
  { key: 'loanName',      label: 'Loan' },
  { key: 'school',        label: 'School' },
  { key: 'loanStartDate', label: 'Loan Start' },
  { key: 'purchaseDate',  label: 'Purchase Date' },
  { key: 'principal',     label: 'Orig Amt' },
  { key: 'purchasePrice', label: 'Purchase $' },
  { key: 'nominalRate',   label: 'Rate' },
  { key: 'termYears',     label: 'Term' },
  { key: 'graceYears',    label: 'Grace' },
  { key: 'earningsToDate', label: 'Net Earnings' },
]

const COLUMNS_AMORT = [
  { key: 'loanId',        label: 'ID' },
  { key: 'event',         label: 'Event' },
  { key: 'ownershipPct',  label: '% Owned' },
  { key: 'loanName',      label: 'Loan' },
  { key: 'school',        label: 'School' },
  { key: 'loanStartDate', label: 'Loan Start' },
  { key: 'purchaseDate',  label: 'Purchase Date' },
  { key: 'principal',     label: 'Orig Amt' },
  { key: 'purchasePrice', label: 'Purchase $' },
  { key: 'nominalRate',   label: 'Rate' },
  { key: 'termYears',     label: 'Term' },
  { key: 'graceYears',    label: 'Grace' },
  { key: 'balance',       label: 'Balance' },
]

function getSortValue(loan: Loan2, key: string): string | number {
  switch (key) {
    case 'loanId':        return getLoanId(loan)
    case 'loanName':      return getLoanName(loan)
    case 'school':        return loan.school ?? ''
    case 'loanStartDate': return loan.loanStartDate ?? ''
    case 'purchaseDate':  return loan.purchaseDate ?? ''
    case 'principal':     return getOrigAmt(loan)
    case 'purchasePrice': return getPurchasePrice(loan)
    case 'nominalRate':   return getNominalRate(loan)
    case 'termYears':     return Number(loan.termYears ?? 0)
    case 'graceYears':    return Number(loan.graceYears ?? 0)
    case 'ownershipPct':  return getOwnershipPct(loan)
    case 'event':         return (loan.events?.length ? loan.events[0].type : '')
    case 'roiToDate':     return getLatestRoi(loan)
    case 'earningsToDate': return loan._earningsToDate ?? 0
    default:              return ''
  }
}

const thBase: React.CSSProperties = {
  padding: '6px 7px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 10, background: '#f8fafc',
  userSelect: 'none', boxShadow: '0 2px 4px rgba(15,23,42,0.06)', cursor: 'pointer',
}
const tdBase: React.CSSProperties = {
  padding: '5px 7px', borderBottom: '1px dashed rgba(15,23,42,0.05)',
  whiteSpace: 'nowrap', fontSize: 12,
}
const tdBold: React.CSSProperties = { ...tdBase, fontWeight: 600 }

export default function LoanTable({ loans, onRowClick, lastColumnMode = 'roi' }: Props) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState>({ key: 'loanName', dir: 'asc' })

  const COLUMNS =
  lastColumnMode === 'earnings'
    ? COLUMNS_EARNINGS
    : lastColumnMode === 'amort'
    ? COLUMNS_AMORT
    : COLUMNS_ROI

  function handleSortClick(key: string) {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

  const sorted = useMemo(() => {
    const arr = [...loans]
    arr.sort((a, b) => {
      const av = getSortValue(a, sort.key)
      const bv = getSortValue(b, sort.key)
      if (typeof av === 'string' && typeof bv === 'string')
        return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return arr
  }, [loans, sort])

  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
      boxShadow: '0 2px 16px rgba(15,23,42,0.08)', padding: '8px 8px 0 8px',
      height: '100%', overflowY: 'auto', overflowX: 'auto',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {COLUMNS.map(col => {
              const isActive = sort.key === col.key
              const arrow = isActive ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''
              return (
                <th
                  key={col.key}
                  onClick={() => handleSortClick(col.key)}
                  style={{ ...thBase, color: isActive ? '#0ea5e9' : '#64748b' }}
                >
                  {col.label}{arrow}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((loan, idx) => {
            const loanId    = getLoanId(loan)
            const isEven    = idx % 2 === 1
            const isHovered = hoveredRow === loanId
            const eventBg   = getEventRowBg(loan.events ?? [])
            const rowBg     = isHovered
              ? 'rgba(148,163,184,0.15)'
              : eventBg ?? (isEven ? 'rgba(15,23,42,0.02)' : 'transparent')

            const color     = getLoanColor(loan)
            const roi       = getLatestRoi(loan)
            const roiColor  = roi >= 0 ? '#16a34a' : '#dc2626'
            const rate      = getNominalRate(loan)
            const earnings  = loan._earningsToDate ?? 0

            const sched = loan.amort?.schedule ?? []
            const loanStartDisplay = loan.loanStartDate
              ? (() => { try { return fmtMY(new Date(loan.loanStartDate + 'T00:00:00')) } catch { return loan.loanStartDate } })()
              : '—'
            const purchaseDateDisplay = loan.purchaseDate
              ? (() => { try { return fmtMY(new Date(loan.purchaseDate)) } catch { return loan.purchaseDate } })()
              : '—'

            return (
              <tr
                key={loanId}
                onClick={e => { e.stopPropagation(); onRowClick(loan) }}
                onMouseEnter={() => setHoveredRow(loanId)}
                onMouseLeave={() => setHoveredRow(null)}
                style={{ background: rowBg, cursor: 'pointer', transition: 'background 0.15s' }}
              >
                <td style={tdBase}>{loanId}</td>
                <td style={tdBase}>
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {(loan.events ?? []).map((ev, i) => (
                      <EventBadge key={i} type={ev.type as EventType} variant="round" event={ev} />
                    ))}
                  </div>
                </td>
                <td style={tdBase}>
                  <OwnershipPie userPct={getOwnershipPct(loan)} marketPct={0} color={color} />
                </td>
                <td style={tdBold}>{getLoanName(loan)}</td>
                <td style={tdBase}>{loan.school ?? '—'}</td>
                <td style={tdBase}>{loanStartDisplay}</td>
                <td style={tdBase}>{purchaseDateDisplay}</td>
                <td style={tdBase}>{fmt$(getOrigAmt(loan))}</td>
                <td style={tdBase}>{fmt$(getPurchasePrice(loan))}</td>
                <td style={tdBold}>{rate.toFixed(2)}%</td>
                <td style={tdBase}>{loan.termYears ?? '—'}</td>
                <td style={tdBase}>{loan.graceYears ?? '—'}</td>

                {/* Last column — ROI or Earnings */}
                {lastColumnMode === 'earnings' ? (
  <td style={{ ...tdBold, color: earnings >= 0 ? '#16a34a' : '#dc2626' }}>
    {fmt$(earnings)}
  </td>
) : lastColumnMode === 'amort' ? (
  <td style={tdBold}>
    {fmt$(loan.balance ?? 0)}
  </td>
) : (
  <td style={{ ...tdBold, color: roiColor }}>
    {(roi * 100).toFixed(2)}%
  </td>
)}

              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
