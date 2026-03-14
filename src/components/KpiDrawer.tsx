import DrawerShell from './DrawerShell'

export type KpiType = 'tpv' | 'rates' | 'payments' | 'distribution'

interface KpiDrawerProps {
  kpi: KpiType | string | null
  onClose: () => void
  open?: boolean
  title?: React.ReactNode
  subTitle?: React.ReactNode
  children?: React.ReactNode
}

const btnStyle: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

export default function KpiDrawer({
  kpi,
  onClose,
  open,
  title,
  subTitle,
  children,
}: KpiDrawerProps) {
  const isOpen = open ?? !!kpi
  if (!isOpen) return null

  return (
    <DrawerShell
      open={isOpen}
      onClose={onClose}
      title={title}
      subTitle={subTitle}
      headerActions={<button style={btnStyle}>Download CSV</button>}
      footer={
        <>
          <button style={btnStyle}>Print</button>
          <button style={btnStyle}>Copy CSV</button>
        </>
      }
    >
      {children}
    </DrawerShell>
  )
}