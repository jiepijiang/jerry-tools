/* =========================================================================
   文案
   -------------------------------------------------------------------------
   用法：const { t } = useI18n()  →  t('search.placeholder')
   带占位符的：t('common.sites', { n: 12 })
   ========================================================================= */

import { computed } from 'vue'
import { messages } from '@/data/i18n'
import { settings } from '@/composables/useSettings'

/** 取一条文案，找不到就退回中文、再退回 key 本身。 */
export function translate(key, params) {
  const lang = messages[settings.language] || messages.zh
  let s = lang[key] ?? messages.zh[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v))
    }
  }
  return s
}

export function useI18n() {
  const t = (key, params) => translate(key, params)
  const lang = computed(() => settings.language)
  return { t, lang }
}
