import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { graphlib, layout } from '@dagrejs/dagre'
import type { HPlanPhase, HPlanProjection, HPlanSubtask, HPlanSubtaskBehavior, HPlanSubtaskRoute, HPlanSubtaskStatus } from '@deepseek-ai/dsh-h-model-routing/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconBranchOutline16,
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconListPenOutline16,
  IconLoadingOutline16,
  IconWarningOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './HPlanPanel.module.css'

/** Navigation action injected by the client plugin for one session-scoped dock. */
export interface HPlanActions {
  readonly openSubtask: (sessionId: NonNullable<HPlanSubtask['sessionId']>) => void
}

/** Full props of the dock entry: input-zone owner share, session kit, navigation, and locale. */
export type HPlanDockProps = PropsRuntime<'conversation.input.dock'> & HPlanActions & PropsLocale<'hModelRouting'>

/** Plain projection-driven panel props; the dock adapter owns the framework read. */
export interface HPlanPanelProps {
  readonly plan: HPlanProjection | null | undefined
  readonly openSubtask: HPlanActions['openSubtask']
  readonly t: HPlanDockProps['t']
}

type ViewMode = 'list' | 'graph'

interface GraphNode {
  id: number
  x: number
  y: number
  status: HPlanSubtaskStatus
  route: HPlanSubtaskRoute | undefined
  behavior: HPlanSubtaskBehavior | undefined
  dependsOn: readonly number[]
  sessionId: HPlanSubtask['sessionId']
}

interface GraphLayout {
  width: number
  height: number
  nodes: readonly GraphNode[]
}

/* v8 ignore next 3 -- closed-union backstop; only reached if a host projection is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable H plan state: ${String(value)}`)
}

function phaseLabel(phase: HPlanPhase, t: HPlanPanelProps['t']): string {
  switch (phase) {
    case 'planning': return t('phase.planning')
    case 'executing': return t('phase.executing')
    case 'summarizing': return t('phase.summarizing')
    case 'completed': return t('phase.completed')
    case 'failed': return t('phase.failed')
    case 'interrupted': return t('phase.interrupted')
    default: return assertNever(phase)
  }
}

function subtaskStatusLabel(status: HPlanSubtaskStatus, t: HPlanPanelProps['t']): string {
  switch (status) {
    case 'pending': return t('subtask.pending')
    case 'in_progress': return t('subtask.inProgress')
    case 'completed': return t('subtask.completed')
    case 'failed': return t('subtask.failed')
    case 'blocked': return t('subtask.blocked')
    default: return assertNever(status)
  }
}

function subtaskRouteLabel(subtask: { readonly route: HPlanSubtaskRoute | undefined; readonly status: HPlanSubtaskStatus }, t: HPlanPanelProps['t']): string {
  if (subtask.route === 'light') return t('route.light')
  if (subtask.route === 'expert') return t('route.expert')
  if (subtask.status === 'blocked') return t('route.notRun')
  return subtask.status === 'completed' || subtask.status === 'failed' ? t('route.unknown') : t('route.pending')
}

function subtaskBehaviorLabel(behavior: HPlanSubtaskBehavior | undefined, t: HPlanPanelProps['t']): string {
  switch (behavior) {
    case 'spec': return t('behavior.spec')
    case 'react': return t('behavior.react')
    case 'weak': return t('behavior.weak')
    case undefined: return t('behavior.notSelected')
    default: return assertNever(behavior)
  }
}

function completedCount(subtasks: readonly HPlanSubtask[]): number {
  return subtasks.filter(subtask => subtask.status === 'completed').length
}

function progressSummary(plan: HPlanProjection, t: HPlanPanelProps['t']): string | null {
  if (plan.subtasks.length === 0) return null
  return t('progress.completed', { completed: completedCount(plan.subtasks), total: plan.subtasks.length })
}

function phaseDetail(phase: HPlanPhase, t: HPlanPanelProps['t']): string | null {
  switch (phase) {
    case 'planning': return t('detail.planning')
    case 'summarizing': return t('detail.summarizing')
    case 'executing':
    case 'completed':
    case 'failed':
    case 'interrupted': return null
    default: return assertNever(phase)
  }
}

function PhaseIcon({ phase }: { readonly phase: HPlanPhase }): ReactNode {
  switch (phase) {
    case 'planning':
    case 'executing':
    case 'summarizing': return <IconLoadingOutline16 className={css.phaseIconLoading} />
    case 'completed': return <IconCheckOutline14 />
    case 'failed':
    case 'interrupted': return <IconWarningOutline16 />
    default: return assertNever(phase)
  }
}

function SubtaskIcon({ status }: { readonly status: HPlanSubtaskStatus }): ReactNode {
  switch (status) {
    case 'pending':
    case 'blocked': return <span className={css.pendingMark} />
    case 'in_progress': return <IconLoadingOutline16 />
    case 'completed': return <IconCheckOutline14 />
    case 'failed': return <IconWarningOutline16 />
    default: return assertNever(status)
  }
}

/** Calculate a left-to-right DAG layout for the bounded plan graph. */
function graphLayout(subtasks: readonly HPlanSubtask[]): GraphLayout {
  const graph = new graphlib.Graph()
  graph.setGraph({ rankdir: 'LR', nodesep: 24, ranksep: 52, marginx: 20, marginy: 20 })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const subtask of subtasks) graph.setNode(String(subtask.id), { width: 32, height: 32 })
  for (const subtask of subtasks) {
    for (const dependency of subtask.dependsOn) graph.setEdge(String(dependency), String(subtask.id))
  }
  layout(graph)
  const bounds = graph.graph() as { width: number; height: number }
  return {
    width: Math.max(160, bounds.width),
    height: Math.max(72, bounds.height),
    nodes: subtasks.map((subtask) => {
      const point = graph.node(String(subtask.id)) as { x: number; y: number }
      return {
        id: subtask.id,
        x: point.x,
        y: point.y,
        status: subtask.status,
        route: subtask.route,
        behavior: subtask.behavior,
        dependsOn: subtask.dependsOn,
        sessionId: subtask.sessionId,
      }
    }),
  }
}

