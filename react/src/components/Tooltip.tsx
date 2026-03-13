import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
  lines: string[]
  children: React.ReactNode
}

export function Tooltip({ lines, children }: TooltipProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY })
  }, [])
  const handleMouseLeave = useCallback(() => { setPos(null) }, [])

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {pos && createPortal(
        <div style={{
          position: 'fixed', left: pos.x, top: pos.y - 10,
          transform: 'translate(-50%, -120%)',
          background: '#0f172a', color: '#f8fafc',
          padding: '6px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.6,
          boxShadow: '0 6px 18px rgba(2,6,23,0.2)',
          border: '1px solid rgba(148,163,184,0.3)',
          pointerEvents: 'none', zIndex: 99999, whiteSpace: 'nowrap',
        }}>
          {lines.map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>{line}</div>
          ))}
        </div>,
        document.body
      )}
    </span>
  )
}
