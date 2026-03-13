import { useMemo } from 'react'
import { useLoans } from './useLoans'
import { deriveLoansWithRoi, computeKPIs, buildProjectedRoiTimeline } from '../utils/roiEngine'
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

    const roiValues = loansWithRoi.map(l => {
      const last = l.roiSeries?.[l.roiSeries.length - 1]
      return last?.roi ?? 0
    })
    const roiSpread = roiValues.length >= 2
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
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)

    let totalPortfolioValue = 0
    let totalInvested = 0
    let rateWeightedSum = 0
    let monthlyIncome = 0

    loansWithRoi.forEach(l => {
      const sched = l.amort?.schedule ?? []
      const ownedRows = sched.filter((r: any) => r.isOwned !== false)
      const currentRow = sched.find((r: any) => {
        return r.loanDate &&
          r.loanDate.getFullYear() === today.getFullYear() &&
          r.loanDate.getMonth() === today.getMonth()
      }) || (ownedRows.length > 0 ? ownedRows[ownedRows.length - 1] : undefined)

      const balance = currentRow?.balance ?? 0
      const invested = Number(l.purchasePrice ?? 0)
      const rate = Number(l.nominalRate ?? 0)
      const ownershipPct = Number(l.ownershipPct ?? 0)

      totalPortfolioValue += balance * ownershipPct
      totalInvested += invested
      rateWeightedSum += rate * invested

      // Monthly income from next month's payment
      const nextRow = sched.find((r: any) => {
        return r.loanDate &&
          r.loanDate.getFullYear() === nextMonth.getFullYear() &&
          r.loanDate.getMonth() === nextMonth.getMonth()
      })
      if (nextRow) {
        monthlyIncome += (nextRow.payment ?? 0) * ownershipPct
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