import { createContext, useContext, useState, useCallback } from 'react'

export type UserId = 'jeff' | 'john' | 'nick' | 'shane' | 'market'

interface UserContextValue {
  userId: UserId
  setUserId: (id: UserId) => void
  isMarket: boolean
  /** Increments when user changes; use in key so Reporting page remounts. */
  reportingKey: number
}

const UserContext = createContext<UserContextValue>({
  userId: 'jeff',
  setUserId: () => {},
  isMarket: false,
  reportingKey: 0,
})

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserIdState] = useState<UserId>('jeff')
  const [reportingKey, setReportingKey] = useState(0)

  const setUserId = useCallback((id: UserId) => {
    setUserIdState(id)
    setReportingKey((k) => k + 1)
  }, [])

  return (
    <UserContext.Provider value={{ userId, setUserId, isMarket: userId === 'market', reportingKey }}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}