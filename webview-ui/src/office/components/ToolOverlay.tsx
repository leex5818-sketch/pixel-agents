import { useState, useEffect } from 'react'
import type { ToolActivity } from '../types.js'
import type { OfficeState } from '../engine/officeState.js'
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js'
import { TILE_SIZE, CharacterState } from '../types.js'
import { TOOL_OVERLAY_VERTICAL_OFFSET, CHARACTER_SITTING_OFFSET_PX } from '../../constants.js'

interface ToolOverlayProps {
  officeState: OfficeState
  agents: number[]
  agentTools: Record<number, ToolActivity[]>
  agentSessionTopics: Record<number, string>
  subagentCharacters: SubagentCharacter[]
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  onCloseAgent: (id: number) => void
}

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  Bash: '💻',
  WebSearch: '🌐',
  WebFetch: '🌐',
  Grep: '🔍',
  Glob: '🔍',
  Task: '👥',
  Agent: '👥',
  AskUserQuestion: '❓',
  EnterPlanMode: '📋',
  NotebookEdit: '📓',
}

/** Derive a short human-readable activity string from tools/status */
function getActiveTool(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): ToolActivity | null {
  const tools = agentTools[agentId]
  if (tools && tools.length > 0) {
    const activeTool = [...tools].reverse().find((t) => !t.done)
    if (activeTool) return activeTool
    if (isActive) return tools[tools.length - 1] || null
  }
  return null
}

function getToolDetail(tool: ToolActivity): string {
  const input = tool.toolInput || {}
  if (typeof input.file_path === 'string' && input.file_path) return input.file_path
  if (typeof input.command === 'string' && input.command) return input.command
  if (typeof input.description === 'string' && input.description) return input.description
  if (typeof input.query === 'string' && input.query) return input.query
  if (typeof input.url === 'string' && input.url) return input.url
  return ''
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  agentSessionTopics,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
}: ToolOverlayProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      setTick((n) => n + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  const selectedId = officeState.selectedAgentId
  const hoveredId = officeState.hoveredAgentId

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        const isSelected = selectedId === id
        const isHovered = hoveredId === id
        const isSub = ch.isSubagent
        const showDetails = isSelected || isHovered

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr

        // Always show name label; show activity details on hover/select
        const displayName = ch.folderName || (isSub ? 'Subtask' : `Agent #${id}`)

        // Parent agent name for subagents
        const parentCh = isSub && ch.parentAgentId != null
          ? officeState.characters.get(ch.parentAgentId)
          : null
        const parentName = parentCh?.folderName || (ch.parentAgentId != null ? `Agent #${ch.parentAgentId}` : null)

        // Get activity info (only needed when showing details)
        let activeTool: ToolActivity | null = null
        let activityText = ''
        let dotColor: string | null = null
        if (showDetails) {
          const subHasPermission = isSub && ch.bubbleType === 'permission'
          if (isSub) {
            if (subHasPermission) {
              activityText = 'Needs approval'
            } else {
              const sub = subagentCharacters.find((s) => s.id === id)
              activityText = sub ? sub.label : 'Subtask'
            }
          } else {
            activeTool = getActiveTool(id, agentTools, ch.isActive)
            if (activeTool) {
              activityText = activeTool.permissionWait ? 'Needs approval' : activeTool.status
            } else {
              activityText = 'Idle'
            }
          }

          const tools = agentTools[id]
          const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done)
          const hasActiveTools = tools?.some((t) => !t.done)
          const isActive = ch.isActive

          if (hasPermission) {
            dotColor = 'var(--pixel-status-permission)'
          } else if (isActive && hasActiveTools) {
            dotColor = 'var(--pixel-status-active)'
          }
        }

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 24,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              pointerEvents: isSelected ? 'auto' : 'none',
              zIndex: isSelected ? 'var(--pixel-overlay-selected-z)' : 'var(--pixel-overlay-z)',
            }}
          >
            {showDetails ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 5,
                  background: 'var(--pixel-bg)',
                  border: isSelected
                    ? '2px solid var(--pixel-border-light)'
                    : '2px solid var(--pixel-border)',
                  borderRadius: 0,
                  padding: isSelected ? '5px 6px 5px 8px' : '5px 8px',
                  boxShadow: 'var(--pixel-shadow)',
                  maxWidth: 300,
                }}
              >
                {dotColor && (
                  <span
                    className={ch.isActive && dotColor !== 'var(--pixel-status-permission)' ? 'pixel-agents-pulse' : undefined}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: dotColor,
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                )}
                <div style={{ overflow: 'hidden', minWidth: 0 }}>
                  {/* Agent name + subagent parent */}
                  <span
                    style={{
                      fontSize: '16px',
                      color: 'var(--pixel-text-dim)',
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {displayName}
                    {isSub && parentName && (
                      <span style={{ opacity: 0.7 }}> ↳ {parentName}</span>
                    )}
                  </span>

                  {/* Tool name + icon */}
                  {activeTool?.toolName ? (
                    <>
                      <span
                        style={{
                          fontSize: '20px',
                          color: 'var(--vscode-foreground)',
                          display: 'block',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {TOOL_ICONS[activeTool.toolName] || '⚡'} {activeTool.toolName}
                        {activeTool.permissionWait && (
                          <span style={{ color: 'var(--pixel-status-permission)', marginLeft: 4 }}>— 승인 대기</span>
                        )}
                      </span>
                      {/* Full detail (path / command / query) */}
                      {(() => {
                        const detail = getToolDetail(activeTool)
                        return detail ? (
                          <span
                            style={{
                              fontSize: '16px',
                              color: 'var(--pixel-text-dim)',
                              display: 'block',
                              marginTop: 2,
                              wordBreak: 'break-all',
                              opacity: 0.85,
                            }}
                          >
                            {detail}
                          </span>
                        ) : null
                      })()}
                    </>
                  ) : (
                    <>
                      <span
                        style={{
                          fontSize: isSub ? '20px' : '22px',
                          fontStyle: isSub ? 'italic' : undefined,
                          color: 'var(--vscode-foreground)',
                          display: 'block',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          marginTop: 2,
                        }}
                      >
                        {activityText}
                      </span>
                      {/* Session topic for idle regular agents */}
                      {!isSub && activityText === 'Idle' && agentSessionTopics[id] && (
                        <span
                          style={{
                            fontSize: '15px',
                            color: 'var(--pixel-text-dim)',
                            display: 'block',
                            marginTop: 3,
                            maxWidth: 260,
                            wordBreak: 'break-word',
                            opacity: 0.75,
                            fontStyle: 'italic',
                            borderTop: '1px solid var(--pixel-border)',
                            paddingTop: 3,
                          }}
                        >
                          💬 {agentSessionTopics[id]}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {isSelected && !isSub && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseAgent(id)
                    }}
                    title="Close agent"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--pixel-close-text)',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '26px',
                      lineHeight: 1,
                      marginLeft: 2,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)'
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)'
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              <div
                style={{
                  background: 'var(--pixel-bg)',
                  border: '1px solid var(--pixel-border)',
                  padding: '1px 6px',
                  boxShadow: 'var(--pixel-shadow)',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    fontSize: '16px',
                    color: 'var(--pixel-text-dim)',
                  }}
                >
                  {displayName}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
