import { useRef, useEffect } from 'react'

export interface LoanSeries {
  id: string | number
  name: string
  color: string
  data: { date: Date; y: number | null }[]
}

interface RoiChartProps {
  perLoanSeries: LoanSeries[]
  weightedSeries: { date: Date; y: number }[]
  dates: Date[]
  height?: number
  tickSpacingX?: number
  hideWeighted?: boolean
  weightedColor?: string
  weightedWidth?: number
  weightedLabel?: string
  focusedLoanId?: string | number | null
  onFocusLoan?: (id: string | number | null) => void
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
}

export default function RoiChart({
  perLoanSeries,
  weightedSeries,
  dates,
  height = 240,
  tickSpacingX = 24,
  hideWeighted = false,
  weightedColor = '#000',
  weightedWidth = 2.6,
  weightedLabel = 'Weighted',
  focusedLoanId = null,
  onFocusLoan,
}: RoiChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const loanPathMapRef = useRef<Map<string, SVGPathElement>>(new Map())
  const weightedPathRef = useRef<SVGPathElement | null>(null)

  // ─── Build SVG ───────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current
    const tooltip = tooltipRef.current
    const container = containerRef.current
    if (!svg || !tooltip || !container || !dates.length) return

    const w = container.clientWidth || 600
    const h = height
    const pad = 44

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', String(h))
    svg.innerHTML = ''
    loanPathMapRef.current.clear()
    weightedPathRef.current = null

    const svgNS = 'http://www.w3.org/2000/svg'
    const mk = (tag: string) => document.createElementNS(svgNS, tag)

    const ms0 = dates[0].getTime()
    const ms1 = dates[dates.length - 1].getTime()
    const msRange = ms1 - ms0 || 1
    const dateToX = (d: Date) => pad + ((d.getTime() - ms0) / msRange) * (w - pad * 2)

    const ys: number[] = []
    if (!hideWeighted) weightedSeries.forEach(p => ys.push(p.y))
    perLoanSeries.forEach(ls => ls.data.forEach(p => { if (p.y != null) ys.push(p.y) }))
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const rangeY = maxY - minY || 1
    const yScale = (v: number) => pad + (h - pad * 2) - ((v - minY) / rangeY) * (h - pad * 2)

    // Grid + Y labels
    for (let i = 0; i <= 4; i++) {
      const y = pad + (i / 4) * (h - pad * 2)
      const grid = mk('line') as SVGLineElement
      grid.setAttribute('x1', String(pad)); grid.setAttribute('x2', String(w - pad))
      grid.setAttribute('y1', String(y)); grid.setAttribute('y2', String(y))
      grid.setAttribute('stroke', '#e2e8f0'); grid.setAttribute('stroke-opacity', '0.5')
      svg.appendChild(grid)

      const val = maxY - (i / 4) * rangeY
      const lbl = mk('text') as SVGTextElement
      lbl.setAttribute('x', String(pad - 6)); lbl.setAttribute('y', String(y))
      lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('dominant-baseline', 'middle')
      lbl.setAttribute('font-size', '10'); lbl.setAttribute('fill', '#64748b')
      lbl.textContent = (val * 100).toFixed(1) + '%'
      svg.appendChild(lbl)
    }

    function smoothPath(pts: [number, number][], truncated = false): string {
      if (!pts.length) return ''
      let d = `M ${pts[0][0]} ${pts[0][1]}`
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]
        d += ` Q ${x0} ${y0}, ${(x0 + x1) / 2} ${(y0 + y1) / 2}`
      }
      if (!truncated) d += ` T ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`
      return d
    }

    // Loan lines
    perLoanSeries.forEach(ls => {
      const pts = ls.data
        .filter(p => p.y != null)
        .map(p => [dateToX(p.date), yScale(p.y!)] as [number, number])
      if (!pts.length) return

      const truncated = ls.data.filter(p => p.y != null).length < dates.length
      const path = mk('path') as SVGPathElement
      path.setAttribute('d', smoothPath(pts, truncated))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', ls.color || '#888')
      path.setAttribute('stroke-width', '1.4')
      path.setAttribute('stroke-opacity', '0.9')
      path.dataset.loanId = String(ls.id)
      svg.appendChild(path)
      loanPathMapRef.current.set(String(ls.id), path)
    })

    // Weighted line
    if (!hideWeighted && weightedSeries.length) {
      const pts = weightedSeries
        .filter(p => p.y != null)
        .map(p => [dateToX(p.date), yScale(p.y)] as [number, number])
      if (pts.length) {
        let d = `M ${pts[0][0]} ${pts[0][1]}`
        for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0]} ${pts[i][1]}`
        const path = mk('path') as SVGPathElement
        path.setAttribute('d', d); path.setAttribute('fill', 'none')
        path.setAttribute('stroke', weightedColor)
        path.setAttribute('stroke-width', String(weightedWidth))
        path.setAttribute('stroke-opacity', '1')
        weightedPathRef.current = path
        svg.appendChild(path)
      }
    }

    // Today line
    const today = new Date()
    let todayIdx = -1
    dates.forEach((d, i) => { if (d <= today) todayIdx = i })
    if (todayIdx >= 0) {
      const todayX = dateToX(dates[todayIdx])
      const tl = mk('line') as SVGLineElement
      tl.setAttribute('x1', String(todayX)); tl.setAttribute('x2', String(todayX))
      tl.setAttribute('y1', String(pad)); tl.setAttribute('y2', String(h - pad))
      tl.setAttribute('stroke', '#111827'); tl.setAttribute('stroke-dasharray', '4 4')
      tl.setAttribute('stroke-opacity', '0.45')
      svg.appendChild(tl)
    }

    // X labels
    dates.forEach((d, i) => {
      if (i % tickSpacingX !== 0) return
      const t = mk('text') as SVGTextElement
      t.setAttribute('x', String(dateToX(d))); t.setAttribute('y', String(h - 4))
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '10')
      t.setAttribute('fill', '#64748b')
      t.textContent = formatMonthYear(d)
      svg.appendChild(t)
    })

    // Hover crosshair
    const vLine = mk('line') as SVGLineElement
    vLine.setAttribute('stroke', '#111827'); vLine.setAttribute('stroke-dasharray', '3 4')
    vLine.setAttribute('stroke-opacity', '0.5')
    vLine.setAttribute('x1', '-9999'); vLine.setAttribute('x2', '-9999')
    vLine.setAttribute('y1', String(pad)); vLine.setAttribute('y2', String(h - pad))
    svg.appendChild(vLine)

    const onMove = (ev: MouseEvent) => {
      const rect = svg.getBoundingClientRect()
      const scaleX = w / rect.width
      let idx = Math.round((((ev.clientX - rect.left) * scaleX - pad) / (w - pad * 2)) * (dates.length - 1))
      idx = Math.max(0, Math.min(dates.length - 1, idx))
      const date = dates[idx]
      const x = dateToX(date)

      vLine.setAttribute('x1', String(x)); vLine.setAttribute('x2', String(x))

      let html = `<div style="font-weight:700;margin-bottom:6px;font-size:13px">${formatMonthYear(date)}</div>`

      if (!hideWeighted && weightedSeries.length) {
        const wp = weightedSeries.filter(p => p.date <= date).slice(-1)[0]
        if (wp) {
          html += `<div style="margin-bottom:6px;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12)">
            <span style="font-weight:600">${weightedLabel}:</span> ${(wp.y * 100).toFixed(2)}%
          </div>`
        }
      }

      const loanRows = perLoanSeries
        .map(ls => {
          const pt = ls.data.filter(p => p.date <= date && p.y != null).slice(-1)[0]
          return pt ? { name: ls.name, color: ls.color, val: pt.y! } : null
        })
        .filter(Boolean) as { name: string; color: string; val: number }[]

      loanRows.sort((a, b) => b.val - a.val)
      loanRows.forEach(row => {
        html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:2px">
          <span style="width:9px;height:9px;background:${row.color};display:inline-block;border-radius:2px;flex-shrink:0"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:145px">${row.name}</span>
          <span style="font-weight:600;margin-left:4px">${(row.val * 100).toFixed(2)}%</span>
        </div>`
      })

      tooltip.innerHTML = html
      tooltip.style.display = 'block'

      const ttRect = tooltip.getBoundingClientRect()
      const margin = 12
      let left = ev.clientX + 16
      let top = ev.clientY + 16
      if (left + ttRect.width > window.innerWidth - margin) left = ev.clientX - ttRect.width - 16
      if (top + ttRect.height > window.innerHeight - margin) top = ev.clientY - ttRect.height - 16
      tooltip.style.left = left + 'px'; tooltip.style.top = top + 'px'
    }

    const onLeave = () => {
      tooltip.style.display = 'none'
      vLine.setAttribute('x1', '-9999'); vLine.setAttribute('x2', '-9999')
      onFocusLoan?.(null)
    }

    svg.addEventListener('mousemove', onMove)
    svg.addEventListener('mouseleave', onLeave)
    return () => {
      svg.removeEventListener('mousemove', onMove)
      svg.removeEventListener('mouseleave', onLeave)
    }
  }, [perLoanSeries, weightedSeries, dates, height, tickSpacingX, hideWeighted, weightedColor, weightedWidth, weightedLabel])

  // ─── Focus effect: table → chart (no SVG rebuild) ───────────
  useEffect(() => {
    const pathMap = loanPathMapRef.current
    const weightedPath = weightedPathRef.current
    const focusedId = focusedLoanId != null ? String(focusedLoanId) : null

    pathMap.forEach((path, id) => {
      if (!focusedId) {
        path.setAttribute('stroke-opacity', '0.9')
        path.setAttribute('stroke-width', '1.4')
      } else if (id === focusedId) {
        path.setAttribute('stroke-opacity', '1')
        path.setAttribute('stroke-width', '2.8')
      } else {
        path.setAttribute('stroke-opacity', '0.1')
        path.setAttribute('stroke-width', '1.4')
      }
    })

    if (weightedPath) {
      weightedPath.setAttribute('stroke-opacity', focusedId ? '0.15' : '1')
    }
  }, [focusedLoanId])

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ display: 'block', width: '100%' }} />
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          display: 'none',
          background: '#0f172a',
          color: '#f8fafc',
          padding: '10px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          lineHeight: '1.5',
          pointerEvents: 'none',
          zIndex: 9999,
          boxShadow: '0 8px 24px rgba(2,6,23,0.35)',
          border: '1px solid rgba(148,163,184,0.15)',
          minWidth: '180px',
          maxWidth: '280px',
        }}
      />
    </div>
  )
}
