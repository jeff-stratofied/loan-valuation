import { useMemo } from 'react'
import { useLoans } from './useLoans'
import { deriveLoansWithRoi, computeKPIs, buildProjectedRoiTimeline,getRoiEntryAsOfMonth } from '../utils/roiEngine'
import { buildEarningsSchedule, computePortfolioEarningsKPIs } from '../utils/earningsEngine'
import { getPortfolioStartDate } from '../utils/loanEngine'

export interface RoiKpis {
  weightedRoi: number
  projectedWeightedRoi: number
  capitalRecoveryPct: number
  roiSpread: number
}

export interface EarningsKpis {
  netEarningsToDate: number
  projectedLifetimeEarnings: number
  avgMonthlyEarningsToDate: number
  projectedAvgMonthlyEarnings: number
}

export interface AmortKpis {
  totalPortfolioValue: number
  avgRate: number
  monthlyIncome: number
  totalInvested: number
}

export interface PortfolioData {
  roiKpis: RoiKpis
  earningsKpis: EarningsKpis
  amortKpis: AmortKpis
  roiTimeline: {
    dates: Date[]
    perLoanSeries: any[]
    weightedSeries: { date: Date; y: number }[]
  }
  earningsTimeline: any[]
  earningsRows: any[]
  loansWithRoi: any[]
  loading: boolean
  error: string | null
}

const TODAY = new Date()
const KPI_CURRENT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)

