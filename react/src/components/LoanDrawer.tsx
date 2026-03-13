import DrawerShell from './DrawerShell'
import type { Loan2 } from './LoanTable'

interface LoanDrawerProps {
  loan: Loan2 | null
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  subTitle?: React.ReactNode
  width?: number
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

export default function LoanDrawer({
  loan,
  open,
  onClose,
  title,
  subTitle,
  width,
  children,
}: LoanDrawerProps) {
  if (!open || !loan) return null

  return (
    <DrawerShell
      open={open}
      onClose={onClose}
      title={title}
      subTitle={subTitle}
      width={width}
      headerActions={
        <button type="button" style={btnStyle}>
          Download CSV
        </button>
      }
      footer={
        <>
          <button type="button" style={btnStyle}>
            Print
          </button>
          <button type="button" style={btnStyle}>
            Copy CSV
          </button>
        </>
      }
    >
      {children}
    </DrawerShell>
  )
}