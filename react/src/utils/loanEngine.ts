// ===============================
// loanEngine.ts
// ===============================

import { resolveFeeWaiverFlags } from '../utils/feePolicy'

// ===============================
// Types
// ===============================

export interface LoanEvent {
  type: 'prepayment' | 'deferral' | 'default'
  date?: string
  amount?: number
  months?: number
  startDate?: string
  recoveryAmount?: number
}

export interface AmortRow {
  monthIndex: number
  loanDate: Date
  displayDate: Date
  payment: number
  scheduledPrincipal: number
  prepaymentPrincipal: number
  principalPaid: number
  prepayment: number
  interest: number
  balance: number
  accruedInterest: number
  feeThisMonth: number
  isDeferred: boolean
  deferralIndex: number | null
  deferralRemaining: number | null
  isOwned: boolean
  ownershipDate: Date | null
  defaulted?: boolean
  isTerminal?: boolean
  isPaidOff?: boolean
  maturityDate?: Date
  recovery?: number
  contractualMonth: number
  cumPrincipal: number
  cumInterest: number
  cumPayment: number
}

export interface LoanInput {
  loanId?: string
  loanName?: string
  principal: number
  nominalRate: number
  termYears: number
  graceYears: number
  loanStartDate: string
  purchaseDate?: string
  events?: LoanEvent[]
  feeConfig?: FeeConfig
  userId?: string
}

export interface FeeConfig {
  setupFee: number
  monthlyServicingBps: number
}

// ===============================
// Global Fee Config
// ===============================

export let GLOBAL_FEE_CONFIG: FeeConfig | null = null

export function setGlobalFeeConfig(fees: FeeConfig) {
  GLOBAL_FEE_CONFIG = fees
}

export function getMonthlyServicingRate(feeConfig: FeeConfig): number {
  return Number(feeConfig.monthlyServicingBps || 0) / 10000
}

// ===============================
// Date Helpers
// ===============================

function parseISODateLocal(iso: string | Date | null | undefined): Date | null {
  if (iso instanceof Date) return iso
  if (!iso) return null
  if (typeof iso === 'string') {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }
  return null
}

function normalizeDate(d: string): string {
  if (!d) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  console.warn('Unrecognized date format:', d)
  return d
}

export function addMonths(date: Date, n: number): Date {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('addMonths called with invalid Date')
  }
  return new Date(date.getFullYear(), date.getMonth() + n, 1)
}

export function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthKeyFromISO(iso: string): string {
  return iso.slice(0, 7)
}

function getEffectivePurchaseDate(loan: any): Date {
  return (
    parseISODateLocal(loan.purchaseDate) ||
    parseISODateLocal(loan.loanStartDate) ||
    new Date()
  )
}

// ===============================
// Portfolio Helpers
// ===============================

export function getPortfolioStartDate(loans: any[] = []): Date {
  const dates = loans
    .map(l => {
      const d = l.loanStartDate || l.purchaseDate
      if (!d) return null
      const dt = new Date(d + 'T00:00:00')
      return Number.isFinite(dt.getTime()) ? dt : null
    })
    .filter(Boolean) as Date[]

  if (!dates.length) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }

  const min = new Date(Math.min(...dates.map(d => d.getTime())))
  min.setHours(0, 0, 0, 0)
  return min
}

export function getStandardToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// ===============================
// Amort Row Helpers
// ===============================

function getTotalPrincipalPaid(r: AmortRow): number {
  return r.principalPaid ?? (r.scheduledPrincipal + r.prepaymentPrincipal)
}

function normalizeDeferralFlags(row: any): any {
  row.isDeferred =
    row.isDeferred === true || row.deferral === true || row.deferred === true
  delete row.deferral
  delete row.deferred
  return row
}

export function isDeferredMonth(row: AmortRow): boolean {
  return row?.isDeferred === true
}

