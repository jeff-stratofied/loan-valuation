// ===============================
// roiEngine.ts
// ===============================

import { buildAmortSchedule } from './loanEngine'

// =====================================================
// Types
// =====================================================

export interface RoiEntry {
  month: number
  date: Date
  displayDate?: Date
  roi: number
  loanValue: number
  invested: number
  ownershipPct: number
  ownershipLots: any[]
  cumFees: number
  realized: number
  remainingBalance: number
  unrealized: number
  isTerminal?: boolean
  isPlaceholder?: boolean
  reason?: string
}

export interface RoiLoan {
  id?: string
  loanId?: string
  name?: string
  loanName?: string
  purchaseDate: string
  purchasePrice?: number
  termYears: number
  graceYears: number
  ownershipPct?: number
  userOwnershipPct?: number
  userPurchasePrice?: number
  ownershipLots?: any[]
  roiSeries?: RoiEntry[]
  cumSchedule?: any[]
  amort?: { schedule: any[] }
}

// =====================================================
// Helpers
// =====================================================

const warnedLoans = new Set<string>()

function monthKeyFromDate(d: Date): string | null {
  if (!(d instanceof Date) || isNaN(+d)) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function clampToMonthEnd(monthDate: Date): Date | null {
  if (!(monthDate instanceof Date) || isNaN(+monthDate)) return null
  const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0)
  end.setHours(23, 59, 59, 999)
  return end
}

function safeNum(x: any): number {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

function monthDiff(d1: Date, d2: Date): number {
  if (!(d1 instanceof Date) || !(d2 instanceof Date)) return 0
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth())
}

function getOwnershipBasis(loan: any): { ownershipPct: number; invested: number; lots: any[] } {
  const directPct = safeNum(loan?.ownershipPct ?? loan?.userOwnershipPct)
  const directInvested = safeNum(loan?.userPurchasePrice)

  if (directPct > 0 || directInvested > 0) {
    return {
      ownershipPct: directPct > 0 ? directPct : 0,
      invested: directInvested > 0 ? directInvested : 0,
      lots: Array.isArray(loan?.ownershipLots) ? loan.ownershipLots : [],
    }
  }

  const lots = Array.isArray(loan?.ownershipLots) ? loan.ownershipLots : []
  const ownershipPct = lots.reduce((s: number, lot: any) => s + safeNum(lot?.pct), 0)
  const invested = lots.reduce((s: number, lot: any) => s + safeNum(lot?.pricePaid), 0)

  return { ownershipPct, invested, lots }
}

// =====================================================
// Public API
// =====================================================

export function getRoiEntryAsOfMonth(loan: RoiLoan, monthDate: Date): RoiEntry {
  const id = String(loan.id ?? loan.loanId ?? '')

  if (!loan || !id || !Array.isArray(loan.roiSeries) || !(monthDate instanceof Date)) {
    return { roi: 0, invested: 0, loanValue: 0, date: new Date(), isPlaceholder: true, reason: 'invalid input' } as any
  }

  const asOf = clampToMonthEnd(monthDate)
  if (!asOf || isNaN(+asOf)) {
    return { roi: 0, invested: 0, loanValue: 0, date: new Date(), isPlaceholder: true, reason: 'invalid asOf date' } as any
  }

  const validSeries = loan.roiSeries!
    .filter(r => r?.date instanceof Date && !isNaN(+r.date))
    .slice()
    .sort((a, b) => +a.date - +b.date)

  if (validSeries.length === 0) {
    if (!warnedLoans.has(id)) {
      console.warn(`No valid ROI entries for loan ${id}. Using placeholder (ROI = 0).`)
      warnedLoans.add(id)
    }
    return { roi: 0, invested: safeNum(loan.roiSeries?.[0]?.invested), loanValue: 0, date: new Date(), isPlaceholder: true, reason: 'no valid ROI entries' } as any
  }

  for (let i = validSeries.length - 1; i >= 0; i--) {
    if (validSeries[i].date <= asOf) return validSeries[i]
  }

  if (!warnedLoans.has(id)) {
    console.warn(`No ROI entry on or before ${asOf.toISOString().slice(0, 10)} for loan ${id}. Using placeholder.`)
    warnedLoans.add(id)
  }

  return { roi: 0, invested: safeNum(loan.roiSeries?.[0]?.invested), loanValue: 0, date: new Date(), isPlaceholder: true, reason: 'no entry <= asOf date' } as any
}

