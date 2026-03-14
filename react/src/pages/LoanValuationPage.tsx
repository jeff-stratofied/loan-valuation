import React, { useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import OwnershipPie from '../components/OwnershipPie'
import DrawerShell from '../components/DrawerShell'
import LoanDrawer from '../components/LoanDrawer'
import { useUser } from '../context/UserContext'
import { useNavigate } from 'react-router-dom'

// ── Engine imports (single source of truth for all math) ──
import {
  SYSTEM_PROFILE,
  loadConfig,
  loadSchoolTiers,
  loadValuationCurves,
  valueLoan,
  computePortfolioValuation,
} from '../utils/valuationEngine.js'
import { BORROWERS, getBorrowerById } from '../utils/borrowerStore.js'

// ── Static data imports (bundled by Vite from src/data/) ──
import borrowersJson       from '../data/borrowers.json'
import loansJson           from '../data/loans.json'
import schoolTiersJson     from '../data/schoolTiers.json'
import valuationCurvesJson from '../data/valuationCurves.json'

// Helper: turn a JS object into a blob URL so fetch-based loaders can consume it
function jsonToBlobUrl(data: unknown): string {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  return URL.createObjectURL(blob)
}

// ── Types ──
type OwnershipMode = 'portfolio' | 'market' | 'all'
type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'

type Assumptions = {
  riskPremiumBps: Record<RiskTier, number>
  recoveryRate: Record<RiskTier, number>
  prepaymentMultiplier: number
  prepaySeasoningYears: number
  graduationRateThreshold: number
  earningsThreshold: number
  ficoBorrowerAdjustment: number
  ficoCosignerAdjustment: number
  baseRiskFreeRate: number
  cdrMultiplier: number
  inflationAssumption: number
  schoolTierMultiplier: Record<string, number>
  tierYearThreshold: number
  schoolTierImpact: number
  cosignerTierBenefit: number
}

type Valuation = {
  discRate: number
  npv: number
  npvPct: number
  expectedLossPct: number
  wal: number
  irr: number
  riskTier: RiskTier
  borrowerFico: number | null
  cosignerFico: number | null
  schoolTier: string
  projections: { month: number; principal: number; interest: number; discountedCF: number }[]
  riskBreakdown: Record<string, number>
}

type RowModel = {
  loan: any
  id: string
  loanName: string
  schoolName: string
  loanColor: string
  invested: number
  originalLoan: number
  rate: number
  userPct: number    // 0–1, user's ownership fraction
  marketPct: number  // 0–1, market's ownership fraction
  ownershipPct: number  // effective pct for this mode (used for valuation math)
  system: Valuation
  user: Valuation
  delta: {
    npv: number; npvPct: number; expectedLossPct: number; wal: number; irr: number
  }
}

// ── Constants ──
const STORAGE_KEY = 'userRiskAssumptions'

function getSystemAssumptions(): Assumptions {
  return { ...SYSTEM_PROFILE.assumptions } as Assumptions
}

// ── Formatters ──
const fmtCurrency = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const fmtPct = (n: number, digits = 1) => `${Number(n || 0).toFixed(digits)}%`
const fmtNum = (n: number, digits = 1) => Number(n || 0).toFixed(digits)
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)) }

function deepMergeAssumptions(base: Assumptions, raw: unknown): Assumptions {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<Assumptions>
  return {
    ...base, ...v,
    riskPremiumBps:       { ...base.riskPremiumBps,       ...(v.riskPremiumBps ?? {}) },
    recoveryRate:         { ...base.recoveryRate,         ...(v.recoveryRate ?? {}) },
    schoolTierMultiplier: { ...base.schoolTierMultiplier, ...(v.schoolTierMultiplier ?? {}) },
  }
}

// ── Loan field helpers ──
function getLoanId(loan: any, idx: number)   { return String(loan?.loanId ?? loan?.id ?? loan?.loanName ?? `loan-${idx}`) }
function getLoanName(loan: any, idx: number) { return String(loan?.loanName ?? loan?.name ?? loan?.program ?? `Loan ${idx + 1}`) }
function getLoanSchool(loan: any)            { return String(loan?.schoolName ?? loan?.school ?? loan?.issuer ?? 'Unknown') }
function getOriginalLoan(loan: any)          { return Number(loan?.principal ?? loan?.displayPrincipal ?? loan?.origLoan ?? 0) }
function getInvested(loan: any)              { return Number(loan?.purchasePrice ?? loan?.investedAmount ?? loan?.invested ?? getOriginalLoan(loan)) }
function getRate(loan: any)                  { return Number(loan?.nominalRate ?? loan?.rate ?? loan?.coupon ?? 0) }
const LOAN_COLORS = [
  '#0ea5e9','#8b5cf6','#10b981','#f59e0b','#ef4444',
  '#ec4899','#06b6d4','#84cc16','#f97316','#6366f1',
  '#14b8a6','#a855f7','#eab308','#3b82f6','#22c55e',
]
function getLoanColor(loan: any, idx: number = 0): string {
  if (loan?.loanColor) return loan.loanColor
  if (loan?.color) return loan.color
  // Derive a stable color from loanId hash or fall back to index
  const id = loan?.loanId ?? loan?.id ?? ''
  const hash = id.split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0)
  return LOAN_COLORS[(hash || idx) % LOAN_COLORS.length]
}

// ── Ownership helpers — match ownershipEngine.js / HTML version exactly ──
// lot.pct is the ownership fraction; lot.pricePaid is invested amount (from API)
// MARKET_USER = "Market" (string constant used by ownershipEngine)

const MARKET_USER = 'market'

function getUserPct(loan: any, userId: string): number {
  const lots: any[] = Array.isArray(loan?.ownershipLots) ? loan.ownershipLots : []
  if (lots.length === 0) {
    // Fallback: use ownershipPct set by useLoans for this user
    const raw = Number(loan?.ownershipPct ?? loan?.userOwnershipPct ?? 0)
    return Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw))
  }
  return lots
    .filter((l: any) => l.user === userId || l.userId === userId)
    .reduce((sum: number, l: any) => sum + Number(l.pct ?? 0), 0)
}

function getMarketPct(loan: any): number {
  const lots: any[] = Array.isArray(loan?.ownershipLots) ? loan.ownershipLots : []
  if (lots.length === 0) {
    // No lot data — if useLoans gave us a partial ownershipPct, market owns the rest
    const raw = Number(loan?.ownershipPct ?? loan?.userOwnershipPct ?? 0)
    const uPct = Math.max(0, Math.min(1, raw > 1 ? raw / 100 : raw))
    return uPct > 0 && uPct < 1 ? +(1 - uPct).toFixed(6) : 0
  }
  return lots
    .filter((l: any) => l.user === MARKET_USER || l.userId === MARKET_USER)
    .reduce((sum: number, l: any) => sum + Number(l.pct ?? 0), 0)
}

// invested = sum of lot.pricePaid (or lot.pct * principal fallback) — matches HTML line 1005
function getInvestedFromLots(loan: any, userId: string): number {
  const lots: any[] = Array.isArray(loan?.ownershipLots) ? loan.ownershipLots : []
  const userLots = lots.filter((l: any) => l.user === userId || l.userId === userId)
  if (userLots.length > 0) {
    return userLots.reduce((sum: number, l: any) =>
      sum + Number(l.pricePaid ?? (Number(l.pct ?? 0) * getOriginalLoan(loan))), 0)
  }
  return getInvested(loan)
}

function getOwnershipPct(loan: any, mode: OwnershipMode, userId: string): number {
  if (mode === 'portfolio') return getUserPct(loan, userId)
  if (mode === 'market')    return getMarketPct(loan)
  const u = getUserPct(loan, userId)
  return u > 0 ? u : getMarketPct(loan)
}

// HTML version: computePortfolioValuation handles filtering internally.
// We replicate its filter logic here for the rows useMemo.
function filterLoansByMode(loans: any[], mode: OwnershipMode, userId: string): any[] {
  return loans.filter((loan) => {
    const uPct = getUserPct(loan, userId)
    const mPct = getMarketPct(loan)
    if (mode === 'portfolio') return uPct > 0
    if (mode === 'market')    return mPct > 0
    return uPct > 0 || mPct > 0
  })
}

// Tooltip — matches HTML getOwnershipTooltip exactly
function getOwnershipTooltip(loan: any, mode: OwnershipMode, userId: string): string {
  const uPct = getUserPct(loan, userId)
  const mPct = getMarketPct(loan)
  if (mode === 'portfolio') return `${Math.round(uPct * 100)}% Owned`
  if (mode === 'market')    return `${Math.round(mPct * 100)}% Market`
  return `${Math.round(uPct * 100)}% Owned / ${Math.round(mPct * 100)}% Market`
}

// ── Bridge: call real valuationEngine, normalise output to UI shape ──
function runValuation(
  loan: any,
  borrower: any,
  profile: { assumptions: Assumptions },
  ownershipPct: number,
): Valuation {
  const original = getOriginalLoan(loan)
  // ownershipPct is 0–1 (same convention as AmortDetailPage)
  const invested = original * ownershipPct

  // nominalRate is already decimal (0.096) — use directly
  const rawRate = getRate(loan)
  const normalizedRate = rawRate

  // Ensure all required engine fields are present with correct names/types
  const loanForEngine = {
    ...loan,
    principal:   original,
    nominalRate: normalizedRate,
    termYears:   Number(loan?.termYears ?? loan?.term ?? 10),
    graceYears:  Number(loan?.graceYears ?? loan?.grace ?? 0),
    loanStartDate: loan?.loanStartDate ?? loan?.startDate ?? null,
    purchaseDate:  loan?.purchaseDate ?? loan?.loanStartDate ?? loan?.startDate ?? null,
    loanId:      loan?.loanId ?? loan?.id ?? loan?.loanName,
  }

  let result: any
  try {
    result = valueLoan({
      loan: loanForEngine,
      borrower,
      riskFreeRate: profile.assumptions.baseRiskFreeRate / 100,
      profile,
    })
  } catch (err) {
    console.warn('valueLoan failed:', (err as Error).message, loan?.loanName)
    result = null
  }

  if (!result || !Number.isFinite(result.npv)) {
    return {
      discRate: profile.assumptions.baseRiskFreeRate,
      npv: invested, npvPct: 0, expectedLossPct: 0, wal: 0, irr: 0,
      riskTier: 'HIGH',
      borrowerFico: borrower?.borrowerFico ?? null,
      cosignerFico: borrower?.cosignerFico ?? null,
      schoolTier: 'Tier 3', projections: [], riskBreakdown: {},
    }
  }

  // Engine calculates NPV on the full loan balance.
  // Scale down to the owned slice for $ values; keep % metrics at loan level (ownership-independent).
  const ownedNpv = result.npv * ownershipPct

  return {
    discRate:        Number((result.discountRate * 100).toFixed(4)),
    npv:             ownedNpv,
    npvPct:          Number(((result.npvRatio ?? 0) * 100).toFixed(2)),  // loan-level premium/discount %
    expectedLossPct: Number(((result.expectedLossPct ?? result.expectedLoss ?? 0) * 100).toFixed(4)),
    wal:             result.wal ?? 0,
    irr:             result.irr ?? 0,
    riskTier:        (result.riskTier ?? 'HIGH') as RiskTier,
    borrowerFico:    borrower?.borrowerFico ?? null,
    cosignerFico:    borrower?.cosignerFico ?? null,
    schoolTier:      result.riskBreakdown?.schoolTier ?? 'Tier 3',
    projections:     result.projections ?? [],
    riskBreakdown:   result.riskBreakdown ?? {},
  }
}