export function getCanonicalCurrentAmortRow(
  schedule: AmortRow[],
  today: Date = new Date()
): AmortRow | null {
  if (!schedule?.length) return null

  const y = today.getFullYear()
  const m = today.getMonth()

  const match = schedule.find(
    r =>
      r.loanDate &&
      r.loanDate.getFullYear() === y &&
      r.loanDate.getMonth() === m &&
      r.isOwned !== false
  )

  if (match) return match

const ownedRows = schedule.filter(r => r.isOwned !== false)

return ownedRows.length > 0
  ? ownedRows[ownedRows.length - 1]
  : schedule.length > 0
    ? schedule[schedule.length - 1]
    : null
}

export function getCurrentLoanBalance(loan: any, today: Date = new Date()): number {
  const sched = loan?.amort?.schedule || loan?.cumSchedule || []
  const row = getCanonicalCurrentAmortRow(sched, today)
  return Number(row?.balance || 0)
}

export function getCurrentScheduleIndex(loan: any, asOf: Date = new Date()): number {
  if (!loan?.amort?.schedule?.length) return 1

  const purchaseRaw = loan.purchaseDate || loan.loanStartDate || null
  const purchase = parseISODateLocal(purchaseRaw) || new Date()

  const purchaseMonth = new Date(purchase.getFullYear(), purchase.getMonth(), 1)
  const asOfMonth = new Date(asOf.getFullYear(), asOf.getMonth(), 1)

  const months =
    (asOfMonth.getFullYear() - purchaseMonth.getFullYear()) * 12 +
    (asOfMonth.getMonth() - purchaseMonth.getMonth()) +
    1

  return Math.min(Math.max(1, months), loan.amort.schedule.length)
}

// ===============================
// Core: Build Amortization Schedule
// ===============================

