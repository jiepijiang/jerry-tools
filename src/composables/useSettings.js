/* =========================================================================
   设置项
   -------------------------------------------------------------------------
   存 localStorage，改动立即生效并落盘。
   data-theme / data-accent 写到 <html> 上，由 root.css 的属性选择器接管配色。
   ========================================================================= */

import { computed, reactive } from 'vue'
import { defaultSettings, storageKeys, themeModes } from '@/data/options'
import { storage } from '@/data/storage'

export const settings = reactive({ ...defaultSettings })

/** 用户选的是 Light / Dark / system 三选一。 */
export const themeMode = computed(() => settings.themeMode)

/** 系统当前是否偏好深色。 */
function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

/** 实际生效的主题（system 时解析成 Light / Dark）。 */
export const resolvedTheme = computed(() =>
  settings.themeMode === 'system' ? (systemPrefersDark() ? 'Dark' : 'Light') : settings.themeMode,
)

/** 把主题写到 <html>。 */
function applyThemeAttr() {
  document.documentElement.dataset.theme = resolvedTheme.value
}

/** 把主题色写到 <html>。 */
function applyAccentAttr() {
  document.documentElement.dataset.accent = settings.accent
}

/** 写盘（只存设置对象）。 */
async function persist() {
  return storage.write(storageKeys.settings, { ...settings })
}

/** 应用启动时调一次。 */
export async function initSettings() {
  const saved = await storage.read(storageKeys.settings)
  if (saved && typeof saved === 'object') {
    for (const [k, v] of Object.entries(saved)) {
      if (k in defaultSettings) settings[k] = v
    }
  }
  applyThemeAttr()
  applyAccentAttr()

  // 跟随系统时，系统切换要实时响应
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  mq?.addEventListener?.('change', () => {
    if (settings.themeMode === 'system') applyThemeAttr()
  })
}

/** 改一个或多个设置项。 */
export async function setSetting(key, value) {
  if (!(key in defaultSettings)) return
  settings[key] = value
  if (key === 'themeMode') applyThemeAttr()
  if (key === 'accent') applyAccentAttr()
  await persist()
}

/** 批量改。 */
export async function setSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k in defaultSettings) settings[k] = v
  }
  applyThemeAttr()
  applyAccentAttr()
  await persist()
}

/** 恢复默认。 */
export async function resetSettings() {
  await setSettings({ ...defaultSettings })
}

/** 主题模式的循环切换（点一下就换下一个）。 */
export async function cycleThemeMode() {
  const order = themeModes.map((m) => m.id)
  const i = order.indexOf(settings.themeMode)
  await setSetting('themeMode', order[(i + 1) % order.length])
}

/** 当前是浅色还是深色（给按钮图标用）。 */
export const isDark = computed(() => resolvedTheme.value === 'Dark')

/* ------------------------------------------------------------ 云端设置 */

/**
 * 应用来自云端的设置（实时同步用）。
 *
 * ⚠️ **绝不能走 setSetting / setSettings** —— 那两个会 `persist()` 落盘，
 *    落盘又触发一次云端写入，云端再推一次变更 → **无限回环**。
 *    这里只改内存 + 刷 `<html>` 属性，一个字节都不往云端写。
 *
 * 返回「是否真的有变化」，供调用方判断要不要算作一次有效同步
 * （没变化就说明是自己写下去的回声，忽略掉）。
 */
export function applyRemoteSettings(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false

  let changed = false
  for (const [k, v] of Object.entries(data)) {
    if (!(k in defaultSettings)) continue
    if (JSON.stringify(settings[k]) === JSON.stringify(v)) continue
    settings[k] = v
    changed = true
  }

  if (changed) {
    applyThemeAttr()
    applyAccentAttr()
  }
  return changed
}

export { applyThemeAttr, applyAccentAttr }