export function usePortfolio(userId: string): PortfolioData {
  const { loans, loading, error } = useLoans(userId)

  const portfolio = useMemo((): Omit<PortfolioData, 'loading' | 'error'> => {
    if (!loans.length) {
      return {
        roiKpis: { weightedRoi: 0, projectedWeightedRoi: 0, capitalRecoveryPct: 0, roiSpread: 0 },
        earningsKpis: { netEarningsToDate: 0, projectedLifetimeEarnings: 0, avgMonthlyEarningsToDate: 0, projectedAvgMonthlyEarnings: 0 },
        amortKpis: { totalPortfolioValue: 0, avgRate: 0, monthlyIncome: 0, totalInvested: 0 },
        roiTimeline: { dates: [], perLoanSeries: [], weightedSeries: [] },
        earningsTimeline: [],
        earningsRows: [],
        loansWithRoi: [],
      }
    }

    // ─── 1. Normalize loans for roiEngine (field name mapping) ───────────
    const normalizedLoans = loans.map(l => ({
      ...l,
      id: l.loanId,
      name: l.loanName,
      userPurchasePrice: l.purchasePrice,
      userOwnershipPct: l.ownershipPct,
    }))

    // ─── 2. Derive loans with ROI series ──────────────────────────────────
    const loansWithRoi = deriveLoansWithRoi(normalizedLoans)

    console.log(
      'PORTFOLIO LOANS',
      loansWithRoi.map(l => ({
        loanId: l.loanId,
        id: l.id,
        name: l.loanName,
      }))
    )

    // ─── 3. Build color map ───────────────────────────────────────────────
    const BASE_COLORS = [
      '#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#ea580c',
      '#0891b2', '#ca8a04', '#be185d', '#15803d', '#1d4ed8',
      '#9333ea', '#b91c1c',
    ]
    const sortedIds = loansWithRoi
      .map(l => l.id ?? l.loanId)
      .sort((a, b) => String(a).localeCompare(String(b)))
    const colorMap: Record<string, string> = {}
    sortedIds.forEach((id, i) => {
      colorMap[id] = BASE_COLORS[i % BASE_COLORS.length]
    })

    // ─── 4. ROI KPIs ──────────────────────────────────────────────────────
    const roiEngineKpis = computeKPIs(loansWithRoi, KPI_CURRENT_MONTH)

const roiValues = loansWithRoi.map((l) => {
  const entry = getRoiEntryAsOfMonth(l, KPI_CURRENT_MONTH)
  return Number(entry?.roi ?? 0)
})

const roiSpread =
  roiValues.length >= 2
    ? (Math.max(...roiValues) - Math.min(...roiValues)) * 100
    : 0

    const roiKpis: RoiKpis = {
      weightedRoi: roiEngineKpis.weightedROI * 100,
      projectedWeightedRoi: roiEngineKpis.projectedWeightedROI * 100,
      capitalRecoveryPct: roiEngineKpis.capitalRecoveryPct * 100,
      roiSpread,
    }

    // ─── 5. ROI timeline for chart ────────────────────────────────────────
    const roiTimeline = buildProjectedRoiTimeline(loansWithRoi, { colorMap })

    // Attach colors from colorMap to perLoanSeries
    roiTimeline.perLoanSeries.forEach((s: any) => {
      if (!s.color) s.color = colorMap[String(s.id)] || '#64748b'
    })

    // ─── 6. Earnings ──────────────────────────────────────────────────────
    const loansWithEarnings = loansWithRoi.map(l => {
      const earningsSchedule = buildEarningsSchedule({
        amortSchedule: l.amort?.schedule ?? [],
        loanStartDate: l.loanStartDate,
        ownershipLots: l.ownershipLots ?? [],
        user: userId,
        events: l.events ?? [],
        today: TODAY,
      })
    
      console.log('EARNINGS DEBUG', {
        user: userId,
        loanId: String(l.loanId ?? l.id ?? ''),
        name: l.loanName ?? l.name,
        ownershipLots: l.ownershipLots,
        matchingLots: (l.ownershipLots ?? []).filter((lot: any) => lot?.user === userId),
        ownershipPctOnRows: earningsSchedule.slice(0, 6).map((r: any) => ({
          date: r.loanDate,
          ownershipPct: r.ownershipPct,
          isOwned: r.isOwned,
          monthlyFees: r.monthlyFees,
          feeThisMonth: r.feeThisMonth,
        })),
      })
    
      return { ...l, earningsSchedule }
    })

    const portfolioStartDate = getPortfolioStartDate(loansWithEarnings)
    const earningsKpisRaw = computePortfolioEarningsKPIs(
      loansWithEarnings,
      TODAY,
      portfolioStartDate
    )

    const earningsKpis: EarningsKpis = {
      netEarningsToDate: earningsKpisRaw.totalNetToDate,
      projectedLifetimeEarnings: earningsKpisRaw.totalNetProjected,
      avgMonthlyEarningsToDate: earningsKpisRaw.avgMonthlyNet,
      projectedAvgMonthlyEarnings: earningsKpisRaw.projectedAvgMonthlyNet,
    }

    // Earnings timeline (flat array of all rows across loans, sorted by date)
    const earningsRows = loansWithEarnings.flatMap(l => l.earningsSchedule ?? [])
    const earningsTimeline = loansWithEarnings.map(l => ({
      loanId: l.loanId,
      loanName: l.loanName,
      color: colorMap[l.id] || '#64748b',
      rows: l.earningsSchedule ?? [],
    }))

    // ─── 7. Amort KPIs ────────────────────────────────────────────────────
    const today = new Date()
    const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)

    function monthKeyFromDate(d: Date): string {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }

    function getLoanCurrentTpv(loan: any): number {
      const sched = (loan.amort?.schedule ?? []).filter(
        (r: any) => r.isOwned && r.loanDate instanceof Date
      )
      if (!sched.length) return 0

      let cumP = 0
      let cumI = 0
      const series: Record<string, number> = {}

      for (const r of sched) {
        const d = r.loanDate as Date
        const key = monthKeyFromDate(d)

        cumP += Number(r.scheduledPrincipal ?? r.principalPaid ?? r.principal ?? 0)
        cumP += Number(r.prepaymentPrincipal ?? r.prepayment ?? 0)
        cumI += Number(r.interest ?? 0)

        const balance = Number(r.balance ?? 0)
        const ownershipPct = Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)

        series[key] = (cumP + cumI) * ownershipPct + balance * ownershipPct * 0.95
      }

      const keys = Object.keys(series).sort()
      if (!keys.length) return 0

      const lastKey = keys[keys.length - 1]

      // after maturity / final schedule month, TPV should be 0
      if (currentMonthKey > lastKey) return 0

      // exact month
      if (series[currentMonthKey] != null) return Number(series[currentMonthKey] || 0)

      // otherwise latest prior month only while the loan is still active
      const fallbackKey = keys.filter((k) => k <= currentMonthKey).pop()
      return fallbackKey ? Number(series[fallbackKey] || 0) : 0
    }

    let totalPortfolioValue = 0
    let totalInvested = 0
    let rateWeightedSum = 0
    let monthlyIncome = 0

    loansWithRoi.forEach(l => {
      const sched = l.amort?.schedule ?? []
      const invested = Number(l.purchasePrice ?? 0)
      const rate = Number(l.nominalRate ?? 0)
      const ownershipPct = Number(l.ownershipPct ?? l.userOwnershipPct ?? 1)

      totalPortfolioValue += getLoanCurrentTpv(l)
      totalInvested += invested
      rateWeightedSum += rate * invested

      const nextRow = sched.find((r: any) => {
        return r.isOwned !== false &&
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === nextMonth.getFullYear() &&
          r.loanDate.getMonth() === nextMonth.getMonth()
      })

      if (nextRow) {
        monthlyIncome += Number(nextRow.payment ?? 0) * ownershipPct
      }
    })

    const avgRate = totalInvested > 0 ? (rateWeightedSum / totalInvested) * 100 : 0

    const amortKpis: AmortKpis = {
      totalPortfolioValue,
      avgRate,
      monthlyIncome,
      totalInvested,
    }

    return {
      roiKpis,
      earningsKpis,
      amortKpis,
      roiTimeline,
      earningsTimeline,
      earningsRows,
      loansWithRoi: loansWithEarnings,
    }
  }, [loans, userId])

  return {
    ...portfolio,
    loading,
    error,
  }
}
