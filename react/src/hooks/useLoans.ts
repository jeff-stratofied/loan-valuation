import { useState, useEffect } from 'react'
import { buildAmortSchedule, setGlobalFeeConfig } from '../utils/loanEngine'
import { loadUsers } from '../utils/users'

const LOANS_URL = 'https://raw.githubusercontent.com/jeff-stratofied/loan-valuation/main/data/loans.json'
const PLATFORM_CONFIG_URL = 'https://loan-valuation-api.jeff-263.workers.dev/platformConfig'

const LOAN_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9',
  '#8b5cf6', '#f97316', '#14b8a6', '#ec4899', '#06b6d4',
  '#84cc16', '#a855f7', '#f43f5e', '#22d3ee', '#fb923c',
  '#4ade80', '#818cf8', '#fbbf24', '#34d399', '#fb7185',
]

export interface OwnershipLot {
  user: string
  pct: number
  purchaseDate: string
  pricePaid?: number
}

export interface LoanEvent {
  type: 'prepayment' | 'deferral' | 'default'
  date?: string
  amount?: number
  months?: number
  startDate?: string
  recovered?: number
}

export interface Loan {
  loanId: string
  loanName: string
  school: string
  loanStartDate: string
  purchaseDate: string
  principal: number
  purchasePrice: number
  nominalRate: number
  termYears: number
  graceYears: number
  balance: number
  ownershipPct: number
  ownershipLots: OwnershipLot[]
  events: LoanEvent[]
  loanColor: string
  visible: boolean
  isMarketLoan: boolean
  amort: { schedule: any[] }
}

function toFraction(pct: number): number {
  return pct > 1.5 ? pct / 100 : pct
}

function normalizeLoan(raw: any, index: number, userId: string): Loan | null {
  const loanId = String(raw.loanId ?? raw.id ?? 'unknown')
  const lots: OwnershipLot[] = Array.isArray(raw.ownershipLots) ? raw.ownershipLots : []
  const isMarket = userId === 'market'

  let ownershipPct: number
  let purchasePrice: number
  let purchaseDate: string

  if (isMarket) {
    const marketLots = lots.filter(l => String(l.user).toLowerCase() === 'market')
    ownershipPct = marketLots.reduce((sum, l) => sum + toFraction(Number(l.pct || 0)), 0)
    if (ownershipPct <= 0) return null
    purchasePrice = 0
    purchaseDate = raw.loanStartDate || raw.dateOnSystem || ''
  } else {
    const userLots = lots.filter(l => String(l.user).toLowerCase() === userId.toLowerCase())
    ownershipPct = userLots.reduce((sum, l) => sum + toFraction(Number(l.pct || 0)), 0)
    if (ownershipPct <= 0) return null
    purchasePrice = userLots.reduce((sum, l) => sum + Number(l.pricePaid || 0), 0)
    const lotDates = userLots.map(l => l.purchaseDate).filter(Boolean).sort()
    purchaseDate = lotDates[0] || raw.purchaseDate || raw.loanStartDate || ''
  }

  const principal = Number(raw.principal ?? raw.origPrincipalBal ?? 0)
  const nominalRate = Number(raw.nominalRate ?? raw.rate ?? 0) * 100
  const termYears = Number(raw.termYears ?? 0)
  const graceYears = Number(raw.graceYears ?? (raw.mosGraceElig ? raw.mosGraceElig / 12 : 0))
  const loanStartDate = raw.loanStartDate || raw.dateOnSystem || ''
  const events = Array.isArray(raw.events) ? raw.events : []

  const loanCore = {
    loanId,
    loanName: raw.loanName || '',
    principal,
    nominalRate,
    termYears,
    graceYears,
    loanStartDate,
    purchaseDate,
    events,
  }

  const schedule = buildAmortSchedule(loanCore)
  const lastRow = schedule[schedule.length - 1]
  const balance = lastRow?.balance ?? 0

  return {
    loanId,
    loanName: raw.loanName || '',
    school: raw.school || raw.originalSchoolName || '',
    loanStartDate,
    purchaseDate,
    principal,
    purchasePrice,
    nominalRate,
    termYears,
    graceYears,
    balance,
    ownershipPct,
    ownershipLots: lots,
    events,
    loanColor: LOAN_COLORS[index % LOAN_COLORS.length],
    visible: raw.visible !== false,
    isMarketLoan: isMarket,
    amort: { schedule },
  }
}

export function useLoans(userId: string) {
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    setError(null)

    // Fetch loans and platformConfig in parallel
    Promise.all([
      fetch(LOANS_URL).then(res => {
        if (!res.ok) throw new Error(`Fetch error: ${res.status}`)
        return res.json()
      }),
      fetch(PLATFORM_CONFIG_URL, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`platformConfig fetch failed: ${res.status}`)
        return res.json()
      }).catch(err => {
        console.warn('platformConfig fetch failed, using defaults:', err)
        return { fees: { setupFee: 150, monthlyServicingBps: 25 }, users: [] }
      }),
    ])
      .then(([loansData, platformData]) => {
        // Set global fee config so earningsEngine can compute fees
        if (platformData?.fees) {
          setGlobalFeeConfig({
            setupFee: Number(platformData.fees.setupFee ?? 150),
            monthlyServicingBps: Number(platformData.fees.monthlyServicingBps ?? 25),
          })
        }

        // Load users so feePolicy can resolve fee waivers by userId
        loadUsers()

        const raw: any[] = Array.isArray(loansData)
          ? loansData
          : Array.isArray(loansData.loans)
          ? loansData.loans
          : []
        const normalized = raw
          .map((l, i) => normalizeLoan(l, i, userId))
          .filter((l): l is Loan => l !== null && l.visible)
        setLoans(normalized)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [userId])

  return { loans, loading, error }
}