// ══════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════

export default function LoanValuationPage() {
  const navigate = useNavigate()
  const { userId } = useUser()

  // Fetch ALL loans directly from the backend — same as the HTML version which calls
  // fetch(`${BACKEND_URL}/loans`) to get every loan, then filters client-side by ownership mode.
  // useLoans(userId) only returns loans for that user and misses 100%-market-owned loans.
  const [loans, setLoans] = useState<any[]>([])

  const [ownershipMode,   setOwnershipMode]   = useState<OwnershipMode>('portfolio')
  const [selectedId,      setSelectedId]      = useState<string | null>(null)
  const [loanDrawerOpen,  setLoanDrawerOpen]  = useState(false)
  const [riskDrawerOpen,  setRiskDrawerOpen]  = useState(false)
  const [enginesReady,    setEnginesReady]    = useState(false)

  const [draftAssumptions, setDraftAssumptions] = useState<Assumptions>(getSystemAssumptions)
  const [savedAssumptions,  setSavedAssumptions] = useState<Assumptions>(getSystemAssumptions)

  // ── Sort state ──
  const [sortKey, setSortKey] = useState<string>('loanName')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // ── Bootstrap once: pull all loans + remote config, seed engines ──
  useEffect(() => {
    async function init() {
      try {
        BORROWERS.length = 0
        BORROWERS.push(...(borrowersJson as any[]))

        const schoolTiersUrl     = jsonToBlobUrl(schoolTiersJson)
        const valuationCurvesUrl = jsonToBlobUrl(valuationCurvesJson)
        await Promise.all([loadSchoolTiers(schoolTiersUrl), loadValuationCurves(valuationCurvesUrl)])
        URL.revokeObjectURL(schoolTiersUrl)
        URL.revokeObjectURL(valuationCurvesUrl)

        await loadConfig()

        // Load all loans from bundled JSON (same pattern as borrowers.json)
        const allLoans: any[] = (loansJson as any).loans ?? (loansJson as any) ?? []
        setLoans(allLoans.filter((l: any) =>
          !l.events?.some((e: any) => e.type === 'default')
        ))

        try {
          const raw = localStorage.getItem(STORAGE_KEY)
          if (raw) {
            const merged = deepMergeAssumptions(getSystemAssumptions(), JSON.parse(raw))
            setSavedAssumptions(merged)
            setDraftAssumptions(merged)
          } else {
            setSavedAssumptions(getSystemAssumptions())
            setDraftAssumptions(getSystemAssumptions())
          }
        } catch {
          setSavedAssumptions(getSystemAssumptions())
          setDraftAssumptions(getSystemAssumptions())
        }
      } catch (err) {
        console.error('Engine init failed:', err)
      } finally {
        setEnginesReady(true)
      }
    }
    init()
  }, [])

  // ── Build rows via real engine ──
  const rows = useMemo<RowModel[]>(() => {
    if (!loans.length) return []
    const systemProfile = { assumptions: getSystemAssumptions() }
    const userProfile   = { assumptions: savedAssumptions }

    // Debug: log first loan's ownershipLots so we can verify field names at runtime
    if (!import.meta.env.PROD && (loans as any[]).length > 0) {
      const s = (loans as any[])[0]
      console.log('[LoanValuation] loan[0] ownership:', {
        name: s.loanName, ownershipPct: s.ownershipPct,
        lots: s.ownershipLots,
        lot0: s.ownershipLots?.[0],   // full first lot so we see every field name
      })
      // Show all unique lot.user values across all loans so we know the exact string
      const allUsers = new Set<string>()
      ;(loans as any[]).forEach((l: any) =>
        (l.ownershipLots ?? []).forEach((lot: any) => {
          allUsers.add(JSON.stringify({ user: lot.user, userId: lot.userId, owner: lot.owner, pct: lot.pct, pricePaid: lot.pricePaid }))
        })
      )
      console.log('[LoanValuation] all unique lot shapes (first 10):', [...allUsers].slice(0, 10))
      console.log('[LoanValuation] total:', (loans as any[]).length,
        '| mode:', ownershipMode,
        '| filtered:', filterLoansByMode(loans as any[], ownershipMode, userId).length)
    }

    const filtered = filterLoansByMode(loans as any[], ownershipMode, userId)

    return filtered.map((loan, idx) => {
      const loanId     = getLoanId(loan, idx)
      const _b         = getBorrowerById(loan.borrowerId) ?? {}
      const borrower   = {
        borrowerFico: null, cosignerFico: null,
        yearInSchool: null, isGraduateStudent: false,
        ..._b,
        // Prefer borrower-level data; fall back to loan record when borrower has no OPEID or school name
        school: _b.school || loan.school || '',
        opeid:  (_b.opeid && _b.opeid !== 'MISSING') ? _b.opeid : (loan.opeid ?? ''),
      }
      const uPct       = getUserPct(loan, userId)
      const mPct       = getMarketPct(loan)
      const ownershipPct = getOwnershipPct(loan, ownershipMode, userId)
      const system = runValuation(loan, borrower, systemProfile, ownershipPct)
      const user   = runValuation(loan, borrower, userProfile,   ownershipPct)

      return {
        loan, id: loanId,
        loanName:     getLoanName(loan, idx),
        schoolName:   getLoanSchool(loan),
        loanColor:    getLoanColor(loan, idx),
        invested:     getInvestedFromLots(loan, userId),
        originalLoan: getOriginalLoan(loan),
        rate:         getRate(loan),
        userPct:      uPct,
        marketPct:    mPct,
        ownershipPct,
        system, user,
        delta: {
          npv:             user.npv             - system.npv,
          npvPct:          user.npvPct          - system.npvPct,
          expectedLossPct: user.expectedLossPct - system.expectedLossPct,
          wal:             user.wal             - system.wal,
          irr:             user.irr             - system.irr,
        },
      }
    })
  }, [loans, ownershipMode, savedAssumptions, enginesReady, userId]) // eslint-disable-line

  useEffect(() => {
    if (!rows.length) return
    if (selectedId && !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0].id)
  }, [rows, selectedId])

  const selectedRow  = rows.find((r) => r.id === selectedId) ?? null
  const hasOverrides = JSON.stringify(savedAssumptions) !== JSON.stringify(getSystemAssumptions())

  // ── KPIs ──
  const kpis = useMemo(() => {
    const inv  = rows.reduce((s, r) => s + r.invested, 0)
    const npv  = rows.reduce((s, r) => s + r.user.npv, 0)
    const wIrr = inv > 0 ? rows.reduce((s, r) => s + r.user.irr * r.invested, 0) / inv : 0
    const wLoss = inv > 0 ? rows.reduce((s, r) => s + r.user.expectedLossPct * r.invested, 0) / inv : 0
    return {
      portfolioValue: npv,
      avgNpvPct:      inv > 0 ? ((npv - inv) / inv) * 100 : 0,
      weightedIrr:    wIrr,
      weightedLoss:   wLoss,
    }
  }, [rows])

  // ── Total row ──
  const totals = useMemo(() => {
    const inv  = rows.reduce((s, r) => s + r.invested, 0)
    const orig = rows.reduce((s, r) => s + r.originalLoan, 0)
    const npv  = rows.reduce((s, r) => s + r.user.npv, 0)
    return {
      orig, inv, npv,
      npvPct:   inv > 0 ? ((npv - inv) / inv) * 100 : 0,
      expLoss:  inv > 0 ? rows.reduce((s, r) => s + r.user.expectedLossPct * r.invested, 0) / inv : 0,
      wal:      inv > 0 ? rows.reduce((s, r) => s + r.user.wal * r.invested, 0) / inv : 0,
      irr:      kpis.weightedIrr,
      deltaNpv: rows.reduce((s, r) => s + r.delta.npv, 0),
    }
  }, [rows, kpis.weightedIrr])

  // ── Sorted rows ──
  const TIER_ORDER: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 }
  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      let av: any, bv: any
      switch (sortKey) {
        case 'loanName':       av = a.loanName;                   bv = b.loanName;                   break
        case 'invested':       av = a.invested;                   bv = b.invested;                   break
        case 'originalLoan':   av = a.originalLoan;               bv = b.originalLoan;               break
        case 'rate':           av = a.rate;                       bv = b.rate;                       break
        case 'borrowerFico':   av = a.user.borrowerFico ?? -1;    bv = b.user.borrowerFico ?? -1;    break
        case 'cosignerFico':   av = a.user.cosignerFico ?? -1;    bv = b.user.cosignerFico ?? -1;    break
        case 'riskTier':       av = TIER_ORDER[a.user.riskTier];  bv = TIER_ORDER[b.user.riskTier];  break
        case 'discRate':       av = a.user.discRate;              bv = b.user.discRate;              break
        case 'npv':            av = a.user.npv;                   bv = b.user.npv;                   break
        case 'npvPct':         av = a.user.npvPct;                bv = b.user.npvPct;                break
        case 'expectedLoss':   av = a.user.expectedLossPct;       bv = b.user.expectedLossPct;       break
        case 'wal':            av = a.user.wal;                   bv = b.user.wal;                   break
        case 'irr':            av = a.user.irr;                   bv = b.user.irr;                   break
        default:               av = a.loanName;                   bv = b.loanName
      }
      if (typeof av === 'string') return dir * av.localeCompare(bv)
      return dir * ((av ?? 0) - (bv ?? 0))
    })
  }, [rows, sortKey, sortDir])

  // ── Drawer handlers ──
  const openLoanDrawer = (id: string) => { setSelectedId(id); setLoanDrawerOpen(true) }
  const closeLoanDrawer = () => setLoanDrawerOpen(false)

  const openRiskDrawer = () => { setDraftAssumptions(savedAssumptions); setRiskDrawerOpen(true) }
  const saveRiskDrawer = () => {
    setSavedAssumptions(draftAssumptions)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draftAssumptions))
    setRiskDrawerOpen(false)
  }
  const resetAll = () => {
    const sys = getSystemAssumptions()
    setSavedAssumptions(sys); setDraftAssumptions(sys)
    localStorage.removeItem(STORAGE_KEY)
  }

  // ══════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════

  const SortTh = ({ label, sortId, style }: { label: string; sortId: string; style?: React.CSSProperties }) => {
    const active = sortKey === sortId
    const arrow  = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
    return (
      <th
        onClick={() => handleSort(sortId)}
        style={{
          ...subHead,
          ...style,
          cursor: 'pointer',
          userSelect: 'none',
          color: active ? '#0ea5e9' : subHead.color,
          whiteSpace: 'nowrap',
        }}
      >
        {label}{arrow && <span style={{ fontSize: 10, opacity: 0.8 }}>{arrow}</span>}
      </th>
    )
  }

  return (
    <AppShell>
      <div style={{ padding: '0 0 32px', background: '#f4f7f8', minHeight: '100%' }}>

          {/* Nav tabs */}
          <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 28, paddingLeft: 4 }}>
              <button type="button" style={topTabBaseStyle} onClick={() => navigate('/?tab=marketplace')}>Marketplace</button>
              <button type="button" style={topTabBaseStyle} onClick={() => navigate('/')}>My Holdings</button>
              <button type="button" style={{ ...topTabBaseStyle, color: '#0f172a', borderBottom: '2px solid #0ea5e9', marginBottom: -1 }}
                onClick={() => navigate('/valuations')}>Loan Valuations</button>
            </div>
          </div>

          {/* KPI tiles */}
          <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic', marginBottom: 8 }}>
            Baseline valuation using risk-adjusted discounting
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 10 }}>
            <MetricCard label="Portfolio Value"              value={fmtCurrency(kpis.portfolioValue)} />
            <MetricCard label="Avg NPV % (premium/discount)" value={fmtPct(kpis.avgNpvPct)} />
            <MetricCard label="Weighted IRR"                 value={fmtPct(kpis.weightedIrr, 2)} />
            <MetricCard label="Expected Loss"                value={fmtPct(kpis.weightedLoss, 2)} />
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
            {/* View toggle */}
            <div style={{ display: 'inline-flex', background: '#e5ece9', border: '1px solid #d8dfdc', borderRadius: 999, padding: 3 }}>
              {(['portfolio', 'market', 'all'] as OwnershipMode[]).map((mode) => (
                <button key={mode} onClick={() => setOwnershipMode(mode)} style={{
                  border: 'none',
                  background: ownershipMode === mode ? '#fff' : 'transparent',
                  color:      ownershipMode === mode ? '#0f172a' : '#94a3b8',
                  padding: '7px 14px', borderRadius: 999, fontSize: 14,
                  fontWeight: ownershipMode === mode ? 600 : 400,
                  boxShadow: ownershipMode === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}>
                  {mode === 'portfolio' ? 'Portfolio' : mode === 'market' ? 'Market' : 'All'}
                </button>
              ))}
            </div>

            {/* Centred: Adjust + Reset */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={openRiskDrawer} style={{ ...actionButton, background: '#16a34a', color: '#fff', borderColor: '#16a34a' }}>
                Adjust Risk & Value Controls
              </button>
              <button onClick={resetAll} style={{ ...actionButton, background: '#1d9bf0', color: '#fff', borderColor: '#1d9bf0' }}>
                Reset
              </button>
            </div>

            {/* Print / CSV */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button style={actionButton}>Print</button>
              <button style={actionButton}>Download CSV</button>
              <button style={actionButton}>Copy CSV</button>
            </div>
          </div>

          {/* Table */}
          <div style={{
            background: '#fff', border: '1px solid #d8dfdc',
            borderRadius: 16, overflow: 'hidden',
          }}>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      <th colSpan={2} style={groupHead}>LOAN</th>
                      <th colSpan={3} style={groupHead}>TERMS</th>
                      <th colSpan={3} style={groupHead}>BORROWER RISK</th>
                      <th colSpan={6} style={groupHead}>VALUATION</th>
                      {hasOverrides && <th colSpan={5} style={groupHead}>DELTA (vs System)</th>}
                    </tr>
                    <tr style={{ background: '#f8fafc' }}>
                      <SortTh label="Loan Name"  sortId="loanName" />
                      <th style={subHead}>% Owned</th>
                      <SortTh label="Orig Loan"  sortId="originalLoan" />
                      <SortTh label="Invested"   sortId="invested" />
                      <SortTh label="Rate"       sortId="rate" />
                      <SortTh label="Brwr FICO"  sortId="borrowerFico" />
                      <SortTh label="Csnr FICO"  sortId="cosignerFico" />
                      <SortTh label="Tier"       sortId="riskTier" />
                      <SortTh label="Disc Rate"  sortId="discRate" />
                      <SortTh label="NPV"        sortId="npv" />
                      <SortTh label="NPV %"      sortId="npvPct" />
                      <SortTh label="Exp Loss"   sortId="expectedLoss" />
                      <SortTh label="WAL"        sortId="wal" />
                      <SortTh label="IRR"        sortId="irr" />
                      {hasOverrides && ['ΔNPV','ΔNPV%','ΔExp Loss','ΔWAL','ΔIRR'].map((label) => (
                        <th key={label} style={subHead}>{label}</th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {sortedRows.map((row, idx) => {
                      const active = row.id === selectedId && loanDrawerOpen
                      const displayRate = row.rate <= 1 ? row.rate * 100 : row.rate
                      return (
                        <tr key={row.id}
                          onClick={() => openLoanDrawer(row.id)}
                          style={{
                            background: active ? '#eef7f3' : idx % 2 === 1 ? 'rgba(15,23,42,0.025)' : '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          <td style={{ ...cell, fontWeight: 600, fontSize: 12.5 }}>{row.loanName}</td>
                          <td style={{ ...cell, textAlign: 'center' }}>
                            <OwnershipPie
                              userPct={row.userPct}
                              marketPct={row.marketPct}
                              color={row.loanColor}
                              size={26}
                              label={getOwnershipTooltip(row.loan, ownershipMode, userId)}
                            />
                          </td>
                          <td style={cell}>{fmtCurrency(row.originalLoan)}</td>
                          <td style={cell}>{fmtCurrency(row.invested)}</td>
                          <td style={cell}>{fmtPct(displayRate, 2)}</td>
                          <td style={cell}>{row.user.borrowerFico ?? '—'}</td>
                          <td style={cell}>{row.user.cosignerFico ?? '—'}</td>
                          <td
                            style={{
                              ...cell,
                              color:
                                row.user.riskTier?.toUpperCase() === 'HIGH'      ? '#dc2626'
                                : row.user.riskTier?.toUpperCase() === 'MEDIUM'  ? '#d97706'
                                : row.user.riskTier?.toUpperCase() === 'LOW'     ? '#16a34a'
                                : cell.color,
                            }}
                          >
                            {row.user.riskTier}
                            {(() => {
                              const order: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, VERY_HIGH: 3 }
                              const sysRank  = order[row.system.riskTier] ?? -1
                              const userRank = order[row.user.riskTier]   ?? -1
                              if (!hasOverrides || sysRank === userRank || sysRank < 0 || userRank < 0) return null
                              return userRank > sysRank
                                ? <span title={`Worse than system (${row.system.riskTier})`} style={{ marginLeft: 4, fontSize: 11, color: '#dc2626' }}>▲</span>
                                : <span title={`Better than system (${row.system.riskTier})`} style={{ marginLeft: 4, fontSize: 11, color: '#16a34a' }}>▼</span>
                            })()}
                          </td>
                          <td style={cell}>{fmtPct(row.user.discRate, 2)}</td>
                          <td style={cell}>{fmtCurrency(row.user.npv)}</td>
                          <td style={cell}>{fmtPct(row.user.npvPct, 1)}</td>
                          <td style={cell}>{fmtPct(row.user.expectedLossPct, 2)}</td>
                          <td style={cell}>{fmtNum(row.user.wal, 1)}</td>
                          <td style={{ ...cell, color: row.user.irr >= 8 ? '#16a34a' : '#ea580c' }}>
                            {fmtPct(row.user.irr, 2)}
                          </td>
                          {hasOverrides && (
                            <>
                              <td style={{ ...cell, color: deltaColor(row.delta.npv) }}>{deltaMoney(row.delta.npv)}</td>
                              <td style={{ ...cell, color: deltaColor(row.delta.npvPct) }}>{deltaPct(row.delta.npvPct, 1)}</td>
                              <td style={{ ...cell, color: deltaColor(-row.delta.expectedLossPct) }}>{deltaPct(row.delta.expectedLossPct, 2)}</td>
                              <td style={{ ...cell, color: deltaColor(-row.delta.wal) }}>{deltaNum(row.delta.wal, 1)}</td>
                              <td style={{ ...cell, color: deltaColor(row.delta.irr) }}>{deltaPct(row.delta.irr, 2)}</td>
                            </>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>

                  {/* Summary row */}
                  <tfoot>
                    <tr style={{ background: '#f8fafc' }}>
                      <td style={{ ...cell, fontWeight: 700, fontSize: 13 }}>Total</td>
                      <td style={cell} />
                      <td style={{ ...cell, fontWeight: 700 }}>{fmtCurrency(totals.orig)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{fmtCurrency(totals.inv)}</td>
                      <td style={cell} /><td style={cell} /><td style={cell} /><td style={cell} /><td style={cell} />
                      <td style={{ ...cell, fontWeight: 700 }}>{fmtCurrency(totals.npv)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{fmtPct(totals.npvPct, 1)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{fmtPct(totals.expLoss, 2)}</td>
                      <td style={{ ...cell, fontWeight: 700 }}>{fmtNum(totals.wal, 1)}</td>
                      <td style={{ ...cell, fontWeight: 700, color: totals.irr >= 8 ? '#16a34a' : '#ea580c' }}>{fmtPct(totals.irr, 2)}</td>
                      {hasOverrides && (
                        <>
                          <td style={{ ...cell, fontWeight: 700, color: deltaColor(totals.deltaNpv) }}>{deltaMoney(totals.deltaNpv)}</td>
                          <td style={cell} /><td style={cell} /><td style={cell} /><td style={cell} />
                        </>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

        {/* ── Loan detail drawer ── */}
        <LoanDrawer
          loan={selectedRow?.loan ?? null}
          open={loanDrawerOpen}
          onClose={closeLoanDrawer}
          title={selectedRow?.loanName}
          subTitle={selectedRow ? `${selectedRow.schoolName} · Invested: ${fmtCurrency(selectedRow.invested)}` : undefined}
          width={620}
        >
          {loanDrawerOpen && selectedRow && (
            <ValuationLoanDrawerBody
              row={selectedRow}
              savedAssumptions={savedAssumptions}
              ownershipMode={ownershipMode}
            />
          )}
        </LoanDrawer>

        {/* ── Risk & Value controls drawer ── */}
        <DrawerShell
          open={riskDrawerOpen}
          onClose={() => setRiskDrawerOpen(false)}
          title="Risk & Value Controls"
          subTitle={`Adjust assumptions to see how they shift valuations vs. system baseline.\nChanges appear live in the delta columns once saved.`}
          width={620}
          headerActions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveRiskDrawer}
                style={{ height: 34, padding: '0 16px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Save &amp; Close
              </button>
              <button
                onClick={() => setDraftAssumptions(getSystemAssumptions())}
                style={{ height: 34, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                Reset
              </button>
            </div>
          }
        >

                {/* ── RISK PREMIUMS ── */}
                <RiskSection
                  title="Risk Premiums"
                  subtitle="BPS ADDED TO DISCOUNT RATE"
                  color="#dc2626"
                  intro="Discount rate = risk-free rate + risk premium for the loan's tier. The tier is a weighted composite of FICO score (65%), year in school (15%), school quality (10%), and cosigner presence (10%) — see Risk Tier Classification below. A higher premium demands more return for holding that tier, which lowers the loan's present value. These sliders let you calibrate how much spread each tier should carry."
                >
                  <RichSlider
                    label="LOW Risk Premium" unit="bps"
                    value={draftAssumptions.riskPremiumBps.LOW} systemValue={250}
                    min={0} max={1000} step={10}
                    who="Applied to loans whose composite risk score falls below 0.33 — typically FICO 740+ borrowers at Tier 1 or Tier 2 schools, often with a cosigner. These are the strongest credits in the portfolio."
                    impact="↑ Higher → lowers NPV on your best loans; use if you want a larger cushion even on strong credits. ↓ Lower → rewards high-quality origination with a tighter spread."
                    source="Moody's Student Loan ABS Methodology"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, riskPremiumBps: { ...p.riskPremiumBps, LOW: v } }))}
                  />
                  <RichSlider
                    label="MEDIUM Risk Premium" unit="bps"
                    value={draftAssumptions.riskPremiumBps.MEDIUM} systemValue={350}
                    min={0} max={1000} step={10}
                    who="Composite score 0.33–0.46. Typically FICO 670–739 borrowers at average schools, or stronger-FICO borrowers at Tier 3 / Unknown schools. The most common tier in this portfolio — changes here have the largest impact on total portfolio NPV."
                    impact="↑ Higher → biggest drag on portfolio NPV. ↓ Lower → lifts average valuation across the book."
                    source="S&P Private Student Loan Benchmarks"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, riskPremiumBps: { ...p.riskPremiumBps, MEDIUM: v } }))}
                  />
                  <RichSlider
                    label="HIGH Risk Premium" unit="bps"
                    value={draftAssumptions.riskPremiumBps.HIGH} systemValue={550}
                    min={0} max={1500} step={10}
                    who="Composite score 0.46–0.63. Typically lower-FICO borrowers (580–669), Year 1–2 students with no cosigner, or any borrower at a Tier 3 school without offsetting credit strengths."
                    impact="↑ Higher → discounts marginal loans more aggressively. ↓ Lower → be cautious; HIGH tier loans carry meaningful default exposure."
                    source="CFPB Private Student Loan Reports"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, riskPremiumBps: { ...p.riskPremiumBps, HIGH: v } }))}
                  />
                  <RichSlider
                    label="VERY HIGH Risk Premium" unit="bps"
                    value={draftAssumptions.riskPremiumBps.VERY_HIGH} systemValue={750}
                    min={0} max={2000} step={10}
                    who="Composite score ≥ 0.63. FICO below 580, or a combination of weak credit, early school stage, poor-outcome school, and no cosigner. Rare in a curated portfolio but represents the highest default probability."
                    impact="↑ Higher → may push NPV negative on these loans; useful for stress-testing tail risk. ↓ Lower → be cautious about underpricing the worst credits."
                    source="Navient ABS Disclosures"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, riskPremiumBps: { ...p.riskPremiumBps, VERY_HIGH: v } }))}
                  />
                </RiskSection>

                {/* ── RECOVERY RATES ── */}
                <RiskSection
                  title="Recovery Rates"
                  subtitle="% OF PRINCIPAL RECOVERED AFTER DEFAULT"
                  color="#0369a1"
                  intro="Recovery is the share of outstanding balance collected after a default — through collections, wage garnishment, or settlement. It directly offsets Expected Loss: higher recovery means less capital at risk. Private student loans are unsecured and non-dischargeable in bankruptcy, which supports recovery relative to other consumer debt, but outcomes vary widely by borrower profile."
                >
                  <RichSlider
                    label="LOW Tier Recovery" unit="%"
                    value={draftAssumptions.recoveryRate.LOW} systemValue={30}
                    min={0} max={100} step={1}
                    who="Defaults on LOW-tier loans (composite score < 0.33). These are rare events on strong-credit borrowers — when they do default, income capacity and cosigner backstops support better recovery."
                    impact="↑ Higher → reduces expected loss on your best loans. ↓ Lower → conservative buffer for unexpected shortfalls."
                    source="Moody's Ultimate Recovery Database"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, recoveryRate: { ...p.recoveryRate, LOW: v } }))}
                  />
                  <RichSlider
                    label="MEDIUM Tier Recovery" unit="%"
                    value={draftAssumptions.recoveryRate.MEDIUM} systemValue={22}
                    min={0} max={100} step={1}
                    who="Defaults on MEDIUM-tier loans (score 0.33–0.46). The most impactful recovery assumption since MEDIUM is the most populated tier — small changes here have an outsized effect on total portfolio expected loss."
                    impact="↑ Higher → biggest improvement to portfolio-level expected loss. ↓ Lower → most conservative stance on the core of the book."
                    source="S&P Loss Severity Ratings"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, recoveryRate: { ...p.recoveryRate, MEDIUM: v } }))}
                  />
                  <RichSlider
                    label="HIGH Tier Recovery" unit="%"
                    value={draftAssumptions.recoveryRate.HIGH} systemValue={15}
                    min={0} max={100} step={1}
                    who="Defaults on HIGH-tier loans (score 0.46–0.63). Lower-FICO or early-stage borrowers have weaker post-default income capacity, and are less likely to have cosigner coverage."
                    impact="↑ Higher → partially offsets the HIGH risk premium in NPV. ↓ Lower → amplifies loss on the more marginal part of the book."
                    source="CFPB Private Student Loan Default Studies"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, recoveryRate: { ...p.recoveryRate, HIGH: v } }))}
                  />
                  <RichSlider
                    label="VERY HIGH Tier Recovery" unit="%"
                    value={draftAssumptions.recoveryRate.VERY_HIGH} systemValue={10}
                    min={0} max={100} step={1}
                    who="Defaults on VERY HIGH-tier loans (score ≥ 0.63). The highest-risk borrower profile — weakest credit, often no cosigner, weak-outcome school. Historically the lowest recovery cohort for private student loans."
                    impact="↑ Higher → reduces expected loss on the tail of the portfolio. ↓ Lower → amplifies worst-case loss; use for stress testing."
                    source="Fitch Ratings Student Loan ABS"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, recoveryRate: { ...p.recoveryRate, VERY_HIGH: v } }))}
                  />
                </RiskSection>

                {/* ── PREPAYMENT ── */}
                <RiskSection
                  title="Prepayment &amp; Duration"
                  subtitle="CONTROLS EXPECTED LOAN PAYOFF SPEED"
                  color="#7c3aed"
                  intro="Prepayment is when a borrower pays off principal ahead of schedule (refinancing, lump-sum payments). Faster prepayment shortens duration and returns principal sooner — good for cash flow, but reduces total interest income. The seasoning period is the ramp-up window before full prepayment speed kicks in."
                >
                  <RichSlider
                    label="Prepayment Multiplier" unit="×"
                    value={draftAssumptions.prepaymentMultiplier} systemValue={1.0}
                    min={0.1} max={3} step={0.1}
                    who="Scales the base prepayment curve (CPR) for all loans. 1.0 = system baseline."
                    impact="↑ Higher → loans pay off faster, shorter WAL, less total interest income, lower NPV. ↓ Lower → extends duration, increases yield but also default exposure."
                    source="S&P Student Loan ABS Cash Flow Modeling"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, prepaymentMultiplier: v }))}
                  />
                  <RichSlider
                    label="Prepay Seasoning Period" unit="yrs"
                    value={draftAssumptions.prepaySeasoningYears} systemValue={2.5}
                    min={0} max={10} step={0.5}
                    who="How long before a loan reaches full prepayment speed. Before this point, prepay runs at 10% of normal rate."
                    impact="↑ Longer → slower early prepayments, higher initial duration. ↓ Shorter → prepays kick in sooner, reduces WAL faster."
                    source="ABS Prepayment Disclosures"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, prepaySeasoningYears: v }))}
                  />
                </RiskSection>

                {/* ── FICO ADJUSTMENTS ── */}
                <RiskSection
                  title="FICO Score Sensitivity"
                  subtitle="BPS ADJUSTMENT TO DISCOUNT RATE PER CREDIT BAND"
                  color="#0f766e"
                  intro="These control how much the discount rate shifts in response to borrower FICO quality, independent of the tier. The adjustment is signed bps relative to the Good band (670–739 = 0 bps baseline). Exceptional (800+) earns a spread reduction; Poor (<580) adds a penalty. This is a within-tier fine-tuning — the tier determines the base risk premium; FICO sensitivity adjusts it further by exact credit quality. Cosigner weight is lower since it's a secondary backstop, not the primary obligor."
                >
                  <RichSlider
                    label="Borrower FICO Sensitivity" unit="bps/band"
                    value={draftAssumptions.ficoBorrowerAdjustment} systemValue={75}
                    min={0} max={200} step={5}
                    who="Primary borrower. Bands: Exceptional (800+) = −2×, Very Good (740–799) = −1×, Good (670–739) = 0, Fair (580–669) = +1×, Poor (<580) = +2×. A 75 bps/band setting means 800+ gets −150 bps and <580 gets +150 bps on top of their tier premium."
                    impact="↑ Higher → credit score differences drive bigger spread movements; strong borrowers get more discount, weak ones get penalised more. ↓ Lower → all borrowers within a tier are priced more uniformly regardless of exact FICO."
                    source="FICO Score Default Correlation Studies"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, ficoBorrowerAdjustment: v }))}
                  />
                  <RichSlider
                    label="Cosigner FICO Sensitivity" unit="bps/band"
                    value={draftAssumptions.ficoCosignerAdjustment} systemValue={25}
                    min={0} max={200} step={5}
                    who="Cosigner credit score. Same band structure as borrower but at one-third the weight. Only applied when a cosigner is present — loans without a cosigner receive 0 bps from this slider. Note: cosigner presence itself is separately captured in the tier classification (10% weight)."
                    impact="↑ Higher → cosigner credit quality drives more of the discount rate; useful if your portfolio has many strong cosigners. ↓ Lower → cosigner treated as binary presence/absence rather than a graded credit enhancement."
                    source="CFPB Private Student Loan Reports"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, ficoCosignerAdjustment: v }))}
                  />
                </RiskSection>

                {/* ── RISK TIER CLASSIFICATION ── */}
                <RiskSection
                  title="Risk Tier Classification"
                  subtitle="HOW FOUR BORROWER FACTS COMBINE INTO A TIER"
                  color="#6d28d9"
                  intro="Each loan is assigned a tier — LOW, MEDIUM, HIGH, or VERY_HIGH — from a weighted composite of four borrower facts. Each factor scores 0.0 (no risk) to 1.0 (maximum risk); the weighted sum maps to a tier. Tier thresholds: < 0.33 = LOW, 0.33–0.46 = MEDIUM, 0.46–0.63 = HIGH, ≥ 0.63 = VERY_HIGH. The tier then determines which risk premium and recovery rate apply. Factor weights: FICO score 65% (absolute value, 580–850 scale), year in school 15%, school quality 10%, cosigner presence 10%."
                >
                  <RichSlider
                    label="Year-in-School Threshold (15% of tier)" unit="yr"
                    value={draftAssumptions.tierYearThreshold} systemValue={3}
                    min={1} max={5} step={1}
                    who="Sets the cutoff for the year-in-school score. Borrowers at or above this year score 0.0 (no penalty). Borrowers below it score linearly up to 1.0 at Year 1. Graduate students always score 0.0. At the default threshold of 3, a Year 1 borrower scores 1.0 and a Year 2 scores 0.5 on this factor — adding up to 0.15 to their composite before other factors."
                    impact="↑ Higher → the year penalty reaches further; Year 3–4 borrowers start getting penalised, pushing more loans into MEDIUM or HIGH. ↓ Lower → only the earliest-stage borrowers are penalised; Year 2 borrowers treated the same as Year 4+."
                    source="Internal — cohort default rate patterns by academic year (ED)"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, tierYearThreshold: v }))}
                  />
                  <RichSlider
                    label="School Tier Impact (10% of tier)" unit=""
                    value={draftAssumptions.schoolTierImpact} systemValue={1}
                    min={0} max={1} step={1}
                    who="Toggles whether the school's tier (derived from College Scorecard graduation rate and earnings) shifts the composite score. ON: Tier 1 school scores 0.0, Tier 2 scores 0.4, Tier 3 or Unknown scores 1.0 — contributing up to 0.10 to the composite. OFF: all schools treated as Tier 2 neutral (0.4) for tier purposes only."
                    impact="1 (on) → school quality can swing a loan's tier — a Tier 1 school reduces the composite by 0.10 vs a Tier 3 school, which can be the difference between MEDIUM and HIGH on a borderline borrower. 0 (off) → school only affects the discount rate via the School Tier Multiplier bps adjustment, not the tier label."
                    source="College Scorecard (ED) — graduation rate and earnings metrics"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, schoolTierImpact: v }))}
                  />
                  <RichSlider
                    label="Cosigner Tier Benefit (10% of tier)" unit=""
                    value={draftAssumptions.cosignerTierBenefit} systemValue={1}
                    min={0} max={1} step={1}
                    who="Toggles whether cosigner presence lowers the composite score. ON: loans with a cosigner score 0.0 on this factor; loans without score 1.0 — a difference of 0.10 in the composite. OFF: all loans treated as cosigner-neutral for tier classification. The cosigner's FICO quality is separately handled by the Cosigner FICO Sensitivity slider above."
                    impact="1 (on) → absence of a cosigner adds 0.10 to composite score; this alone can shift a borderline LOW to MEDIUM or MEDIUM to HIGH. 0 (off) → cosigner presence/absence only affects the bps fine-tuning, not the tier label itself."
                    source="CFPB Private Student Loan Reports — cosigner default rate differential"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, cosignerTierBenefit: v }))}
                  />
                </RiskSection>

                {/* ── SCHOOL / BORROWER THRESHOLDS ── */}
                <RiskSection
                  title="School &amp; Outcome Thresholds"
                  subtitle="MINIMUM BARS FOR TIER 1 SCHOOL CLASSIFICATION"
                  color="#b45309"
                  intro="School tier is computed from two College Scorecard metrics — 6-year graduation rate and median earnings 10 years after entry. A school must clear both thresholds for Tier 1; clearing one (or 80% of either) earns Tier 2; below both is Tier 3. School tier feeds into the tier composite score (10% weight) and the School Tier Multiplier bps adjustment. Raising these bars reclassifies more schools into higher-risk tiers, shifting both the tier label and the discount rate."
                >
                  <RichSlider
                    label="Graduation Rate Threshold" unit="%"
                    value={draftAssumptions.graduationRateThreshold} systemValue={75}
                    min={40} max={100} step={1}
                    who="Minimum 6-year completion rate (C150_4 from College Scorecard) for a school to qualify for Tier 1. Schools between 80% of this bar and the full bar can still reach Tier 2 on the graduation metric alone."
                    impact="↑ Higher → more schools fall to Tier 2 or Tier 3; their borrowers get a higher composite score and a wider risk premium bps adjustment. ↓ Lower → more schools qualify as Tier 1, reducing risk scores and discount rates for their borrowers."
                    source="ED College Scorecard — C150_4 (150% normal time graduation rate)"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, graduationRateThreshold: v }))}
                  />
                  <RichSlider
                    label="Median Earnings Threshold" unit="$"
                    value={draftAssumptions.earningsThreshold} systemValue={70000}
                    min={30000} max={200000} step={1000}
                    who="Minimum median earnings 10 years after entry (MD_EARN_WNE_P10 from College Scorecard) for Tier 1 classification. Reflects graduate earning capacity — the primary driver of repayment ability for student loans."
                    impact="↑ Higher → fewer schools pass the earnings bar; their borrowers face higher risk composite scores and wider discount rate adjustments. ↓ Lower → more schools treated as strong-outcome institutions, reducing risk on their borrowers."
                    source="ED College Scorecard — MD_EARN_WNE_P10 / Georgetown CEW Debt-to-Earnings"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, earningsThreshold: v }))}
                  />
                </RiskSection>

                {/* ── GLOBAL ASSUMPTIONS ── */}
                <RiskSection
                  title="Global Macro Assumptions"
                  subtitle="PORTFOLIO-WIDE INPUTS THAT AFFECT EVERY LOAN"
                  color="#475569"
                  intro="These inputs set the macroeconomic foundation for all valuations. The risk-free rate is the floor — every loan's discount rate is built as risk-free rate + tier risk premium + FICO adjustment + school adjustment. The CDR multiplier scales default probability uniformly across all tiers. Inflation erodes the real value of future cash flows. Changes here move every loan's NPV simultaneously."
                >
                  <RichSlider
                    label="Base Risk-Free Rate" unit="%"
                    value={draftAssumptions.baseRiskFreeRate} systemValue={4.25}
                    min={0} max={12} step={0.25}
                    who="The foundation discount rate before any risk premium is added. Typically pegged to the 10-Year Treasury yield."
                    impact="↑ Higher → lowers NPV on every loan across the board. ↓ Lower → raises all NPVs; reflects a low-rate environment view."
                    source="US Treasury 10-Year Yield"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, baseRiskFreeRate: v }))}
                  />
                  <RichSlider
                    label="CDR Multiplier" unit="×"
                    value={draftAssumptions.cdrMultiplier} systemValue={1.0}
                    min={0.25} max={3} step={0.05}
                    who="Scales the cohort default rate curve uniformly across all risk tiers. 1.0 = baseline default assumptions."
                    impact="↑ Higher → more defaults modeled, higher expected loss, lower NPV. ↓ Lower → optimistic default scenario; use to stress-test best case."
                    source="ED Cohort Default Rate Guide"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, cdrMultiplier: v }))}
                  />
                  <RichSlider
                    label="Inflation Assumption" unit="%"
                    value={draftAssumptions.inflationAssumption} systemValue={3.0}
                    min={0} max={8} step={0.25}
                    who="Expected annual inflation used to adjust the real value of future cash flows."
                    impact="↑ Higher → erodes real value of future payments, lowers effective NPV. ↓ Lower → future cash flows worth more in real terms."
                    source="Federal Reserve Inflation Targets"
                    onChange={(v) => setDraftAssumptions((p) => ({ ...p, inflationAssumption: v }))}
                  />
                </RiskSection>

                {/* ── SCHOOL TIER MULTIPLIER ── */}
                <RiskSection
                  title="School Tier Multiplier"
                  subtitle="SCALES THE BPS DISCOUNT RATE ADJUSTMENT BY SCHOOL QUALITY"
                  color="#0369a1"
                  intro="Once a school is classified into a tier (Tier 1/2/3 via the thresholds above), this multiplier scales the base bps added to or subtracted from the discount rate. It is separate from the tier composite score — school tier affects the risk tier label (10% weight) AND the bps fine-tuning via this multiplier. Tier 2 is the neutral anchor at 0 bps base, so its multiplier never has a pricing effect regardless of its value."
                >
                  {(['A', 'B', 'C', 'D'] as const).map((key) => {
                    const tierLabel = key === 'A' ? 'Tier 1 — Elite (A)' : key === 'B' ? 'Tier 2 — Average (B)' : key === 'C' ? 'Tier 3 — Weak Outcomes (C)' : 'Unknown School (D)'
                    const systemVal = key === 'A' ? 0.8 : key === 'B' ? 1.0 : key === 'C' ? 1.3 : 1.5
                    const baseBps   = key === 'A' ? -75 : key === 'B' ? 0 : key === 'C' ? 125 : 100
                    const curMult   = draftAssumptions.schoolTierMultiplier?.[key] ?? systemVal
                    const resultBps = Math.round(baseBps * curMult)
                    const who = key === 'A'
                      ? 'Schools with ≥75% grad rate AND ≥$70k median earnings (e.g. CMU, Michigan, UCLA).'
                      : key === 'B'
                      ? 'Mid-tier schools — neutral anchor. This multiplier has no effect (base = 0 bps).'
                      : key === 'C'
                      ? 'Schools below both grad rate and earnings thresholds (e.g. Ave Maria, Wyoming Catholic).'
                      : 'Schools not found in the College Scorecard database or missing OPEID.'
                    const impact = key === 'B'
                      ? 'No effect — Tier 2 base bps is always 0 regardless of multiplier.'
                      : `↑ Higher → stronger ${baseBps < 0 ? 'discount (more reward for elite)' : 'penalty'}. ↓ Lower → weaker ${baseBps < 0 ? 'discount' : 'penalty'}. Current result: ${resultBps > 0 ? '+' : ''}${resultBps} bps.`
                    return (
                      <RichSlider
                        key={key}
                        label={tierLabel}
                        unit="×"
                        value={curMult}
                        systemValue={systemVal}
                        min={0} max={3} step={0.05}
                        who={who}
                        impact={impact}
                        source="College Scorecard Tiers (ED)"
                        onChange={(v) => setDraftAssumptions((p) => ({
                          ...p,
                          schoolTierMultiplier: { ...(p.schoolTierMultiplier ?? { A: 0.8, B: 1.0, C: 1.3, D: 1.5 }), [key]: v }
                        }))}
                      />
                    )
                  })}
                </RiskSection>

        </DrawerShell>
      </div>
    </AppShell>
  )
}

