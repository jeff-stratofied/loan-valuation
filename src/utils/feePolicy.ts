import { getUserById } from './users'

function normalizeFeeWaiverValue(value?: string) {
  return value || 'none'
}

function resolveUserObject(user: any) {
  if (!user) return null
  if (typeof user === 'string') return getUserById(user)
  return user
}

export function isFeeWaived(
  user: any,
  loan: any,
  type: 'setup' | 'servicing',
  context?: {
    isGraceMonth?: boolean
    isDeferralMonth?: boolean
  }
): boolean {
  const resolvedUser = resolveUserObject(user)

  const loanFeeWaiver = normalizeFeeWaiverValue(loan?.feeWaiver)
  const userFeeWaiver = normalizeFeeWaiverValue(resolvedUser?.feeWaiver)

  const effectiveWaiver = loanFeeWaiver !== 'none' ? loanFeeWaiver : userFeeWaiver

  if (effectiveWaiver === 'all') return true
  if (effectiveWaiver === 'setup') return type === 'setup'

  if (effectiveWaiver === 'grace') {
    return type === 'setup' || type === 'servicing'
  }

  if (effectiveWaiver === 'grace_deferral') {
    return !!(context?.isGraceMonth || context?.isDeferralMonth)
  }

  return false
}

export function resolveFeeWaiverFlags(
  user: any,
  loan: any,
  context?: {
    isGraceMonth?: boolean
    isDeferralMonth?: boolean
  }
) {
  const waiveSetup = isFeeWaived(user, loan, 'setup', context)
  const waiveMonthly = isFeeWaived(user, loan, 'servicing', context)
  const waiveAll = waiveSetup && waiveMonthly

  return {
    waiveSetup,
    waiveMonthly,
    waiveAll,
  }
}