export function buildAmortSchedule(loan: LoanInput): AmortRow[] {
  const {
    principal,
    nominalRate,
    termYears,
    graceYears,
    loanStartDate,
    purchaseDate,
    events = [],
    feeConfig,
    userId,
  } = loan

  const monthlyRate = nominalRate / 100 / 12
  const graceMonths = graceYears * 12
  const repaymentMonths = termYears * 12
  const totalMonths = graceMonths + repaymentMonths

  const originalMonthlyPayment =
    repaymentMonths > 0
      ? (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -repaymentMonths))
      : 0

  const start = parseISODateLocal(normalizeDate(loanStartDate))
  if (!start || !Number.isFinite(start.getTime())) {
    throw new Error(
      `Invalid loanStartDate for loan "${loan.loanName}": ${loan.loanStartDate}`
    )
  }

  let purchase = parseISODateLocal(normalizeDate(purchaseDate || ''))
  if (!purchase || !Number.isFinite(purchase.getTime())) {
    purchase = start
  }

  const purchaseMonth = new Date(purchase.getFullYear(), purchase.getMonth(), 1)

  const resolvedFeeConfig: FeeConfig =
    feeConfig || GLOBAL_FEE_CONFIG || { setupFee: 0, monthlyServicingBps: 0 }

  const SETUP_FEE_AMOUNT = Number(resolvedFeeConfig.setupFee || 0)
  const MONTHLY_SERVICING_RATE = getMonthlyServicingRate(resolvedFeeConfig)
  const feeFlags = resolveFeeWaiverFlags(userId ?? '', loan)

  // Event maps
  const prepayMap: Record<string, LoanEvent[]> = {}
  events
    .filter(e => e.type === 'prepayment' && e.date)
    .forEach(e => {
      const key = monthKeyFromISO(e.date!)
      if (!prepayMap[key]) prepayMap[key] = []
      prepayMap[key].push(e)
    })

  const deferralStartMap: Record<string, number> = {}
  events
    .filter(e => e.type === 'deferral' && (e.startDate || e.date) && Number(e.months) > 0)
    .forEach(e => {
      const key = monthKeyFromISO(e.startDate || e.date!)
      const m = Math.max(0, Math.floor(Number(e.months) || 0))
      deferralStartMap[key] = (deferralStartMap[key] || 0) + m
    })

  const defaultEvent = events.find(e => e.type === 'default' && e.date)
  const defaultMonthKey = defaultEvent ? monthKeyFromISO(defaultEvent.date!) : null
  const defaultRecovery = defaultEvent ? Number(defaultEvent.recoveryAmount || 0) : 0

  const schedule: any[] = []
  let balance = Number(principal || 0)
  let calendarDate = new Date(start.getFullYear(), start.getMonth(), 1)
  let deferralRemaining = 0
  let deferralTotal = 0

  for (let i = 0; i < totalMonths; ) {
    const loanDate = new Date(calendarDate)
    const isOwned = loanDate >= purchaseMonth
    const isFirstOwnedMonth =
      isOwned &&
      loanDate.getFullYear() === purchaseMonth.getFullYear() &&
      loanDate.getMonth() === purchaseMonth.getMonth()

    let feeThisMonth = 0
    if (isFirstOwnedMonth && !feeFlags.waiveSetup && !feeFlags.waiveAll) {
      feeThisMonth += SETUP_FEE_AMOUNT
    }
    if (isOwned && !feeFlags.waiveMonthly && !feeFlags.waiveAll) {
      feeThisMonth += balance * MONTHLY_SERVICING_RATE
    }

    // DEFAULT
    if (defaultMonthKey && monthKeyFromDate(calendarDate) === defaultMonthKey) {
      const applied = Math.min(balance, defaultRecovery)
      balance -= applied

      schedule.push(
        normalizeDeferralFlags({
          monthIndex: schedule.length + 1,
          loanDate,
          displayDate: new Date(loanDate.getFullYear(), loanDate.getMonth(), 1),
          payment: +applied.toFixed(2),
          scheduledPrincipal: 0,
          prepaymentPrincipal: +applied.toFixed(2),
          principalPaid: +applied.toFixed(2),
          interest: 0,
          balance: +balance.toFixed(2),
          accruedInterest: 0,
          feeThisMonth: +feeThisMonth.toFixed(2),
          prepayment: 0,
          isOwned,
          ownershipDate: isOwned ? loanDate : null,
          defaulted: true,
          isTerminal: true,
          recovery: +applied.toFixed(2),
          contractualMonth: i + 1,
        })
      )
      break
    }

    // DEFERRAL START
    const startKey = monthKeyFromDate(calendarDate)
    if (deferralRemaining === 0 && deferralStartMap[startKey]) {
      deferralRemaining = deferralStartMap[startKey]
      deferralTotal = deferralStartMap[startKey]
    }

    // DEFERRAL MONTH
    if (deferralRemaining > 0) {
      const accruedInterest = balance * monthlyRate
      balance += accruedInterest

      const key = monthKeyFromDate(loanDate)
      const monthEvents = prepayMap[key] || []
      let prepaymentThisMonth = 0
      monthEvents.forEach(e => {
        const amt = Number(e.amount || 0)
        if (amt > 0) {
          const applied = Math.min(balance, amt)
          prepaymentThisMonth += applied
          balance -= applied
        }
      })

      schedule.push(
        normalizeDeferralFlags({
          monthIndex: schedule.length + 1,
          loanDate,
          displayDate: new Date(loanDate.getFullYear(), loanDate.getMonth(), 1),
          payment: 0,
          scheduledPrincipal: 0,
          prepaymentPrincipal: +prepaymentThisMonth.toFixed(2),
          principalPaid: +prepaymentThisMonth.toFixed(2),
          prepayment: +prepaymentThisMonth.toFixed(2),
          interest: 0,
          balance: +balance.toFixed(2),
          accruedInterest: +accruedInterest.toFixed(2),
          feeThisMonth: +feeThisMonth.toFixed(2),
          isDeferred: true,
          deferralIndex: deferralTotal - deferralRemaining,
          deferralRemaining,
          isOwned,
          ownershipDate: isOwned ? loanDate : null,
          contractualMonth: i + 1,
        })
      )

      deferralRemaining--
      calendarDate = addMonths(calendarDate, 1)
      i++
      continue
    }

    // NORMAL MONTH
    const interest = balance * monthlyRate
    let scheduledPrincipal = 0
    let paymentAmt = 0

    const monthsSinceLoanStart =
      (calendarDate.getFullYear() - start.getFullYear()) * 12 +
      (calendarDate.getMonth() - start.getMonth())

    if (monthsSinceLoanStart < graceMonths) {
      balance += interest
    } else {
      paymentAmt = originalMonthlyPayment
      scheduledPrincipal = Math.min(paymentAmt - interest, balance)
      balance = Math.max(0, balance - scheduledPrincipal)
      if (balance <= 0.01) balance = 0
    }

    const eventKey = monthKeyFromDate(loanDate)
    const monthEvents = prepayMap[eventKey] || []
    let prepaymentThisMonth = 0
    monthEvents.forEach(e => {
      const amt = Number(e.amount || 0)
      if (amt > 0) {
        const applied = Math.min(balance, amt)
        prepaymentThisMonth += applied
        balance -= applied
      }
    })

    schedule.push(
      normalizeDeferralFlags({
        monthIndex: schedule.length + 1,
        loanDate,
        displayDate: new Date(loanDate.getFullYear(), loanDate.getMonth(), 1),
        payment: +paymentAmt.toFixed(2),
        scheduledPrincipal: +scheduledPrincipal.toFixed(2),
        prepaymentPrincipal: +prepaymentThisMonth.toFixed(2),
        principalPaid: +(scheduledPrincipal + prepaymentThisMonth).toFixed(2),
        prepayment: +prepaymentThisMonth.toFixed(2),
        interest: +interest.toFixed(2),
        balance: +balance.toFixed(2),
        accruedInterest: 0,
        feeThisMonth: +feeThisMonth.toFixed(2),
        isDeferred: false,
        deferralIndex: null,
        deferralRemaining: null,
        isOwned,
        ownershipDate: isOwned ? loanDate : null,
        contractualMonth: i + 1,
      })
    )

    calendarDate = addMonths(calendarDate, 1)
    i++

    if (balance <= 0) {
      schedule[schedule.length - 1].isTerminal = true
      schedule[schedule.length - 1].isPaidOff = true
      schedule[schedule.length - 1].maturityDate = calendarDate
      break
    }
  }

  // Cumulative fields
  let cumP = 0
  let cumI = 0
  let cumPay = 0
  schedule.forEach(r => {
    if (r.isOwned !== false) {
      cumP += r.principalPaid
      cumI += r.interest
      cumPay += r.payment
    }
    r.cumPrincipal = +cumP.toFixed(2)
    r.cumInterest = +cumI.toFixed(2)
    r.cumPayment = +cumPay.toFixed(2)
  })

  if (schedule.length) {
    const last = schedule[schedule.length - 1]
    last.isPaidOff = last.balance <= 0
  }

  return schedule as AmortRow[]
}