// ── Pure UI sub-components ──

function MetricCard({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div style={{ background: '#fff', border: active ? '2px solid #28a7e1' : '1px solid #d8dfdc', borderRadius: 12, padding: '14px 18px', boxShadow: '0 1px 2px rgba(16,24,40,0.05)', minHeight: 82 }}>
      <div style={{ color: '#637086', fontSize: 13, marginBottom: 6 }}>{label}</div>
      <div style={{ color: '#0f172a', fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

// ── Rich drawer components ──

function RiskSection({ title, subtitle, color, intro, children }: {
  title: string; subtitle: string; color: string; intro: string; children: React.ReactNode
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ borderTop: `3px solid ${color}`, paddingTop: 16 }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: color, textTransform: 'uppercase' as const }}>{subtitle}</span>
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{title}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b', lineHeight: 1.55 }}>{intro}</p>
        {children}
      </div>
    </section>
  )
}

function RichSlider({ label, unit, value, systemValue, min, max, step, who, impact, source, onChange }: {
  label: string; unit: string; value: number; systemValue: number;
  min: number; max: number; step: number;
  who: string; impact: string; source: string;
  onChange: (v: number) => void
}) {
  const decimals = String(step).includes('.') ? 2 : 0
  const isDrifted = Math.abs(value - systemValue) > step * 0.4
  const fmtVal = (n: number) => unit === '$' ? `$${n.toLocaleString()}` : `${Number(n.toFixed(decimals))}${unit}`

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
      {/* Label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <label style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{label}</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isDrifted && (
            <span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 6px' }}>
              System: {fmtVal(systemValue)}
            </span>
          )}
          <span style={{
            fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '1px 7px',
            background: isDrifted ? '#fef3c7' : '#f0fdf4',
            color: isDrifted ? '#92400e' : '#15803d',
            border: `1px solid ${isDrifted ? '#fde68a' : '#bbf7d0'}`,
          }}>
            {isDrifted ? '● Modified' : '✓ System'}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <input
          value={Number(value.toFixed(decimals))} type="number" min={min} max={max} step={step}
          onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
          style={{ height: 36, borderRadius: 8, border: `1px solid ${isDrifted ? '#fbbf24' : '#cbd5e1'}`, padding: '0 10px', fontSize: 14, textAlign: 'center' as const, fontWeight: 600 }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 28px', gap: 8, alignItems: 'center' }}>
          <button type="button" onClick={() => onChange(clamp(value - step, min, max))}
            style={{ height: 28, borderRadius: 5, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>−</button>
          <input type="range" min={min} max={max} step={step} value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ accentColor: isDrifted ? '#f59e0b' : '#16a34a' }} />
          <button type="button" onClick={() => onChange(clamp(value + step, min, max))}
            style={{ height: 28, borderRadius: 5, border: '1px solid #cbd5e1', background: '#f8fafc', fontSize: 16, lineHeight: 1, cursor: 'pointer' }}>+</button>
        </div>
      </div>

      {/* Who it affects */}
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: '#374151' }}>Applies to: </span>{who}
      </div>
      {/* Impact direction */}
      <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: '#374151' }}>Impact: </span>{impact}
      </div>
      {/* Source */}
      <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' as const }}>
        Industry reference: {source}
      </div>
    </div>
  )
}

