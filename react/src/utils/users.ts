type UserRecord = {
  id: string
  name: string
  role: string
  feeWaiver: string
}

export let USERS: Record<string, UserRecord> = {}

export async function loadUsers(
  backendUrl = 'https://loan-valuation-api.jeff-263.workers.dev'
) {
  try {
    const res = await fetch(`${backendUrl}/platformConfig`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`platformConfig fetch failed: ${res.status}`)

    const data = await res.json()

    USERS = {}
    ;(data.users || []).forEach((u: any) => {
      if (u.id && u.active !== false) {
        USERS[u.id] = {
          id: u.id,
          name: u.name || u.id,
          role: u.role || 'unknown',
          feeWaiver: u.feeWaiver || 'none',
        }
      }
    })
  } catch (err) {
    console.error('Users load failed:', err)

    USERS = {
      jeff:   { id: 'jeff',   name: 'Jeff',   role: 'lender',   feeWaiver: 'all' },
      nick:   { id: 'nick',   name: 'Nick',   role: 'lender',   feeWaiver: 'setup' },
      john:   { id: 'john',   name: 'John',   role: 'investor', feeWaiver: 'none' },
      market: { id: 'market', name: 'Market', role: 'market',   feeWaiver: 'none' },
      shane:  { id: 'shane',  name: 'Shane',  role: 'customer', feeWaiver: 'grace_deferral' },
    }
  }
}

export function getUserById(userId: string): UserRecord | null {
  return USERS[userId] || null
}

export function getUserFeeWaiver(userId: string): string {
  return USERS[userId]?.feeWaiver || 'none'
}

export function getUserDisplayName(userId: string): string {
  return USERS[userId]?.name || userId || 'Unknown User'
}