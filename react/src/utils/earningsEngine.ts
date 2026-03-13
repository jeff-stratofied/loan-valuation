// ===============================
// earningsEngine.ts
// ===============================

import {
  addMonths,
  isDeferredMonth,
  GLOBAL_FEE_CONFIG,
  type AmortRow,
} from './loanEngine'
import { resolveFeeWaiverFlags } from '../utils/feePolicy'
  
  // =====================================================
  // Types
  // =====================================================
  
  export interface OwnershipLot {
    user: string
    pct: number
    purchaseDate: string
    pricePaid?: number
  }
  
  export interface EarningsRow extends AmortRow {
    loanDate: Date
    ownershipPct: number
    isOwned: boolean
    isFirstPeriod: boolean
    cumPrincipal: number
    cumInterest: number
    cumFees: number
    netEarnings: number
    monthlyPrincipal: number
    monthlyInterest: number
    monthlyFees: number
    monthlyNet: number
    feeThisMonth: number
    interestPaid: number
    principalPaid: number
    isDeferralMonth: boolean
  }
  
  export interface EarningsKPIs {
    totalNetToDate: number
    totalNetProjected: number
    totalFeesToDate: number
    totalFeesProjected: number
    totalPrincipal: number
    avgMonthlyNet: number
    monthsCounted: number
    projectedAvgMonthlyNet: number
    monthsThroughMaturity: number
    kpi2Rows: any[]
  }
  
  // =====================================================
  // Helpers
  // =====================================================
  
  function monthDiff(d1: Date, d2: Date): number {
    if (!(d1 instanceof Date) || !(d2 instanceof Date)) return 0
    return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth())
  }
  
  function parseISODateLocal(iso: string | Date | null | undefined): Date | null {
    if (iso instanceof Date) return iso
    if (!iso) return null
    if (typeof iso === 'string') {
      const [y, m, d] = iso.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    throw new Error(`[parseISODateLocal] Unsupported date input: ${String(iso)}`)
  }
  
  // =====================================================
  // Core: Build Earnings Schedule
  // =====================================================
  
  export function buildEarningsSchedule({
    amortSchedule,
    loanStartDate,
    ownershipLots = [],
    user
  }: {
    amortSchedule: AmortRow[]
    loanStartDate: string
    ownershipLots?: OwnershipLot[]
    user: string
    events?: any[]
    today: Date
  }): EarningsRow[] {
    if (!Array.isArray(amortSchedule) || amortSchedule.length === 0) return []
  
    const loanStart = parseISODateLocal(loanStartDate)
    if (!loanStart || !Number.isFinite(loanStart.getTime())) {
      throw new Error(`Invalid loanStartDate in earnings engine: ${loanStartDate}`)
    }
  
    const setupFeeAmount = GLOBAL_FEE_CONFIG?.setupFee ?? 0
    const monthlyRate = (GLOBAL_FEE_CONFIG?.monthlyServicingBps ?? 0) / 10000
  
    const { waiveSetup, waiveMonthly, waiveAll } = resolveFeeWaiverFlags(user, {})

    console.log('FEE FLAGS', {
      user,
      waiveSetup,
      waiveMonthly,
      waiveAll,
      setupFeeAmount,
      monthlyRate,
    })
  
    // Normalize rows with ownership
    const normalized = amortSchedule.map((row, idx) => {
      const loanDateRaw = addMonths(loanStart, row.monthIndex - 1)
      const loanDate = new Date(loanDateRaw.getFullYear(), loanDateRaw.getMonth(), 1)
  
      const ownershipPct = Array.isArray(ownershipLots)
        ? ownershipLots.reduce((sum, lot) => {
            if (!lot || lot.user !== user) return sum
            const start = parseISODateLocal(lot.purchaseDate)
            if (!(start instanceof Date) || !Number.isFinite(start.getTime())) return sum
            const startMonth = new Date(start.getFullYear(), start.getMonth(), 1)
            return loanDate >= startMonth ? sum + Number(lot.pct || 0) : sum
          }, 0)
        : 0
  
      return {
        ...row,
        loanDate,
        ownershipPct,
        isOwned: ownershipPct > 0,
        isFirstPeriod: idx === 0,
      }
    })
  
    // Accumulate earnings
    let cumPrincipal = 0
    let cumInterest = 0
    let cumFees = 0
    let prevCumPrincipal = 0
    let prevCumInterest = 0
    let prevCumFees = 0
  
    const earnings = normalized.map(row => {
      const deferred = isDeferredMonth(row as any)
  
      // Upfront fee — once per lot on its start month
      let upfrontFeeThisMonth = 0
      if (row.isOwned && Array.isArray(ownershipLots) && !waiveAll && !waiveSetup) {
        upfrontFeeThisMonth = ownershipLots.reduce((sum, lot) => {
          if (!lot || lot.user !== user) return sum
          const start = parseISODateLocal(lot.purchaseDate)
          if (!(start instanceof Date) || !Number.isFinite(start.getTime())) return sum
          const startMonth = new Date(start.getFullYear(), start.getMonth(), 1)
          if (row.loanDate.getTime() !== startMonth.getTime()) return sum
          return sum + setupFeeAmount * Number(lot.pct || 0)
        }, 0)
      }
  
      const balance = Number(row.balance ?? 0)
      const isPayingMonth = Number(row.payment || 0) > 0
  
      let monthlyBalanceFee = 0
      if (row.isOwned && balance > 0 && isPayingMonth && !waiveAll && !waiveMonthly) {
        monthlyBalanceFee = +((balance * monthlyRate) * Number(row.ownershipPct || 0)).toFixed(2)
      }
  
      const feeThisMonth = upfrontFeeThisMonth + monthlyBalanceFee
  
      let principalThisMonth = 0
      let interestThisMonth = 0
      let feesThisMonth = 0
  
      if (row.isOwned && !deferred) {
        const scale = Number(row.ownershipPct || 0)
        const scheduledPrincipal = Number(row.scheduledPrincipal || 0)
        const prepaymentPrincipal = Number(row.prepaymentPrincipal || 0)
        principalThisMonth = (scheduledPrincipal + prepaymentPrincipal) * scale
        interestThisMonth = (Number(row.payment || 0) > 0 ? Number(row.interest || 0) : 0) * scale
        feesThisMonth = feeThisMonth
      }
  
      if (deferred) {
        principalThisMonth = 0
        interestThisMonth = 0
        feesThisMonth = feeThisMonth
      }
  
      principalThisMonth = +Number(principalThisMonth || 0).toFixed(2)
      interestThisMonth = +Number(interestThisMonth || 0).toFixed(2)
      feesThisMonth = +Number(feesThisMonth || 0).toFixed(2)
  
      cumPrincipal = +(cumPrincipal + principalThisMonth).toFixed(2)
      cumInterest = +(cumInterest + interestThisMonth).toFixed(2)
      cumFees = +(cumFees + feesThisMonth).toFixed(2)
  
      const netEarnings = +(cumPrincipal + cumInterest - cumFees).toFixed(2)
  
      const monthlyPrincipal = +Number(principalThisMonth || 0).toFixed(2)
      const monthlyInterest = +(cumInterest - prevCumInterest).toFixed(2)
      const monthlyFees = +(cumFees - prevCumFees).toFixed(2)
      const monthlyNet = +(monthlyPrincipal + monthlyInterest - monthlyFees).toFixed(2)
  
      prevCumPrincipal = cumPrincipal
      prevCumInterest = cumInterest
      prevCumFees = cumFees

      
      return {
        ...row,
        cumPrincipal,
        cumInterest,
        cumFees,
        netEarnings,
        monthlyPrincipal,
        monthlyInterest,
        monthlyFees,
        monthlyNet,
        feeThisMonth,
        interestPaid: interestThisMonth,
        principalPaid: principalThisMonth,
        isDeferralMonth: deferred,
      }
    })
  
    const ownedEarnings = earnings.filter(
      r => r.isOwned === true && Number(r.ownershipPct || 0) > 0
    )
  
    if (ownedEarnings.length === 0) return []
  
    return ownedEarnings
      .map(r => {
        if (!(r.loanDate instanceof Date) || !Number.isFinite(r.loanDate.getTime())) {
          throw new Error('Invalid loanDate generated in earnings engine')
        }
        return r as EarningsRow
      })
      .sort((a, b) => +a.loanDate - +b.loanDate)
  }
  
  // =====================================================
  // Canonical Current Row
  // =====================================================
  
  export function getCanonicalCurrentEarningsRow(
    earningsSchedule: EarningsRow[],
    today: Date
  ): EarningsRow | null {
    if (!Array.isArray(earningsSchedule) || !earningsSchedule.length) return null
  
    const y = today.getFullYear()
    const m = today.getMonth()
  
    const match = earningsSchedule.find(
      r => r.loanDate && r.loanDate.getFullYear() === y && r.loanDate.getMonth() === m
    )
  
    if (match) return match
  
    const ownedRows = earningsSchedule.filter(r => r.isOwned)

    return (
      (ownedRows.length > 0 ? ownedRows[ownedRows.length - 1] : undefined) ||
      (earningsSchedule.length > 0 ? earningsSchedule[earningsSchedule.length - 1] : undefined) ||
      null
    )
  }
  
  // =====================================================
  // Portfolio KPIs
  // =====================================================
  
  export function computePortfolioEarningsKPIs(
    loansWithEarnings: any[],
    today: Date,
    portfolioStartDate: Date
  ): EarningsKPIs {
    let totalNetToDate = 0
    let totalNetProjected = 0
    let totalFeesToDate = 0
    let totalFeesProjected = 0
    let totalPrincipal = 0
  
    const kpi2Rows: any[] = []
    const monthlyNetByMonth = new Map<string, number>()
  
    loansWithEarnings.forEach(l => {
      totalPrincipal += Number(l.purchasePrice || 0) * Number(l.ownershipPct || 0)
  
      const sched: EarningsRow[] = Array.isArray(l.earningsSchedule) ? l.earningsSchedule : []
      if (!sched.length) return
  
      const atEnd = sched[sched.length - 1]
  
      kpi2Rows.push({
        loanId: l.loanId,
        loanName: l.loanName,
        school: l.school,
        netEarnings: Number(atEnd.netEarnings || 0),
        principal: Number(atEnd.cumPrincipal || 0),
        interest: Number(atEnd.cumInterest || 0),
        fees: -Number(atEnd.cumFees || 0),
      })
  
      totalNetProjected += Number(atEnd.netEarnings || 0)
      totalFeesProjected += Number(atEnd.cumFees || 0)
  
      let loanNetToDate = 0
      let loanFeesToDate = 0
  
      sched.forEach(r => {
        if (!r || r.isOwned !== true) return
        if (!(r.loanDate instanceof Date)) return
        if (r.loanDate > today) return
        loanNetToDate += Number(r.monthlyNet || 0)
        loanFeesToDate += Number(r.monthlyFees || 0)
      })
  
      totalNetToDate += loanNetToDate
      totalFeesToDate += loanFeesToDate
  
      sched.forEach(r => {
        if (!r || r.isOwned !== true) return
        if (!(r.loanDate instanceof Date) || !Number.isFinite(r.loanDate.getTime())) return
        if (r.loanDate > today) return
        const key = `${r.loanDate.getFullYear()}-${r.loanDate.getMonth()}`
        const prev = monthlyNetByMonth.get(key) || 0
        monthlyNetByMonth.set(key, prev + Number(r.monthlyNet || 0))
      })
    })
  
    let monthsCounted = 0
    if (portfolioStartDate instanceof Date && Number.isFinite(+portfolioStartDate)) {
      const start = new Date(portfolioStartDate.getFullYear(), portfolioStartDate.getMonth(), 1)
      const end = new Date(today.getFullYear(), today.getMonth(), 1)
      monthsCounted = Math.max(0, monthDiff(start, end) + 1)
    }
  
    const avgMonthlyNet = monthsCounted > 0 ? totalNetToDate / monthsCounted : 0
  
    const maxMonthsThroughMaturity = loansWithEarnings.reduce(
      (max, l) => Math.max(max, (l.earningsSchedule || []).length),
      0
    )
  
    const projectedAvgMonthlyNet =
      maxMonthsThroughMaturity > 0 ? totalNetProjected / maxMonthsThroughMaturity : 0
  
    return {
      totalNetToDate,
      totalNetProjected,
      totalFeesToDate,
      totalFeesProjected,
      totalPrincipal,
      avgMonthlyNet,
      monthsCounted,
      projectedAvgMonthlyNet,
      monthsThroughMaturity: maxMonthsThroughMaturity,
      kpi2Rows,
    }
  }