function TaskGraph({ plan, openSubtask, t }: {
  readonly plan: HPlanProjection
  readonly openSubtask: HPlanPanelProps['openSubtask']
  readonly t: HPlanPanelProps['t']
}): ReactNode {
  const layoutResult = useMemo(() => graphLayout(plan.subtasks), [plan.subtasks])
  const nodeById = new Map(layoutResult.nodes.map(node => [node.id, node]))
  const activateNode = (node: GraphNode): void => {
    if (node.sessionId !== undefined) openSubtask(node.sessionId)
  }
  return (
    <div className={css.graphViewport} role="group" aria-label={t('aria.graph')}>
      <div className={css.graphCanvas} style={{ width: layoutResult.width, height: layoutResult.height }}>
        <svg className={css.graph} width={layoutResult.width} height={layoutResult.height} aria-hidden>
          <defs>
            <marker id="h-plan-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" className={css.graphArrow} />
            </marker>
          </defs>
          {plan.subtasks.flatMap(subtask => subtask.dependsOn.map((dependency) => {
            const source = nodeById.get(dependency)
            const target = nodeById.get(subtask.id)
            if (source === undefined || target === undefined) return null
            return <line key={`${dependency}-${subtask.id}`} className={css.graphEdge} x1={source.x + 16} y1={source.y} x2={target.x - 16} y2={target.y} markerEnd="url(#h-plan-arrow)" />
          }))}
        </svg>
        {layoutResult.nodes.map((node) => {
          const route = subtaskRouteLabel(node, t)
          const behavior = subtaskBehaviorLabel(node.behavior, t)
          return (
            <Tooltip key={node.id} label={t('tooltip.model', { model: route, behavior })} side="top" delayMs={200}>
              <button
                type="button"
                className={css.graphNode}
                data-status={node.status}
                data-navigable={node.sessionId === undefined ? undefined : true}
                style={{ left: node.x - 16, top: node.y - 16 }}
                aria-disabled={node.sessionId === undefined}
                aria-label={t('aria.node', { id: node.id, status: subtaskStatusLabel(node.status, t), model: route, behavior, dependencies: node.dependsOn.length === 0 ? t('aria.none') : node.dependsOn.join(', ') })}
                onClick={node.sessionId === undefined ? undefined : () => { activateNode(node) }}
              >
                {node.id}
              </button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

/** H routing plan panel with per-plan list and graph views. */
export function HPlanPanel({ plan, openSubtask, t }: HPlanPanelProps): ReactNode {
  const [collapsedPlanId, setCollapsedPlanId] = useState<HPlanProjection['planId'] | undefined>(undefined)
  const [graphPlanId, setGraphPlanId] = useState<HPlanProjection['planId'] | undefined>(undefined)
  if (plan === undefined || plan === null) return null

  const collapsed = collapsedPlanId === plan.planId
  const mode: ViewMode = graphPlanId === plan.planId ? 'graph' : 'list'
  const detail = phaseDetail(plan.phase, t)
  const summary = progressSummary(plan, t)
  const canShowGraph = plan.subtasks.length > 0

  return (
    <section className={css.root} aria-label={t('aria.panel')}>
      <button
        type="button"
        className={css.header}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('action.expand') : t('action.collapse')}
        onClick={() => { setCollapsedPlanId(id => id === plan.planId ? undefined : plan.planId) }}
      >
        <span className={css.lead} aria-hidden><IconListPenOutline16 size={14} /></span>
        <span className={css.title}>{t('title')}</span>
        <span className={css.phase} data-phase={plan.phase}>
          <span className={css.phaseIcon} aria-hidden><PhaseIcon phase={plan.phase} /></span>
          {phaseLabel(plan.phase, t)}
        </span>
        {summary !== null && <span className={css.summary}>{summary}</span>}
        <span className={css.chevron} aria-hidden>{collapsed ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}</span>
      </button>
      {!collapsed && (
        <div className={css.body}>
          {canShowGraph && (
            <div className={css.viewSwitch} role="group" aria-label={t('aria.viewSwitch')}>
              <button
                type="button"
                className={css.viewButton}
                data-active={mode === 'list'}
                aria-pressed={mode === 'list'}
                aria-label={t('view.list')}
                onClick={() => { setGraphPlanId(undefined) }}
              >
                <IconListPenOutline16 />
              </button>
              <button
                type="button"
                className={css.viewButton}
                data-active={mode === 'graph'}
                aria-pressed={mode === 'graph'}
                aria-label={t('view.graph')}
                onClick={() => { setGraphPlanId(plan.planId) }}
              >
                <IconBranchOutline16 />
              </button>
            </div>
          )}
          {mode === 'list' && <p className={css.task}><span className={css.taskLabel}>{t('task.label')}</span>{plan.task}</p>}
          {detail !== null && <p className={css.detail} role="status">{detail}</p>}
          {mode === 'list' && plan.subtasks.length > 0 && (
            <ol className={css.list}>
              {plan.subtasks.map(subtask => (
                <li key={subtask.id} className={css.subtask} data-status={subtask.status}>
                  <span className={css.subtaskIcon} data-status={subtask.status} aria-hidden><SubtaskIcon status={subtask.status} /></span>
                  <span className={css.subtaskText}>{subtask.title}</span>
                  <span className={css.subtaskMeta}>
                    <span className={css.subtaskRoute} data-route={subtask.route ?? 'pending'}>
                      {subtaskRouteLabel({ route: subtask.route, status: subtask.status }, t)}
                    </span>
                    {subtask.behavior !== undefined && (
                      <span className={css.subtaskBehavior} data-behavior={subtask.behavior}>
                        {subtaskBehaviorLabel(subtask.behavior, t)}
                      </span>
                    )}
                    <span className={css.subtaskStatus}>{subtaskStatusLabel(subtask.status, t)}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {mode === 'graph' && <TaskGraph plan={plan} openSubtask={openSubtask} t={t} />}
          {plan.failure !== undefined && <p className={css.failure} role="alert">{plan.failure}</p>}
        </div>
      )}
    </section>
  )
}

/** Dock adapter: reads the host-computed hModelRouting whole projection. */
export function HPlanDock({ useProjection, openSubtask, t }: HPlanDockProps): ReactNode {
  return <HPlanPanel plan={useProjection('hModelRouting')} openSubtask={openSubtask} t={t} />
}
