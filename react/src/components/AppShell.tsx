import { useState } from 'react'
import { useUser } from '../context/UserContext'
import type { UserId } from '../context/UserContext'

const NAV_ITEMS = [
  { icon: 'fa-home',         label: 'Home',        active: false, href: 'https://jeff-stratofied.github.io/loan-valuation/admin.html' },
  { icon: 'fa-chart-bar',    label: 'Reporting',   active: true  },
  { icon: 'fa-shopping-cart',label: 'Marketplace', active: false },
  { icon: 'fa-wallet',       label: 'Wallet',      active: false },
  { icon: 'fa-history',      label: 'History',     active: false },
]

const USER_OPTIONS: { value: UserId; label: string }[] = [
  { value: 'jeff',   label: 'Jeff Customer'   },
  { value: 'john',   label: 'John Customer'   },
  { value: 'nick',   label: 'Nick Customer'   },
  { value: 'shane',  label: 'Shane Customer'  },
  { value: 'market', label: 'Market'          },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false)
  const { userId, setUserId } = useUser()

  const displayName = USER_OPTIONS.find(u => u.value === userId)?.label ?? userId

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Sidebar */}
      <nav style={{
        position: 'fixed', left: 0, top: 0, bottom: 0,
        width: expanded ? 260 : 70,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        paddingTop: 20,
        transition: 'width 0.35s ease',
        zIndex: 20, overflow: 'hidden'
      }}>
        {/* Hamburger */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: expanded ? 'flex-start' : 'center',
          marginBottom: 30,
          padding: expanded ? '0 20px' : '0'
        }}>
          <i
            className="fas fa-bars"
            style={{ fontSize: 24, cursor: 'pointer', color: 'var(--text)' }}
            onClick={() => setExpanded(e => !e)}
          />
        </div>

        {/* Nav items */}
        {NAV_ITEMS.map(item => {
          const inner = (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center',
              padding: expanded ? '16px 24px' : '16px 0',
              justifyContent: expanded ? 'flex-start' : 'center',
              cursor: 'pointer',
              color: item.active ? 'var(--brand)' : 'var(--text)',
              fontWeight: item.active ? 600 : 400,
              borderRadius: expanded ? 8 : 0,
            }}>
              <i className={`fas ${item.icon}`} style={{ fontSize: 24, width: 40, textAlign: 'center' }} />
              {expanded && <span style={{ marginLeft: 20, fontSize: 16, whiteSpace: 'nowrap' }}>{item.label}</span>}
            </div>
          )
          if ((item as any).href) {
            return (
              <a key={item.label} href={(item as any).href}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                {inner}
              </a>
            )
          }
          return inner
        })}
      </nav>

      {/* Overlay when sidebar expanded */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{
            position: 'fixed', inset: 0,
            zIndex: 19,
            background: 'rgba(0,0,0,0.15)',
          }}
        />
      )}

      {/* Main area */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        marginLeft: 70,
      }}>

        {/* Top header */}
        <header style={{
          height: 60, background: '#fff',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
          padding: '0 30px', gap: 20,
          boxShadow: 'var(--shadow)', flexShrink: 0
        }}>
          <img
            src="https://jeff-stratofied.github.io/loan-dashboard/assets/Full_Color.png"
            alt="STRATOFIED"
            style={{ height: 42, marginRight: 'auto' }}
          />

          {/* DEV user switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>
              User (DEV only):
            </span>
            <select
              value={userId}
              onChange={e => {
                console.log('[DEV] setUserId called with:', e.target.value)
                setUserId(e.target.value as UserId)
              }}
              style={{
                padding: '5px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--text)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {USER_OPTIONS.map(u => (
                <option key={u.value} value={u.value}>{u.label}</option>
              ))}
            </select>
          </div>

          {/* User avatar + name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#e2e8f0', display: 'flex',
              alignItems: 'center', justifyContent: 'center'
            }}>
              <i className="fas fa-user" style={{ color: '#64748b', fontSize: 20 }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 500 }}>{displayName}</span>
          </div>

          <span style={{ color: '#10b981', fontWeight: 600, fontSize: 14 }}>✓ Connected</span>
          <i className="fas fa-sign-out-alt" style={{ color: 'var(--muted)', fontSize: 20, cursor: 'pointer' }} />
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)', padding: '16px 20px 40px' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
