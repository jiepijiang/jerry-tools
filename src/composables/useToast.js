/* =========================================================================
   轻提示
   -------------------------------------------------------------------------
   toast('已保存') / toast('保存失败', 'error')
   队列化，最多同时显示 3 条，自动消失。
   ========================================================================= */

import { reactive } from 'vue'
import { uid } from '@/utils/helpers'

export const toasts = reactive([])

const DURATION = 2600
const MAX = 3

/**
 * 弹一条提示。
 * @param {string} text 文案
 * @param {'success'|'error'|'info'|'warning'} type 类型
 */
export function toast(text, type = 'success') {
  const item = { id: uid('toast'), text: String(text ?? ''), type }
  toasts.push(item)
  while (toasts.length > MAX) toasts.shift()
  setTimeout(() => {
    const i = toasts.findIndex((x) => x.id === item.id)
    if (i >= 0) toasts.splice(i, 1)
  }, DURATION)
  return item.id
}

/** 关掉一条。 */
export function dismissToast(id) {
  const i = toasts.findIndex((x) => x.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

export function useToast() {
  return { toasts, toast, dismissToast }
}
