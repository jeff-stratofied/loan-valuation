/**
 * Ported from loanEngine.js
 * nominalRate expected as PERCENTAGE (e.g. 10.0 for 10%)
 */

export interface AmortRow {
    monthIndex: number
    loanDate: Date
    payment: number
    interest: number
    scheduledPrincipal: number
    prepaymentPrincipal: number
    balance: number
    isDeferred: boolean
    isOwned: boolean
    eventType?: string
  }
  
  interface LoanInput {
    loanId: string
    loanName: string
    principal: number
    nominalRate: number
    termYears: number
    graceYears: number
    loanStartDate: string
    purchaseDate: string
    events: {
      type: string
      date?: string
      amount?: number
      months?: number
      startDate?: string
      recovered?: number
    }[]
  }
  
  // Always anchor to 1st of month to avoid day-overflow bugs
  function parseLocalDate(iso: string): Date {
    if (!iso) return new Date(NaN)
    const [y, m] = iso.split('-').map(Number)
    return new Date(y, m - 1, 1)
  }
  
  // Safe month addition — always stays on 1st of month
  function addMonths(date: Date, n: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + n, 1)
  }
  
  // YYYY-MM key from Date
  function monthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
  
  // YYYY-MM key directly from ISO string — avoids any parsing ambiguity
  function monthKeyFromISO(iso: string): string {
    return iso.slice(0, 7)
  }
  
  export function buildAmortSchedule(loan: LoanInput): AmortRow[] {
    const {
      principal,
      nominalRate,
      termYears,
      graceYears,
      loanStartDate,
      purchaseDate,
      events = [],
    } = loan
  
    const monthlyRate = (nominalRate / 100) / 12
    const graceMonths = Math.round(graceYears * 12)
    const repaymentMonths = termYears * 12
    const totalMonths = graceMonths + repaymentMonths
  
    const start = parseLocalDate(loanStartDate)
    let purchase = parseLocalDate(purchaseDate)
    if (isNaN(purchase.getTime())) purchase = start
    const purchaseMonth = new Date(purchase.getFullYear(), purchase.getMonth(), 1)
  
    // Build event maps using YYYY-MM keys
    const prepayMap: Record<string, number> = {}
    events
      .filter(e => e.type === 'prepayment' && e.date)
      .forEach(e => {
        const key = monthKeyFromISO(e.date!)
        prepayMap[key] = (prepayMap[key] || 0) + Number(e.amount || 0)
      })
  
    const deferralMap: Record<string, number> = {}
    events
      .filter(e => e.type === 'deferral' && (e.startDate || e.date) && Number(e.months) > 0)
      .forEach(e => {
        const key = monthKeyFromISO((e.startDate || e.date)!)
        deferralMap[key] = (deferralMap[key] || 0) + Math.floor(Number(e.months))
      })
  
    const defaultEvent = events.find(e => e.type === 'default' && e.date)
  
    // Total deferral months across all deferral events
    const totalDeferralMonths = Object.values(deferralMap).reduce((s, v) => s + v, 0)
  
    // Simulate grace + deferral interest accrual to get the balance repayment starts from.
    // This ensures the monthly payment is sized correctly to reach $0 at term end.
    const accrualMonths = graceMonths + totalDeferralMonths
    let postAccrualBalance = Number(principal)
    for (let g = 0; g < accrualMonths; g++) {
      postAccrualBalance *= (1 + monthlyRate)
    }
  
    // Payment calculated on post-accrual balance
    const originalMonthlyPayment =
      repaymentMonths > 0 && monthlyRate > 0
        ? (postAccrualBalance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -repaymentMonths))
        : repaymentMonths > 0 ? postAccrualBalance / repaymentMonths : 0
  
    let balance = Number(principal)
    let deferralMonthsRemaining = 0
    const rows: AmortRow[] = []
  
    // Extend loop to cover deferral months (they are in addition to grace + repayment)
    const loopMonths = totalMonths + totalDeferralMonths
    for (let i = 0; i < loopMonths; i++) {
      const loanDate = addMonths(start, i)
      const key = monthKey(loanDate)
      const monthIndex = i + 1
      const isOwned = loanDate >= purchaseMonth
  
      // Activate new deferrals
      if (deferralMap[key]) {
        deferralMonthsRemaining += deferralMap[key]
      }
  
      const isGrace = i < graceMonths
      const isDeferred = deferralMonthsRemaining > 0
      if (isDeferred) deferralMonthsRemaining = Math.max(0, deferralMonthsRemaining - 1)
  
      // Default event — stops the schedule
      if (defaultEvent && monthKeyFromISO(defaultEvent.date!) === key) {
        const recovered = Number(defaultEvent.recovered || 0)
        balance = Math.max(0, balance - recovered)
        rows.push({
          monthIndex, loanDate,
          payment: 0, interest: 0,
          scheduledPrincipal: 0, prepaymentPrincipal: 0,
          balance: +balance.toFixed(2),
          isDeferred: true, isOwned,
          eventType: 'default',
        })
        break
      }
  
      // Grace or deferral — interest accrues, no scheduled principal payment
      if (isGrace || isDeferred) {
        const accruedInterest = balance * monthlyRate
        balance += accruedInterest
  
        // Prepayment can still occur during grace/deferral — takes priority for row color
        const prepay = prepayMap[key] || 0
        if (prepay > 0) {
          balance = Math.max(0, balance - prepay)
        }
        if (balance <= 0.01) balance = 0
  
        rows.push({
          monthIndex, loanDate,
          payment: prepay > 0 ? prepay : 0,
          interest: +accruedInterest.toFixed(2),
          scheduledPrincipal: 0,
          prepaymentPrincipal: prepay,
          balance: +balance.toFixed(2),
          isDeferred: true, isOwned,
          // Prepayment takes color priority over deferral
          eventType: prepay > 0 ? 'prepayment' : (isDeferred ? 'deferral' : undefined),
        })
        continue
      }
  
      // Normal repayment
      const interest = balance * monthlyRate
      const normalPrincipal = originalMonthlyPayment - interest
  
      // If the remaining balance is less than a full principal payment,
      // this is the final payment — pay off exactly what remains
      const isFinalPayment = balance <= normalPrincipal + 0.01
      const scheduledPrincipal = isFinalPayment ? balance : normalPrincipal
      const actualPayment = isFinalPayment
        ? +(interest + scheduledPrincipal).toFixed(2)
        : +originalMonthlyPayment.toFixed(2)
  
      balance = isFinalPayment ? 0 : Math.max(0, balance - normalPrincipal)
  
      // Apply prepayment after scheduled payment
      const prepay = prepayMap[key] || 0
      if (prepay > 0) {
        balance = Math.max(0, balance - prepay)
      }
  
      if (balance <= 0.01) balance = 0
  
      rows.push({
        monthIndex, loanDate,
        payment: actualPayment,
        interest: +interest.toFixed(2),
        scheduledPrincipal: +scheduledPrincipal.toFixed(2),
        prepaymentPrincipal: prepay,
        balance: +balance.toFixed(2),
        isDeferred: false, isOwned,
        eventType: prepay > 0 ? 'prepayment' : undefined,
      })
  
      if (balance <= 0) break
    }
  
    return rows
  }
  
  export function getCurrentBalance(loan: LoanInput, today = new Date()): number {
    try {
      const schedule = buildAmortSchedule(loan)
      if (!schedule.length) return loan.principal
  
      const key = monthKey(new Date(today.getFullYear(), today.getMonth(), 1))
  
      const match = schedule.find(r => monthKey(r.loanDate) === key)
      if (match) return match.balance
  
      // If today is past loan end, return last balance
      return schedule[schedule.length - 1].balance
    } catch (e) {
      console.warn('amortEngine error for', loan.loanName, e)
      return loan.principal
    }
  }