export function computeWeightedRoiAsOfMonth(loans: RoiLoan[], monthDate: Date): number {
  if (!Array.isArray(loans) || !(monthDate instanceof Date)) return 0

  let totalInvested = 0
  let weightedSum = 0

  loans.forEach(loan => {
    const entry = getRoiEntryAsOfMonth(loan, monthDate)
    if (!entry) return
    const invested = safeNum(entry.invested)
    const roi = safeNum(entry.roi)
    if (invested > 0) {
      weightedSum += roi * invested
      totalInvested += invested
    }
  })

  return totalInvested > 0 ? weightedSum / totalInvested : 0
}

export function computeKPIs(loans: RoiLoan[], asOfMonth: Date) {
  if (!Array.isArray(loans) || !(asOfMonth instanceof Date)) {
    return {
      totalInvested: 0,
      weightedROI: 0,
      projectedWeightedROI: 0,
      capitalRecoveredAmount: 0,
      capitalRecoveryPct: 0,
    }
  }

  const weightedROI = computeWeightedRoiAsOfMonth(loans, asOfMonth)

  const totalInvestedForRoi = loans.reduce((s, l) => {
    const last = Array.isArray(l?.roiSeries) && l.roiSeries!.length
      ? l.roiSeries![l.roiSeries!.length - 1]
      : null
    return s + safeNum(last?.invested)
  }, 0) || 0

  const projectedWeightedROI =
    loans.reduce((sum, l) => {
      const last = Array.isArray(l?.roiSeries) && l.roiSeries!.length
        ? l.roiSeries![l.roiSeries!.length - 1]
        : null
      if (!last) return sum
      return sum + safeNum(last.roi) * safeNum(last.invested)
    }, 0) / (totalInvestedForRoi || 1)

  const asOf = clampToMonthEnd(asOfMonth) || new Date(asOfMonth)

  let recoveredCashTotal = 0
  let totalInvested = 0

  loans.forEach(l => {
    const sched = (l as any)?.amort?.schedule
    if (!Array.isArray(sched) || !sched.length) return

    const { ownershipPct, invested } = getOwnershipBasis(l)
    if (!ownershipPct || !invested) return

    totalInvested += invested

    sched.forEach((r: any) => {
      if (r?.isOwned && r.loanDate instanceof Date && r.loanDate <= asOf) {
        const scheduledPrincipal = Math.max(0, safeNum(r.principalPaid) - safeNum(r.prepayment))
        const totalPaid = scheduledPrincipal + safeNum(r.interest) - safeNum(r.feeThisMonth)
        recoveredCashTotal += totalPaid * ownershipPct
      }
    })
  })

  const capitalRecoveryPct = totalInvested > 0 ? recoveredCashTotal / totalInvested : 0

  return {
    totalInvested,
    weightedROI,
    projectedWeightedROI,
    capitalRecoveredAmount: recoveredCashTotal,
    capitalRecoveryPct,
  }
}

