import { useState } from 'react'
import { Tooltip } from './Tooltip'

interface Props {
  userPct: number    // 0–1, user's ownership slice
  marketPct: number  // 0–1, market's ownership slice
  color: string      // user slice color (loan's assigned color)
  size?: number
  label?: string     // override tooltip text
}

export default function OwnershipPie({ userPct, marketPct, color, size = 26, label }: Props) {
  const [hovered, setHovered] = useState(false)

  const clampedUser   = Math.max(0, Math.min(1, userPct))
  const clampedMarket = Math.max(0, Math.min(1, marketPct))
  const total = clampedUser + clampedMarket
  if (total === 0) return null

  const slices      = 20
  const userSlices  = Math.round(clampedUser   * slices)
  const mktSlices   = Math.round(clampedMarket * slices)
  const cx = 12, cy = 12, radius = 9
  const sliceAngle  = 360 / slices
  const rads = (d: number) => (Math.PI / 180) * d

  const MARKET_COLOR = '#94a3b8'

  const paths: JSX.Element[] = []
  let currentSlice = 0

  for (let i = 0; i < userSlices; i++) {
    const start = currentSlice * sliceAngle, end = start + sliceAngle
    const x1 = cx + radius * Math.cos(rads(start - 90)), y1 = cy + radius * Math.sin(rads(start - 90))
    const x2 = cx + radius * Math.cos(rads(end   - 90)), y2 = cy + radius * Math.sin(rads(end   - 90))
    paths.push(<path key={`u${i}`} d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`} fill={color} stroke="#e2e8f0" strokeWidth={0.5} />)
    currentSlice++
  }

  for (let i = 0; i < mktSlices; i++) {
    const start = currentSlice * sliceAngle, end = start + sliceAngle
    const x1 = cx + radius * Math.cos(rads(start - 90)), y1 = cy + radius * Math.sin(rads(start - 90))
    const x2 = cx + radius * Math.cos(rads(end   - 90)), y2 = cy + radius * Math.sin(rads(end   - 90))
    paths.push(<path key={`m${i}`} d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`} fill={MARKET_COLOR} stroke="#e2e8f0" strokeWidth={0.5} />)
    currentSlice++
  }

  while (currentSlice < slices) {
    const start = currentSlice * sliceAngle, end = start + sliceAngle
    const x1 = cx + radius * Math.cos(rads(start - 90)), y1 = cy + radius * Math.sin(rads(start - 90))
    const x2 = cx + radius * Math.cos(rads(end   - 90)), y2 = cy + radius * Math.sin(rads(end   - 90))
    paths.push(<path key={`e${currentSlice}`} d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`} fill="transparent" stroke="#e2e8f0" strokeWidth={0.5} />)
    currentSlice++
  }

  const tooltipText = label ??
    (clampedUser > 0 && clampedMarket > 0
      ? `${Math.round(clampedUser * 100)}% Owned / ${Math.round(clampedMarket * 100)}% Market`
      : clampedMarket > 0
        ? `${Math.round(clampedMarket * 100)}% Market`
        : `${Math.round(clampedUser * 100)}% Owned`)

  return (
    <Tooltip lines={[tooltipText]}>
      <svg viewBox="0 0 24 24" width={size} height={size}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer', display: 'block', flexShrink: 0,
          transition: 'transform 0.15s ease', transform: hovered ? 'scale(1.5)' : 'scale(1)' }}
      >
        {paths}
      </svg>
    </Tooltip>
  )
}