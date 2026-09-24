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

/** `matchMedia` 的 change 监听是否已经挂过（initSettings 可以被调用多次）。 */
let mediaWired = false

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

/**
 * 从**当前生效的适配器**读一次设置并应用。
 *
 * 调用点有三个：应用启动、登录切云端、退出切回本地。
 *
 * ⚠️ 因此它必须是**幂等且可重复调用**的，有两处要注意：
 *
 * 1. **读到之后先把内存清回默认值，再盖上有值的那几个键。**
 *    只做「有则覆盖」是不够的 —— 本机没有 `jt:settings` 时（刚退出登录、
 *    或者从没用过本机模式）那个循环一个键都不碰，内存里就**留着上一个账号的
 *    云端设置**：主题色、编辑模式全带过来，换个人登录会看到别人的界面。
 *    先 `read` 再清空，是为了让「读失败」不至于把现有设置冲掉。
 * 2. **`matchMedia` 的监听只能挂一次** —— 它绑的是模块级的 `settings` 对象，
 *    重复挂等于同一个变更触发 N 次回调，而且永远摘不掉。
 */
export async function initSettings() {
  const saved = await storage.read(storageKeys.settings)

  for (const [k, v] of Object.entries(defaultSettings)) settings[k] = v
  if (saved && typeof saved === 'object') {
    for (const [k, v] of Object.entries(saved)) {
      if (k in defaultSettings) settings[k] = v
    }
  }
  applyThemeAttr()
  applyAccentAttr()

  if (!mediaWired) {
    mediaWired = true
    // 跟随系统时，系统切换要实时响应
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', () => {
      if (settings.themeMode === 'system') applyThemeAttr()
    })
  }
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
