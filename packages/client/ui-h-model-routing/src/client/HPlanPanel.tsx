import { useState } from 'react'
import type { HPlanPhase, HPlanProjection, HPlanSubtask, HPlanSubtaskStatus } from '@deepseek-ai/dsh-h-model-routing/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronUpOutline14,
  IconListPenOutline16,
  IconLoadingOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './HPlanPanel.module.css'

/** Full props of the dock entry: input-zone owner share, session kit, and the H routing locale seat. */
export type HPlanDockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<'hModelRouting'>

/** Plain projection-driven panel props; the dock adapter owns the framework read. */
export interface HPlanPanelProps {
  /** The current H routing plan, its clear tombstone, or a capability/loading absence. */
  readonly plan: HPlanProjection | null | undefined
  /** The dock entry's localized text formatter. */
  readonly t: HPlanDockProps['t']
}

/** Local exhaustiveness helper for the closed H plan unions. */
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
    default: return assertNever(status)
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

function PhaseIcon({ phase }: { readonly phase: HPlanPhase }) {
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

function SubtaskIcon({ status }: { readonly status: HPlanSubtaskStatus }) {
  switch (status) {
    case 'pending': return <span className={css.pendingMark} />
    case 'in_progress': return <IconLoadingOutline16 />
    case 'completed': return <IconCheckOutline14 />
    default: return assertNever(status)
  }
}

/**
 * H routing plan panel. A plan id other than `collapsedPlanId` is expanded,
 * so a committed replacement plan is visible immediately; a user collapse
 * survives later progress frames for that exact plan.
 */
export function HPlanPanel({ plan, t }: HPlanPanelProps) {
  const [collapsedPlanId, setCollapsedPlanId] = useState<HPlanProjection['planId'] | undefined>(undefined)

  if (plan === undefined || plan === null) return null

  const collapsed = collapsedPlanId === plan.planId
  const detail = phaseDetail(plan.phase, t)
  const summary = progressSummary(plan, t)

  const toggle = (): void => {
    setCollapsedPlanId(id => id === plan.planId ? undefined : plan.planId)
  }

  return (
    <section className={css.root} aria-label={t('aria.panel')}>
      <button
        type="button"
        className={css.header}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('action.expand') : t('action.collapse')}
        onClick={toggle}
      >
        <span className={css.lead} aria-hidden><IconListPenOutline16 size={14} /></span>
        <span className={css.title}>{t('title')}</span>
        <span className={css.phase} data-phase={plan.phase}>
          <span className={css.phaseIcon} aria-hidden><PhaseIcon phase={plan.phase} /></span>
          {phaseLabel(plan.phase, t)}
        </span>
        {summary !== null && <span className={css.summary}>{summary}</span>}
        <span className={css.chevron} aria-hidden>
          {collapsed ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
        </span>
      </button>
      {!collapsed && (
        <div className={css.body}>
          <p className={css.task}><span className={css.taskLabel}>{t('task.label')}</span>{plan.task}</p>
          {detail !== null && <p className={css.detail} role="status">{detail}</p>}
          {plan.subtasks.length > 0 && (
            <ol className={css.list}>
              {plan.subtasks.map((subtask, index) => (
                <li key={`${index}:${subtask.text}`} className={css.subtask} data-status={subtask.status}>
                  <span className={css.subtaskIcon} data-status={subtask.status} aria-hidden>
                    <SubtaskIcon status={subtask.status} />
                  </span>
                  <span className={css.subtaskText}>{subtask.text}</span>
                  <span className={css.subtaskStatus}>{subtaskStatusLabel(subtask.status, t)}</span>
                </li>
              ))}
            </ol>
          )}
          {plan.failure !== undefined && <p className={css.failure} role="alert">{plan.failure}</p>}
        </div>
      )}
    </section>
  )
}

/** Dock adapter: reads the host-computed hModelRouting whole projection. */
export function HPlanDock({ useProjection, t }: HPlanDockProps) {
  const plan = useProjection('hModelRouting')
  return <HPlanPanel plan={plan} t={t} />
}
