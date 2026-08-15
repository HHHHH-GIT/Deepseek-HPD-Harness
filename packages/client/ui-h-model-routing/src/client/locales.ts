/** `hModelRouting` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'hModelRouting'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '复杂任务计划',
  'task.label': '任务',
  'phase.planning': '正在规划',
  'phase.executing': '正在执行',
  'phase.summarizing': '正在汇总',
  'phase.completed': '已完成',
  'phase.failed': '规划失败',
  'phase.interrupted': '已中断',
  'detail.planning': '正在生成按顺序执行的子任务…',
  'detail.summarizing': '正在汇总执行结果…',
  'progress.completed': '{completed}/{total} 已完成',
  'subtask.pending': '待处理',
  'subtask.inProgress': '进行中',
  'subtask.completed': '已完成',
  'action.expand': '展开复杂任务计划',
  'action.collapse': '收起复杂任务计划',
  'aria.panel': '复杂任务计划',
} satisfies Record<string, string>

/** The H model-routing plan panel's locale key union. */
export type HModelRoutingKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'title': 'Complex Task Plan',
  'task.label': 'Task',
  'phase.planning': 'Planning',
  'phase.executing': 'Executing',
  'phase.summarizing': 'Summarizing',
  'phase.completed': 'Completed',
  'phase.failed': 'Planning failed',
  'phase.interrupted': 'Interrupted',
  'detail.planning': 'Generating sequential subtasks…',
  'detail.summarizing': 'Summarizing execution results…',
  'progress.completed': '{completed}/{total} completed',
  'subtask.pending': 'Pending',
  'subtask.inProgress': 'In progress',
  'subtask.completed': 'Completed',
  'action.expand': 'Expand complex task plan',
  'action.collapse': 'Collapse complex task plan',
  'aria.panel': 'Complex task plan',
} satisfies Record<HModelRoutingKey, string>