// ===============================
// Attach Schedules
// ===============================

export function attachSchedules(loans: LoanInput[]): any[] {
  return loans.map(loan => ({
    ...loan,
    amort: { schedule: buildAmortSchedule(loan) },
  }))
}

// ===============================
// Portfolio Views
// ===============================

export function buildPortfolioViews(loansWithAmort: any[]) {
  const TODAY = new Date()
  const nextMonthDate = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 1)

  function sameMonthYear(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth()
  }

  function calcMonthlyExpectedIncome(targetMonthDate: Date): number {
    return loansWithAmort.reduce((sum, loan) => {
      const purchase = getEffectivePurchaseDate(loan)
      return (
        sum +
        loan.amort.schedule
          .filter((r: AmortRow) => {
            const owned = r.loanDate >= purchase
            return sameMonthYear(r.loanDate, targetMonthDate) && owned
          })
          .reduce((s: number, r: AmortRow) => s + r.payment, 0)
      )
    }, 0)
  }

  const forwardMonths = 24
  const incomeLabels: string[] = []
  const incomePayments: number[] = []

  for (let i = 0; i < forwardMonths; i++) {
    const d = new Date(nextMonthDate)
    d.setMonth(d.getMonth() + i)
    incomeLabels.push(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))
    incomePayments.push(calcMonthlyExpectedIncome(d))
  }

  const monthlyIncomeKpi = calcMonthlyExpectedIncome(nextMonthDate)

  // ROI Series
  const roiSeries: Record<string, any[]> = {}
  const roiKpis: Record<string, number> = {}

  loansWithAmort.forEach(loan => {
    const purchase = getEffectivePurchaseDate(loan)
    const purchasePrice = Number(loan.purchasePrice ?? loan.principal ?? 0)

    let cumInterest = 0
    let cumPrincipal = 0
    let cumFees = 0

    roiSeries[loan.loanId || loan.id] = loan.amort.schedule
      .filter((r: AmortRow) => r.loanDate >= purchase)
      .map((r: AmortRow) => {
        cumInterest += r.interest
        cumPrincipal += getTotalPrincipalPaid(r)
        cumFees += Number(r.feeThisMonth ?? 0)

        const realized = cumPrincipal + cumInterest - cumFees
        const unrealized = r.balance * 0.95
        const loanValue = realized + unrealized
        const roi = purchasePrice ? (loanValue - purchasePrice) / purchasePrice : 0

        return {
          date: r.loanDate,
          month: r.monthIndex,
          roi,
          loanValue,
          realized,
          unrealized,
          balance: r.balance,
          cumInterest,
          cumPrincipal,
          cumFees,
          ownershipDate: r.ownershipDate,
        }
      })

    const series = roiSeries[loan.loanId || loan.id]
    roiKpis[loan.loanId || loan.id] = series.length > 0 ? series[series.length - 1].roi : 0
  })

  // Earnings Timeline
  const earningsTimeline: Record<string, any[]> = {}
  const earningsKpis: Record<string, number> = {}

  loansWithAmort.forEach(loan => {
    const purchase = getEffectivePurchaseDate(loan)

    let cumPrincipal = 0
    let cumInterest = 0
    let cumFees = 0

    const timeline = loan.amort.schedule.map((r: AmortRow) => {
      const owned = r.loanDate >= purchase
      const principal = owned ? getTotalPrincipalPaid(r) : 0
      const interest = owned ? r.interest : 0
      const fees = owned ? Number(r.feeThisMonth ?? 0) : 0

      cumPrincipal += principal
      cumInterest += interest
      cumFees += fees

      return {
        loanDate: r.loanDate,
        monthIndex: r.monthIndex,
        isOwned: owned,
        ownershipDate: owned ? r.loanDate : null,
        isDeferred: r.isDeferred === true,
        defaulted: r.defaulted === true,
        monthlyPrincipal: principal,
        monthlyInterest: interest,
        monthlyFees: fees,
        monthlyNet: principal + interest - fees,
        cumPrincipal,
        cumInterest,
        cumFees,
        netEarnings: cumPrincipal + cumInterest - cumFees,
        balance: r.balance,
      }
    })

    const firstOwnedIdx = timeline.findIndex((r: any) => r.isOwned === true)
    loan.displayEarningsTimeline = firstOwnedIdx >= 0 ? timeline.slice(firstOwnedIdx) : []

    earningsTimeline[loan.loanId || loan.id] = timeline
    earningsKpis[loan.loanId || loan.id] =
      timeline.length > 0 ? timeline[timeline.length - 1].netEarnings : 0
  })

  // KPIs
  const totalInvested = loansWithAmort.reduce((sum, loan) => sum + loan.principal, 0)
  const portfolioValue = loansWithAmort.reduce((sum, loan) => {
    const last = loan.amort.schedule[loan.amort.schedule.length - 1]
    return sum + (last?.balance ?? 0)
  }, 0)

  return {
    loans: loansWithAmort,
    incomeLabels,
    incomePayments,
    amortKpis: {
      totalInvested,
      portfolioValue,
      monthlyIncomeKpi,
      nextMonthLabel: nextMonthDate.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      }),
    },
    roiSeries,
    roiKpis,
    earningsTimeline,
    earningsKpis,
  }
}