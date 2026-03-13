import React from 'react'

interface DrawerShellProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subTitle?: React.ReactNode
  width?: number
  headerActions?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}

export default function DrawerShell({
  open,
  onClose,
  title,
  subTitle,
  width = 620,
  headerActions,
  footer,
  children,
}: DrawerShellProps) {
  if (!open) return null

  return (
    <>
      {/* Backdrop — click outside to close */}
      <div style={backdrop} onClick={onClose} aria-hidden="true" />

      <div
        data-drawer-shell="true"
        style={{ ...root, width }}
        onClick={(e) => e.stopPropagation()}
      >
      <div style={header}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {title ? <h2 style={titleStyle}>{title}</h2> : null}
          {subTitle ? <div style={subTitleStyle}>{subTitle}</div> : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 12 }}>
          {headerActions}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            style={closeBtn}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
      </div>

      <div style={body}>{children}</div>

      {footer ? <div style={footerStyle}>{footer}</div> : null}
    </div>
    </>
  )
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 99,
  background: 'rgba(15, 23, 42, 0.25)',
}

const root: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  height: '100vh',
  background: 'var(--card)',
  borderLeft: '1px solid var(--border)',
  boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.10)',
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
}

const header: React.CSSProperties = {
  padding: '18px 18px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: 1.2,
  fontWeight: 800,
  color: 'var(--text)',
}

const subTitleStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--muted)',
  whiteSpace: 'pre-line',
}

const body: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 16,
  minHeight: 0,
}

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  padding: 12,
  display: 'flex',
  justifyContent: 'flex-start',
  gap: 10,
}

const closeBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  color: 'var(--muted)',
  padding: 0,
}