export function buildProjectedRoiTimeline(loans: RoiLoan[], opts: { colorMap?: Record<string, string> } = {}) {
  if (!Array.isArray(loans) || loans.length === 0) {
    return { dates: [], perLoanSeries: [], weightedSeries: [] }
  }

  const colorMap = opts.colorMap || {}

  const validPurchases = loans
    .map(l => new Date(l.purchaseDate))
    .filter(d => d instanceof Date && !isNaN(+d))

  if (!validPurchases.length) return { dates: [], perLoanSeries: [], weightedSeries: [] }

  const earliestPurchase = new Date(Math.min(...validPurchases.map(d => +d)))

  const maturityDates = loans
    .map(l => {
      const d = new Date(l.purchaseDate)
      if (isNaN(+d)) return null
      d.setMonth(d.getMonth() + Math.round((safeNum(l.termYears) + safeNum(l.graceYears)) * 12))
      return d
    })
    .filter(Boolean) as Date[]

  const latestMaturity = new Date(Math.max(...maturityDates.map(d => +d)))

  const dates: Date[] = []
  const cursor = new Date(earliestPurchase)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)

  while (cursor <= latestMaturity) {
    dates.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const perLoanSeries = loans.map((loan, idx) => {
    const purchase = new Date(loan.purchaseDate)
    purchase.setHours(0, 0, 0, 0)

    const roiMap: Record<string, number> = {}
    const cs = Array.isArray(loan.cumSchedule) ? loan.cumSchedule : []

    cs.forEach((row: any) => {
      if (!row?.isOwned) return
      if (!(row.loanDate instanceof Date) || isNaN(+row.loanDate)) return
      const entry = getRoiEntryAsOfMonth(loan, row.loanDate)
      if (!entry) return
      const key = monthKeyFromDate(row.loanDate)
      if (key) roiMap[key] = safeNum(entry.roi)
    })

    const roiKeys = Object.keys(roiMap).sort()
    const firstRoiValue = roiKeys.length ? roiMap[roiKeys[0]] : 0
    let lastKnownROI = firstRoiValue

    const data = dates.map(date => {
      if (date < purchase) return { date, y: null }
      const key = monthKeyFromDate(date)
      if (key && roiMap[key] != null) lastKnownROI = roiMap[key]
      return { date, y: lastKnownROI }
    })

    const loanId = loan.id ?? loan.loanId ?? String(idx)

    return {
      id: loanId,
      name: loan.name || loan.loanName || `Loan ${loanId}`,
      color: colorMap[loanId] || null,
      data,
    }
  })

  const frozenInvested = loans.map(l => {
    const last = Array.isArray(l.roiSeries) && l.roiSeries!.length
      ? l.roiSeries![l.roiSeries!.length - 1]
      : null
    return safeNum(last?.invested)
  })

  const frozenTotalInvested = frozenInvested.reduce((a, b) => a + b, 0)

  const weightedSeries = dates.map((date, i) => {
    if (!frozenTotalInvested) return { date, y: 0 }
    let weightedSum = 0
    loans.forEach((_, idx) => {
      const roi = perLoanSeries[idx]?.data?.[i]?.y
      if (roi == null) return
      const invested = frozenInvested[idx]
      if (invested > 0) weightedSum += roi * invested
    })
    return { date, y: weightedSum / frozenTotalInvested }
  })

  return { dates, perLoanSeries, weightedSeries }
}