function SparkBars({ points, height = 160 }: { points: number[]; height?: number }) {
  const max = Math.max(...points, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height }}>
      {points.map((p, i) => (
        <div key={i} style={{ flex: 1, height: `${(p / max) * 100}%`, borderRadius: 3, background: '#3b82f6', opacity: i % 2 === 0 ? 0.9 : 0.7 }} />
      ))}
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{ margin: '0 0 8px', color: '#475569', fontSize: 16, letterSpacing: 0.3 }}>{title}</h3>
      {subtitle && <p style={{ marginTop: 0, color: '#5f6b7a', fontSize: 14 }}>{subtitle}</p>}
      {children}
    </section>
  )
}

function KvGrid({ items }: { items: [string, string][] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>{k}</div>
          <div style={{ color: '#0f172a', fontSize: 16, fontWeight: 600, marginTop: 4 }}>{v}</div>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════
// ZERO-DEP SVG CHARTS — no recharts, no canvas, no install
// ═══════════════════════════════════════════════════════

// Shared helpers
function svgNum(n: unknown): number { const v = Number(n); return isFinite(v) ? v : 0 }

// ── ChartLensOverlay: circular magnifier rendered inside the SVG ──
function ChartLensOverlay({
  cursorX, cursorY, stacks, hovIdx, xS, yS, zeroY, zoom = 2.8, r = 56,
}: {
  cursorX: number; cursorY: number
  stacks: { idx: number; posTotal: number; negTotal: number; bars: { loanId: string; color: string; val: number; bottom: number; top: number }[] }[]
  hovIdx: number
  xS: (i: number) => number
  yS: (v: number) => number
  zeroY: number
  zoom?: number
  r?: number
}) {
  const cx = cursorX, cy = cursorY
  const clipId = `cashflow-lens-clip-${hovIdx}`
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
          <line x1={xS(start) - origBarW*3} x2={xS(end) + origBarW*3}
            y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth={0.4} />
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
                    const yTop = yS(posCum + bar.val), yBot = yS(posCum)
                    posCum += bar.val
                    return <rect key={bar.loanId} x={bx - bW/2} y={Math.min(yTop, yBot)}
                      width={bW} height={Math.max(0.5, Math.abs(yBot - yTop))}
                      fill={bar.color} opacity={isHov ? 1 : 0.45} />
                  } else {
                    const yTop = yS(negCum), yBot = yS(negCum + bar.val)
                    negCum += bar.val
                    return <rect key={bar.loanId} x={bx - bW/2} y={Math.min(yTop, yBot)}
                      width={bW} height={Math.max(0.5, Math.abs(yBot - yTop))}
                      fill={bar.color} opacity={isHov ? 1 : 0.45} />
                  }
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

function CashFlowChart({ projections, height = 200 }: {
  projections: { month: number; principal: number; interest: number; discountedCF?: number; cumExpectedLoss?: number }[]
  height?: number
}) {
  const [tooltip, setTooltip] = React.useState<{ x: number; y: number; idx: number } | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  if (!projections.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 12 }}>
      No projection data
    </div>
  )

  const W = 700, H = height, PAD = { top: 8, right: 52, bottom: 28, left: 52 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const maxCF   = Math.max(...projections.map(p => svgNum(p.principal) + svgNum(p.interest)), 1)
  const maxLoss = Math.max(...projections.map(p => Math.abs(svgNum((p as any).cumExpectedLoss))), 0.01)
  const n = projections.length
  const barW = Math.max(1, (innerW / n) - 1)

  const yL  = (v: number) => PAD.top + innerH - (v / maxCF)  * innerH
  const yR  = (v: number) => PAD.top + innerH - (v / maxLoss) * innerH
  const xAt = (i: number) => PAD.left + (i / n) * innerW + barW / 2

  // Disc PV polyline
  const pvLine = projections.map((p, i) =>
    `${xAt(i)},${yL(svgNum((p as any).discountedCF))}`).join(' ')
  // Cum loss polyline (right axis)
  const lossLine = projections.map((p, i) =>
    `${xAt(i)},${yR(Math.abs(svgNum((p as any).cumExpectedLoss)))}`).join(' ')

  // Y-axis ticks (left)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: maxCF * f, y: yL(maxCF * f) }))
  // Y-axis ticks (right)
  const yTicksR = [0, 0.5, 1].map(f => ({ v: maxLoss * f, y: yR(maxLoss * f) }))
  // X-axis label every 12 months
  const xLabels = projections.filter(p => p.month % 12 === 0)

  const hoverIdx = tooltip?.idx ?? -1

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }}>
        {/* Grid lines */}
        {yTicks.map(t => (
          <line key={t.v} x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
            stroke="#e2e8f0" strokeWidth={0.5} />
        ))}

        {/* Bars */}
        {projections.map((p, i) => {
          const pri = svgNum(p.principal), int = svgNum(p.interest)
          const total = pri + int
          const x = PAD.left + (i / n) * innerW
          const hPri = (pri / maxCF) * innerH
          const hInt = (int / maxCF) * innerH
          const hover = i === hoverIdx
          return (
            <g key={i}>
              {/* Interest (top) */}
              <rect x={x} y={yL(total)} width={barW} height={hInt}
                fill="#10b981" opacity={hover ? 1 : 0.75} />
              {/* Principal (bottom) */}
              <rect x={x} y={yL(pri)} width={barW} height={hPri}
                fill="#3b82f6" opacity={hover ? 1 : 0.75} />
              {/* Invisible hover target */}
              <rect x={x} y={PAD.top} width={barW} height={innerH}
                fill="transparent"
                onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, idx: i })}
                onMouseLeave={() => setTooltip(null)} />
            </g>
          )
        })}

        {/* Disc PV line */}
        <polyline points={pvLine} fill="none" stroke="#475569" strokeWidth={2.5} strokeDasharray="5 2" />

        {/* Cum Loss line (right axis) */}
        {maxLoss > 0.01 && (
          <polyline points={lossLine} fill="none" stroke="#ef4444" strokeWidth={1.5} />
        )}

        {/* Left Y-axis labels */}
        {yTicks.map(t => (
          <text key={t.v} x={PAD.left - 4} y={t.y + 3} textAnchor="end"
            fontSize={8} fill="#94a3b8">
            ${t.v >= 1000 ? `${(t.v/1000).toFixed(0)}k` : t.v.toFixed(0)}
          </text>
        ))}
        {/* Right Y-axis labels */}
        {maxLoss > 0.01 && yTicksR.map(t => (
          <text key={t.v} x={W - PAD.right + 4} y={t.y + 3} textAnchor="start"
            fontSize={8} fill="#ef4444">
            ${t.v >= 1000 ? `${(t.v/1000).toFixed(1)}k` : t.v.toFixed(0)}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map(p => (
          <text key={p.month} x={xAt(projections.indexOf(p))} y={H - 6}
            textAnchor="middle" fontSize={8} fill="#94a3b8">
            M{p.month}
          </text>
        ))}

        {/* Axis labels */}
        <text x={PAD.left - 36} y={PAD.top + innerH / 2} textAnchor="middle"
          fontSize={8} fill="#94a3b8" transform={`rotate(-90, ${PAD.left - 36}, ${PAD.top + innerH / 2})`}>
          Cash Flow ($)
        </text>
        {maxLoss > 0.01 && (
          <text x={W - PAD.right + 40} y={PAD.top + innerH / 2} textAnchor="middle"
            fontSize={8} fill="#ef4444"
            transform={`rotate(90, ${W - PAD.right + 40}, ${PAD.top + innerH / 2})`}>
            Cum. Loss ($)
          </text>
        )}

        {/* Circular magnifier lens */}
        {tooltip && hoverIdx >= 0 && hoverIdx < projections.length && (() => {
          const rect = svgRef.current?.getBoundingClientRect()
          if (!rect) return null
          const svgX = ((tooltip.x - rect.left) / rect.width) * W
          const svgY = ((tooltip.y - rect.top) / rect.height) * H
          const cfStacks = projections.map((p, i) => ({
            idx: i,
            posTotal: svgNum(p.principal) + svgNum(p.interest),
            negTotal: 0,
            bars: [
              { loanId: 'principal', color: '#3b82f6', val: svgNum(p.principal), bottom: 0, top: svgNum(p.principal) },
              { loanId: 'interest',  color: '#10b981', val: svgNum(p.interest),  bottom: svgNum(p.principal), top: svgNum(p.principal) + svgNum(p.interest) },
            ],
          }))
          const cfXS = (i: number) => xAt(i)
          const cfYS = (v: number) => yL(v)
          return (
            <ChartLensOverlay
              cursorX={svgX}
              cursorY={svgY}
              stacks={cfStacks}
              hovIdx={hoverIdx}
              xS={cfXS}
              yS={cfYS}
              zeroY={yL(0)}
            />
          )
        })()}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 10, color: '#64748b' }}>
        {[
          { color: '#3b82f6', label: 'Principal' },
          { color: '#10b981', label: 'Interest' },
          { color: '#475569', label: 'Disc. PV', dash: true },
          ...(maxLoss > 0.01 ? [{ color: '#ef4444', label: 'Cum. Loss' }] : []),
        ].map(({ color, label, dash }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={20} height={8}>
              {dash
                ? <line x1={0} y1={4} x2={20} y2={4} stroke={color} strokeWidth={2.5} strokeDasharray="5 2" />
                : <rect x={0} y={1} width={20} height={6} fill={color} opacity={0.8} rx={1} />}
            </svg>
            {label}
          </div>
        ))}
      </div>

      {/* Tooltip */}
            {tooltip && hoverIdx >= 0 && hoverIdx < projections.length && (() => {
        const p = projections[hoverIdx]
        const total = svgNum(p.principal) + svgNum(p.interest)
        const fmtD = (v: number) => `$${Math.abs(v) >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)}`
        return (
          <div style={{
            position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 10,
            background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            padding: '8px 12px', fontSize: 11, color: '#0f172a', zIndex: 9999,
            pointerEvents: 'none', minWidth: 160,
          }}>
            <div style={{ fontWeight: 700, color: '#64748b', marginBottom: 5 }}>Month {p.month}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#3b82f6' }}>Principal</span>
              <span>{fmtD(svgNum(p.principal))}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#10b981' }}>Interest</span>
              <span>{fmtD(svgNum(p.interest))}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#64748b' }}>Total CF</span>
              <span>{fmtD(total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#475569' }}>Disc. PV</span>
              <span>{fmtD(svgNum((p as any).discountedCF))}</span>
            </div>
            {Math.abs(svgNum((p as any).cumExpectedLoss)) > 0.01 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: '#ef4444' }}>Cum. Loss</span>
                <span>{fmtD(Math.abs(svgNum((p as any).cumExpectedLoss)))}</span>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ── MiniLineChart: simple SVG line (for default curve + CPR) ──
function MiniLineChart({ data, color, yLabel, height = 120 }: {
  data: number[]
  color: string
  yLabel?: string
  height?: number
}) {
  if (!data.length) return null
  const W = 300, H = height, PAD = { top: 6, right: 8, bottom: 22, left: 32 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const maxY = Math.max(...data, 0.01)
  const n = data.length

  const pts = data.map((v, i) => {
    const x = PAD.left + (i / (n - 1)) * innerW
    const y = PAD.top + innerH - (v / maxY) * innerH
    return `${x},${y}`
  }).join(' ')

  const fillPts = [
    `${PAD.left},${PAD.top + innerH}`,
    ...data.map((v, i) => `${PAD.left + (i / (n - 1)) * innerW},${PAD.top + innerH - (v / maxY) * innerH}`),
    `${PAD.left + innerW},${PAD.top + innerH}`,
  ].join(' ')

  const yTicks = [0, 0.5, 1].map(f => ({ v: maxY * f, y: PAD.top + innerH - f * innerH }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }}>
      {/* Fill */}
      <polygon points={fillPts} fill={color} opacity={0.08} />
      {/* Grid */}
      {yTicks.map(t => (
        <line key={t.v} x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y}
          stroke="#e2e8f0" strokeWidth={0.5} />
      ))}
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {/* Dots */}
      {data.map((v, i) => (
        <circle key={i}
          cx={PAD.left + (i / (n - 1)) * innerW}
          cy={PAD.top + innerH - (v / maxY) * innerH}
          r={3} fill={color} />
      ))}
      {/* Y labels */}
      {yTicks.map(t => (
        <text key={t.v} x={PAD.left - 3} y={t.y + 3} textAnchor="end" fontSize={8} fill="#94a3b8">
          {t.v.toFixed(1)}%
        </text>
      ))}
      {/* X labels */}
      {data.map((_, i) => (
        <text key={i} x={PAD.left + (i / (n - 1)) * innerW} y={H - 4}
          textAnchor="middle" fontSize={8} fill="#94a3b8">
          Y{i + 1}
        </text>
      ))}
      {/* Y axis title */}
      {yLabel && (
        <text x={10} y={PAD.top + innerH / 2} textAnchor="middle" fontSize={7} fill="#94a3b8"
          transform={`rotate(-90, 10, ${PAD.top + innerH / 2})`}>
          {yLabel}
        </text>
      )}
    </svg>
  )
}

// ── Tearsheet style constants — light mode to match main page ──
const tsStyles = {
  kpiCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '12px 14px',
  } as React.CSSProperties,
  kpiHighlight: {
    background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
    border: '1px solid #93c5fd',
  } as React.CSSProperties,
  kpiLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    color: '#94a3b8',
    marginBottom: 6,
  } as React.CSSProperties,
  kpiValue: {
    fontSize: 17,
    fontWeight: 800,
    color: '#0f172a',
    fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  chartBox: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    padding: '12px 14px',
    marginBottom: 10,
  } as React.CSSProperties,
  sectionHead: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
    color: '#94a3b8',
    marginBottom: 10,
    textTransform: 'uppercase' as const,
  } as React.CSSProperties,
  miniTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as React.CSSProperties,
  miniTd: {
    padding: '5px 0',
    fontSize: 12,
    color: '#64748b',
    borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'middle' as const,
    paddingRight: 12,
  } as React.CSSProperties,
  miniTdVal: {
    padding: '5px 0',
    fontSize: 12,
    color: '#0f172a',
    fontWeight: 600,
    borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'middle' as const,
    textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
}

// ── FICO band helper (full label) ──
function ficoBandLabel(fico: number | null): string {
  if (fico == null) return '—'
  if (fico >= 800) return 'Exceptional (800–850)'
  if (fico >= 740) return 'Very Good (740–799)'
  if (fico >= 670) return 'Good (670–739)'
  if (fico >= 580) return 'Fair (580–669)'
  return 'Poor (<580)'
}

// ── Tier badge ──
const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  LOW:       { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  MEDIUM:    { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  HIGH:      { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' },
  VERY_HIGH: { bg: '#f5f3ff', text: '#6d28d9', border: '#ddd6fe' },
}
function TierBadge({ tier }: { tier: string }) {
  const c = TIER_COLORS[tier] ?? { bg: '#f8fafc', text: '#475569', border: '#e2e8f0' }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
    }}>
      {tier.replace('_', ' ')}
    </span>
  )
}

function ValuationLoanDrawerBody({ row, savedAssumptions, ownershipMode }: {
  row: RowModel
  savedAssumptions: Assumptions
  ownershipMode: OwnershipMode
}) {
  const [curvesOpen, setCurvesOpen] = React.useState(false)
  const { user, loan } = row
  const rb  = user.riskBreakdown ?? {}
  const crv = (user as any).curve ?? null

  // ── Normalise rate ──
  const displayRate = row.rate <= 1 ? row.rate * 100 : row.rate

  // ── Ownership display ──
  const ownershipDisplay =
    ownershipMode === 'market'
      ? `${fmtPct(row.marketPct * 100, 1)} Market`
      : ownershipMode === 'all' && row.marketPct > 0
        ? `${fmtPct(row.userPct * 100, 1)} / ${fmtPct(row.marketPct * 100, 1)} Mkt`
        : fmtPct(row.userPct * 100, 1)

  // ── Borrower data from loan ──
  const borrower = (row as any).loan
  const degreeType    = borrower?.degreeType ?? (loan as any)?.degreeType ?? '—'
  const yearInSchool  = borrower?.yearInSchool ?? (loan as any)?.yearInSchool ?? '—'
  const isGrad        = borrower?.isGraduateStudent ?? (loan as any)?.isGraduateStudent ?? false
  const schoolName    = row.schoolName || (loan as any)?.school || '—'

  // ── Default + CPR curve data ──
  const defData: number[] = crv?.defaultCurve?.cumulativeDefaultPct ?? []
  const cprData: number[] = crv?.prepaymentCurve?.valuesPct ?? []

  const S = tsStyles

  return (
    <div style={{
      fontFamily: "inherit",
      background: '#f8fafc',
      margin: -16,
      padding: 16,
      minHeight: '100%',
    }}>

      {/* ── KPI BAR ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {/* NPV — highlighted */}
        <div style={{ ...S.kpiCard, ...S.kpiHighlight }}>
          <div style={{ ...S.kpiLabel, color: '#3b82f6' }}>NET PRESENT VALUE</div>
          <div style={{ ...S.kpiValue, color: '#1d4ed8', fontSize: 20 }}>{fmtCurrency(user.npv)}</div>
          <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2 }}>
            {user.npvPct >= 0 ? '+' : ''}{fmtPct(user.npvPct, 1)} vs. par
          </div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>IRR</div>
          <div style={{ ...S.kpiValue, color: user.irr >= 9 ? '#16a34a' : user.irr >= 5 ? '#d97706' : '#dc2626' }}>
            {fmtPct(user.irr, 2)}
          </div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>EXPECTED LOSS</div>
          <div style={{ ...S.kpiValue, color: user.expectedLossPct <= 5 ? '#64748b' : '#dc2626' }}>
            {fmtPct(user.expectedLossPct, 2)}
          </div>
        </div>
        <div style={S.kpiCard}>
          <div style={S.kpiLabel}>WEIGHTED AVG LIFE</div>
          <div style={{ ...S.kpiValue, color: '#0f172a' }}>{fmtNum(user.wal, 1)} <span style={{ fontSize: 13, color: '#94a3b8' }}>yrs</span></div>
        </div>
      </div>

      {/* ── CASH FLOW CHART ── */}
      <div style={S.chartBox}>
        <div style={S.sectionHead}>PROJECTED RISK-ADJUSTED CASH FLOW</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
          Monthly principal + interest with discounted PV overlay and cumulative expected loss
        </div>
        {user.projections.length > 0 ? (
          <CashFlowChart projections={user.projections} height={200} />
        ) : (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
            No projection data
          </div>
        )}
      </div>

      {/* ── TWO COLUMN: LOAN FACTS + RISK BREAKDOWN ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>

        {/* LEFT: Loan Inputs + Borrower Profile */}
        <div>
          <div style={S.chartBox}>
            <div style={S.sectionHead}>LOAN INPUTS</div>
            <table style={S.miniTable}>
              <tbody>
                {([
                  ['Original Principal', fmtCurrency(row.originalLoan)],
                  ['Invested Amount',    fmtCurrency(row.invested)],
                  ['Coupon Rate',        fmtPct(displayRate, 2)],
                  ['Term',              `${(loan as any)?.termYears ?? (loan as any)?.term ?? '—'} yrs`],
                  ['Ownership',         ownershipDisplay],
                  ['Purchase Date',     (loan as any)?.purchaseDate ?? '—'],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k}>
                    <td style={S.miniTd}>{k}</td>
                    <td style={{ ...S.miniTdVal }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ ...S.chartBox, marginTop: 10 }}>
            <div style={S.sectionHead}>BORROWER PROFILE</div>
            <table style={S.miniTable}>
              <tbody>
                <tr>
                  <td style={S.miniTd}>School</td>
                  <td style={S.miniTdVal}>{schoolName}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>School Tier</td>
                  <td style={S.miniTdVal}><TierBadge tier={String(rb.schoolTier ?? user.schoolTier ?? '—')} /></td>
                </tr>
                <tr>
                  <td style={S.miniTd}>Borrower FICO</td>
                  <td style={S.miniTdVal}>{user.borrowerFico ?? '—'}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>Cosigner FICO</td>
                  <td style={S.miniTdVal}>{user.cosignerFico ?? '—'}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>FICO Band</td>
                  <td style={S.miniTdVal}>{ficoBandLabel(user.borrowerFico)}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>Degree Type</td>
                  <td style={S.miniTdVal}>{degreeType}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>Year in School</td>
                  <td style={S.miniTdVal}>{yearInSchool}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>Graduate Student</td>
                  <td style={S.miniTdVal}>{isGrad ? 'Yes' : 'No'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: Derived Risk + Discount Rate Build-up */}
        <div>
          <div style={S.chartBox}>
            <div style={S.sectionHead}>DERIVED RISK FACTORS</div>
            <div style={{ marginBottom: 8 }}>
              <TierBadge tier={user.riskTier} />
            </div>
            <table style={S.miniTable}>
              <thead>
                <tr>
                  <th style={{ ...S.miniTd, color: '#94a3b8', fontWeight: 600, fontSize: 10, paddingBottom: 4 }}>Factor</th>
                  <th style={{ ...S.miniTdVal, color: '#94a3b8', fontWeight: 600, fontSize: 10, paddingBottom: 4, textAlign: 'right' as const }}>bps</th>
                </tr>
              </thead>
              <tbody>
                {([
                  ['Base Risk Premium', rb.baseRiskBps],
                  ['FICO Adjustment',   rb.ficoAdj],
                  ['School Adjustment', rb.schoolAdj],
                  ['Degree Adjustment', rb.degreeAdj],
                  ['Year Adjustment',   rb.yearAdj],
                  ['Grad Adjustment',   rb.gradAdj],
                ] as [string, number | undefined][]).map(([k, v]) => {
                  const n = Number(v ?? 0)
                  const color = k === 'Base Risk Premium' ? '#0f172a' : n > 0 ? '#dc2626' : n < 0 ? '#16a34a' : '#64748b'
                  return (
                    <tr key={k}>
                      <td style={S.miniTd}>{k}</td>
                      <td style={{ ...S.miniTdVal, textAlign: 'right' as const, color, fontWeight: 600 }}>
                        {v == null ? '—' : n > 0 ? `+${n}` : String(n)}
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ ...S.miniTd, fontWeight: 700, color: '#0f172a' }}>Total Risk (bps)</td>
                  <td style={{ ...S.miniTdVal, fontWeight: 700, color: '#0f172a', textAlign: 'right' as const }}>
                    {rb.totalRiskBps ?? '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ ...S.chartBox, marginTop: 10 }}>
            <div style={S.sectionHead}>DISCOUNT RATE BUILD-UP</div>
            <table style={S.miniTable}>
              <tbody>
                {([
                  ['Risk-Free Rate',     fmtPct(savedAssumptions.baseRiskFreeRate, 2)],
                  ['Risk Premium (bps)', String(savedAssumptions.riskPremiumBps[user.riskTier] ?? '—')],
                  ['Adj to Cap (bps)',   String(rb.cappedAdjBps ?? '—')],
                ] as [string, string][]).map(([k, v]) => (
                  <tr key={k}>
                    <td style={S.miniTd}>{k}</td>
                    <td style={S.miniTdVal}>{v}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ ...S.miniTd, fontWeight: 700, color: '#0f172a' }}>Total Discount Rate</td>
                  <td style={{ ...S.miniTdVal, fontWeight: 700, color: '#2563eb' }}>{fmtPct(user.discRate, 3)}</td>
                </tr>
                <tr>
                  <td style={S.miniTd}>Recovery Rate</td>
                  <td style={S.miniTdVal}>{fmtPct(savedAssumptions.recoveryRate[user.riskTier] ?? 0, 0)}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ marginTop: 12 }}>
              <div style={S.sectionHead}>VALUATION SUMMARY</div>
              <table style={S.miniTable}>
                <tbody>
                  {([
                    ['NPV',           fmtCurrency(user.npv)],
                    ['NPV / Par',     fmtPct(user.npvPct, 2)],
                    ['IRR',           fmtPct(user.irr, 2)],
                    ['Expected Loss', fmtPct(user.expectedLossPct, 2)],
                    ['WAL',           `${fmtNum(user.wal, 1)} yrs`],
                  ] as [string, string][]).map(([k, v]) => (
                    <tr key={k}>
                      <td style={S.miniTd}>{k}</td>
                      <td style={S.miniTdVal}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── RISK CURVES: Default + CPR ── */}
      {(defData.length > 0 || cprData.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          {/* Cumulative Default */}
          <div style={S.chartBox}>
            <div style={S.sectionHead}>CUMULATIVE DEFAULT CURVE</div>
            {defData.length > 0 && (
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                End-of-term: {(defData[defData.length - 1] ?? 0).toFixed(1)}%
              </div>
            )}
            <MiniLineChart data={defData} color="#ef4444" yLabel="Cum. Default %" height={120} />
          </div>

          {/* CPR */}
          <div style={S.chartBox}>
            <div style={S.sectionHead}>ANNUAL PREPAYMENT (CPR)</div>
            {cprData.length > 0 && (
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                Peak: {Math.max(...cprData).toFixed(1)}%
              </div>
            )}
            <MiniLineChart data={cprData} color="#0ea5e9" yLabel="Annual CPR %" height={120} />
          </div>
        </div>
      )}

      {/* ── COLLAPSIBLE CURVE DETAILS ── */}
      {crv && (
        <div style={S.chartBox}>
          <button
            type="button"
            onClick={() => setCurvesOpen(o => !o)}
            style={{ ...S.sectionHead, background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left' as const, display: 'flex', justifyContent: 'space-between', padding: 0 }}
          >
            <span>CURVE DETAILS ({user.riskTier} tier)</span>
            <span style={{ fontSize: 14, color: '#475569' }}>{curvesOpen ? '▲' : '▼'}</span>
          </button>
          {curvesOpen && (
            <div style={{ marginTop: 12 }}>
              <table style={{ ...S.miniTable, width: '100%' }}>
                <thead>
                  <tr>
                    {['Curve', 'Values', 'Notes'].map(h => (
                      <th key={h} style={{ ...S.miniTd, fontWeight: 600, color: '#475569', fontSize: 10, paddingBottom: 6 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={S.miniTd}>Base risk premium</td>
                    <td style={S.miniTdVal}>{crv.riskPremiumBps?.toLocaleString() ?? '—'} bps</td>
                    <td style={{ ...S.miniTd, color: '#64748b' }}>before adjustments</td>
                  </tr>
                  <tr>
                    <td style={S.miniTd}>Cumulative default (Yr 1–{defData.length})</td>
                    <td style={{ ...S.miniTdVal, fontSize: 10 }}>
                      {defData.map((v: number) => v.toFixed(1)).join(' → ')}%
                    </td>
                    <td style={{ ...S.miniTd, color: '#64748b' }}>interpolated to monthly PD</td>
                  </tr>
                  <tr>
                    <td style={S.miniTd}>Annual CPR (Yr 1–{cprData.length})</td>
                    <td style={{ ...S.miniTdVal, fontSize: 10 }}>
                      {cprData.map((v: number) => v.toFixed(1)).join(' → ')}%
                    </td>
                    <td style={{ ...S.miniTd, color: '#64748b' }}>converted to monthly SMM</td>
                  </tr>
                  <tr>
                    <td style={S.miniTd}>Recovery</td>
                    <td style={S.miniTdVal}>
                      {crv.recovery?.grossRecoveryPct ?? '—'}% after {crv.recovery?.recoveryLagMonths ?? '—'} months
                    </td>
                    <td style={{ ...S.miniTd, color: '#64748b' }}>applied to default amounts</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 8, fontStyle: 'italic' }}>
                Base assumptions for the {user.riskTier} tier. Degree, school, and year adjustments apply to discount rate only (additive bps).
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ── Style constants ──
const actionButton: React.CSSProperties       = { height: 36, padding: '0 14px', borderRadius: 10, border: '1px solid #cfd8d3', background: '#fff', color: '#1f2937', fontSize: 14, fontWeight: 500, cursor: 'pointer' }
const groupHead: React.CSSProperties          = { padding: '9px 8px', textAlign: 'center', borderBottom: '1px solid #d8dfdc', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: '#64748b' }
const subHead: React.CSSProperties            = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #d8dfdc', fontWeight: 600, fontSize: 13, color: '#475569' }
const cell: React.CSSProperties               = { padding: '8px 10px', borderBottom: '1px solid #e5ece9', color: '#0f172a', fontSize: 13 }
const topTabBaseStyle: React.CSSProperties    = { background: 'none', border: 'none', padding: '14px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer', color: '#64748b', borderBottom: '2px solid transparent', marginBottom: -1 }

function deltaColor(v: number) { return Math.abs(v) < 0.005 ? '#64748b' : v > 0 ? '#16a34a' : '#dc2626' }
function deltaMoney(v: number) { return Math.abs(v) < 0.5   ? '' : `${v > 0 ? '+' : '-'}${fmtCurrency(Math.abs(v))}` }
function deltaPct(v: number, d = 1) { return Math.abs(v) < 0.005 ? '' : `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}%` }
function deltaNum(v: number, d = 1) { return Math.abs(v) < 0.005 ? '' : `${v > 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}` }
