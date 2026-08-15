/** Dictionary namespace owned by the model-routing settings plugin. */

export const en = {
  nav: 'Model Routing',
  intro: 'DSH routes each task automatically: simple tasks go to the Light model, complex tasks are planned on the Expert model with a Light summary.',
  modeLabel: 'Reasoning effort',
  modeAuto: 'Auto — let each model decide',
  modeManual: 'Manual — apply the configured efforts',
  lightLabel: 'Light Model',
  expertLabel: 'Expert Model',
  modelSelect: 'Model',
  effortSelect: 'Reasoning effort',
  effortDefault: 'Model default',
  providerUnavailable: 'No provider serves this model',
  loadError: 'Failed to load the model catalog',
  saveError: 'Save failed',
  saving: 'Saving…',
} as const

export type ModelKey = typeof en

export const zh: { [Key in keyof typeof en]: string } = {
  nav: '模型路由',
  intro: 'DSH 会自动路由任务：简单任务由 Light 模型直接回答，复杂任务由 Expert 模型规划、Light 模型汇总。',
  modeLabel: '思维链强度',
  modeAuto: 'Auto —— 由各模型自行决定',
  modeManual: 'Manual —— 应用已配置的强度',
  lightLabel: 'Light 模型',
  expertLabel: 'Expert 模型',
  modelSelect: '模型',
  effortSelect: '思维链强度',
  effortDefault: '跟随模型默认',
  providerUnavailable: '没有适配器服务此模型',
  loadError: '加载模型目录失败',
  saveError: '保存失败',
  saving: '保存中…',
}