export function buildHistoricalRoiTimeline(loans: RoiLoan[]) {
  if (!Array.isArray(loans) || loans.length === 0) {
    return { dates: [], perLoanSeries: [], weightedSeries: [] }
  }

  const validPurchases = loans
    .map(l => new Date(l.purchaseDate))
    .filter(d => d instanceof Date && Number.isFinite(+d))

  if (!validPurchases.length) return { dates: [], perLoanSeries: [], weightedSeries: [] }

  const start = new Date(Math.min(...validPurchases.map(d => +d)))
  start.setDate(1)
  start.setHours(0, 0, 0, 0)

  const today = new Date()
  today.setDate(1)
  today.setHours(0, 0, 0, 0)

  const dates: Date[] = []
  const cursor = new Date(start)
  while (cursor <= today) {
    dates.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const perLoanSeries = loans.map(loan => {
    const id = loan.id ?? loan.loanId ?? ''
    const name = loan.name || loan.loanName || `Loan ${id}`

    const roiMap = new Map<string, number>()
    ;(loan.roiSeries || []).forEach(r => {
      if (r?.date instanceof Date && Number.isFinite(r.roi)) {
        const key = monthKeyFromDate(r.date)
        if (key) roiMap.set(key, r.roi)
      }
    })

    let lastKnown = 0
    const data = dates.map(d => {
      const key = monthKeyFromDate(d)
      if (key && roiMap.has(key)) lastKnown = roiMap.get(key)!
      return { date: d, y: lastKnown }
    })

    return { id, name, data }
  })

  const totalInvested = loans.reduce((s, l) => {
    const last = l.roiSeries?.slice(-1)[0]
    return s + (Number.isFinite(last?.invested) ? last!.invested : 0)
  }, 0)

  const weightedSeries = dates.map((d, i) => {
    if (!totalInvested) return { date: d, y: 0 }
    let sum = 0
    loans.forEach((loan, idx) => {
      const roi = perLoanSeries[idx].data[i].y
      const entry = getRoiEntryAsOfMonth(loan, d)
      const invested = Number(entry?.invested || 0)
      if (invested > 0) sum += roi * invested
    })
    return { date: d, y: sum / totalInvested }
  })

  return { dates, perLoanSeries, weightedSeries }
}

export function normalizeLoansForRoi(loans: any[]): any[] {
  return loans.map(l => ({
    ...l,
    purchasePrice: Number(l.purchasePrice) || 0,
    roiSeries: Array.isArray(l.roiSeries) ? l.roiSeries : [],
    cumSchedule: Array.isArray(l.cumSchedule) ? l.cumSchedule : [],
    amort: l.amort || { schedule: [] },
  }))
}

export function getLastRoiEntry(loan: RoiLoan): RoiEntry | null {
  if (!loan || !Array.isArray(loan.roiSeries) || !loan.roiSeries.length) return null
  return loan.roiSeries[loan.roiSeries.length - 1]
}

export function getRoiSeriesAsOfMonth(loans: RoiLoan[], monthDate: Date) {
  if (!Array.isArray(loans) || !(monthDate instanceof Date)) return []
  return loans.map(loan => ({
    loanId: loan.id ?? loan.loanId,
    loan,
    entry: getRoiEntryAsOfMonth(loan, monthDate),
  }))
}

export function getLoanMaturityDate(loan: RoiLoan): Date | null {
  if (!loan?.purchaseDate) return null
  const d = new Date(loan.purchaseDate)
  if (isNaN(+d)) return null
  d.setMonth(d.getMonth() + Math.round((safeNum(loan.termYears) + safeNum(loan.graceYears)) * 12))
  return d
}

export function deriveLoansWithRoi(formattedLoans: any[]): any[] {
  return formattedLoans.map(l => {
    const rawAmort = buildAmortSchedule(l)
    const amortSchedule = (() => {
      const out: any[] = []
      for (const r of rawAmort) {
        out.push(r)
        if (r.isTerminal === true) break
      }
      return out
    })()

    const purchase = new Date(l.purchaseDate)

    const scheduleWithOwnership = amortSchedule.map(r => ({
      ...r,
      isOwned: r.loanDate >= purchase,
      ownershipMonthIndex: r.loanDate >= purchase ? monthDiff(purchase, r.loanDate) + 1 : 0,
      ownershipDate: r.loanDate >= purchase ? r.loanDate : null,
    }))

    let cumP = 0
    let cumI = 0
    let cumFees = 0

    const cumSchedule = scheduleWithOwnership
      .filter(r => r.isOwned)
      .reduce((rows: any[], r: any) => {
        cumP += safeNum(r.principalPaid)
        cumI += safeNum(r.interest)
        cumFees += safeNum(r.feeThisMonth ?? 0)
        rows.push({
          ...r,
          cumPrincipal: +cumP.toFixed(2),
          cumInterest: +cumI.toFixed(2),
          cumFees: +cumFees.toFixed(2),
        })
        if (r.isTerminal === true) return rows
        return rows
      }, [])

    const roiSeries: RoiEntry[] = cumSchedule
      .filter((r: any) => r.isOwned)
      .map((r: any) => {
        const { ownershipPct, invested, lots } = getOwnershipBasis(l)

        const realized = (safeNum(r.cumPrincipal) + safeNum(r.cumInterest) - safeNum(r.cumFees)) * safeNum(ownershipPct)
        const unrealized = safeNum(r.balance) * 0.95 * safeNum(ownershipPct)
        const loanValue = realized + unrealized

        let roi = 0
        if (safeNum(invested) > 0) {
          roi = (loanValue - safeNum(invested)) / safeNum(invested)
        }

        if (!Number.isFinite(roi) || (roi === 0 && loanValue !== 0)) {
          console.warn(`[ROI-NaN] Loan ${l.id} @ month ${r.ownershipMonthIndex}: roi=${roi}, invested=${invested}`)
        }

        return {
          month: r.ownershipMonthIndex,
          date: r.loanDate,
          displayDate: r.displayDate,
          roi,
          loanValue,
          invested,
          ownershipPct,
          ownershipLots: lots,
          cumFees: safeNum(r.cumFees),
          realized,
          remainingBalance: safeNum(r.balance),
          unrealized,
          isTerminal: r.isTerminal === true,
        }
      })

    return {
      ...l,
      amort: { schedule: amortSchedule },
      scheduleWithOwnership,
      cumSchedule,
      balanceAtPurchase: amortSchedule.find((r: any) => r.loanDate >= purchase)?.balance ?? 0,
      roiSeries,
    }
  })
}