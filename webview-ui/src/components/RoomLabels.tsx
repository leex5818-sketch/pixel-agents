import { useState, useEffect } from 'react'
import { TILE_SIZE } from '../office/types.js'

interface RoomLabelsProps {
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  containerRef: React.RefObject<HTMLDivElement | null>
  cols: number
  rows: number
}

interface RoomLabel {
  name: string
  tileCol: number
  tileRow: number
}

// Room label anchor positions (tile coordinates, top-left of label area)
const ROOM_LABELS: RoomLabel[] = [
  { name: 'Conference', tileCol: 1.3, tileRow: 6.3 },  // 회의실 하단 (가구 아래)
  { name: 'Office 1',   tileCol: 1.3, tileRow: 9.3 },
  { name: 'Office 2',   tileCol: 1.3, tileRow: 15.3 },
  { name: 'Office 3',   tileCol: 1.3, tileRow: 19.3 },
  { name: 'Office 4',   tileCol: 1.3, tileRow: 23.3 },
  { name: 'Main',       tileCol: 7.3, tileRow: 9.3 },
  { name: 'Entry',      tileCol: 15.2, tileRow: 10.3 },
  { name: 'Break',      tileCol: 14.5, tileRow: 20.3 },
]

export function RoomLabels({ zoom, panRef, containerRef }: RoomLabelsProps) {
  // RAF tick — forces re-render every frame so panRef changes are reflected
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => { setTick((n) => n + 1); rafId = requestAnimationFrame(tick) }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null

  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)

  // Must match ToolOverlay coordinate calculation
  const layout = { cols: 20, rows: 27 }
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  return (
    <>
      {ROOM_LABELS.map((label) => {
        const screenX = (deviceOffsetX + label.tileCol * TILE_SIZE * zoom) / dpr
        const screenY = (deviceOffsetY + label.tileRow * TILE_SIZE * zoom) / dpr

        return (
          <div
            key={label.name}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              pointerEvents: 'none',
              zIndex: 45,
              transform: 'none',
            }}
          >
            <span
              style={{
                fontSize: `${Math.max(9, Math.round(10 * zoom))}px`,
                fontWeight: 'bold',
                color: 'rgba(255, 255, 255, 0.92)',
                fontFamily: 'inherit',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                userSelect: 'none',
                display: 'block',
                textShadow: [
                  '0 0 6px rgba(0,0,0,1)',
                  '1px 1px 0 rgba(0,0,0,1)',
                  '-1px -1px 0 rgba(0,0,0,1)',
                  '1px -1px 0 rgba(0,0,0,1)',
                  '-1px 1px 0 rgba(0,0,0,1)',
                  '2px 2px 4px rgba(0,0,0,0.9)',
                ].join(', '),
              }}
            >
              {label.name}
            </span>
          </div>
        )
      })}
    </>
  )
}
