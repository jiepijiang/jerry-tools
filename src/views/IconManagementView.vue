<script setup>
/**
 * 图标管理（独立页 /icon-management）。
 *
 * 参考站把它做成独立路由而不是后台里的一个 tab，这里保持一致。
 * 作用：给发现页的站点换自定义图标（上传本地图片 / 粘贴图片地址），
 * 或恢复成自动获取的 favicon。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import { state, updateSite } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { faviconOf, hostOf, readFileAsDataURL } from '@/utils/helpers'

const router = useRouter()
const { t } = useI18n()

const query = ref('')
const urlFor = ref('')
const urlDraft = ref('')
const fileInput = ref(null)
let pending = null

const list = computed(() => {
  const k = query.value.trim().toLowerCase()
  if (!k) return state.sites
  return state.sites.filter(
    (s) => s.title.toLowerCase().includes(k) || s.url.toLowerCase().includes(k),
  )
})

const customCount = computed(() => state.sites.filter((s) => s.icon).length)

function iconOf(s) {
  return s.icon || faviconOf(s.url)
}

/* ------------------------------------------------------------ 上传本地图片 */

function pickFile(site) {
  pending = site
  fileInput.value?.click()
}

async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  const site = pending
  pending = null
  if (!file || !site) return
  if (!file.type.startsWith('image/')) {
    toast(t('iconMgmt.invalidImage'), 'error')
    return
  }
  let dataUrl = ''
  try {
    dataUrl = await readFileAsDataURL(file)
  } catch {
    dataUrl = ''
  }
  if (!dataUrl) {
    toast(t('iconMgmt.invalidImage'), 'error')
    return
  }
  const ok = await updateSite(site.id, { icon: dataUrl })
  toast(ok ? t('iconMgmt.uploadOk') : t('toast.saveFail'), ok ? 'success' : 'error')
}

/* ------------------------------------------------------------ 粘贴地址 */

function toggleUrl(site) {
  if (urlFor.value === site.id) {
    urlFor.value = ''
    return
  }
  urlFor.value = site.id
  urlDraft.value = site.icon || ''
}

async function applyUrl(site) {
  const v = urlDraft.value.trim()
  const ok = await updateSite(site.id, { icon: v })
  if (ok) {
    urlFor.value = ''
    toast(t('iconMgmt.uploadOk'))
  } else {
    toast(t('toast.saveFail'), 'error')
  }
}

/* ------------------------------------------------------------ 恢复自动 */

async function restore(site) {
  const ok = await updateSite(site.id, { icon: '' })
  toast(ok ? t('iconMgmt.restoreOk') : t('toast.saveFail'), ok ? 'success' : 'error')
}
</script>

<template>
  <div class="icon-page">
    <button class="back" @click="router.push('/discover')">
      <AppIcon name="ArrowLeft" :size="15" />{{ t('iconMgmt.back') }}
    </button>

    <header class="head">
      <div>
        <h1><AppIcon name="Image" :size="19" />{{ t('iconMgmt.title') }}</h1>
        <p class="hint">{{ t('iconMgmt.hint') }}</p>
      </div>
      <div class="stats">
        <span class="chip">{{ t('iconMgmt.count', { n: state.sites.length }) }}</span>
        <span class="chip accent">{{ t('iconMgmt.custom') }} {{ customCount }}</span>
      </div>
    </header>

    <div class="bar">
      <div class="mini-search glass">
        <AppIcon name="Search" :size="15" />
        <input v-model="query" :placeholder="t('admin.iconSearchPlaceholder')" />
      </div>
      <span class="count-hint">{{ t('iconMgmt.matched', { n: list.length }) }}</span>
    </div>

    <div class="grid">
      <div v-for="s in list" :key="s.id" class="icon-card glass">
        <button class="preview" :title="t('iconMgmt.upload')" @click="pickFile(s)">
          <BookmarkIcon :src="iconOf(s)" :name="s.title" :hash-key="s.url" :size="40" :radius="9" />
        </button>

        <div class="ic-text">
          <strong>{{ s.title }}</strong>
          <span>{{ hostOf(s.url) }}</span>
        </div>

        <div class="ic-ops">
          <button class="mini" :title="t('iconMgmt.upload')" @click="pickFile(s)">
            <AppIcon name="Upload" :size="13" />
          </button>
          <button class="mini" :title="t('iconMgmt.urlPlaceholder')" @click="toggleUrl(s)">
            <AppIcon name="Link" :size="13" />
          </button>
          <button
            class="mini"
            :class="{ on: s.icon }"
            :title="t('iconMgmt.auto')"
            :disabled="!s.icon"
            @click="restore(s)"
          >
            <AppIcon name="RotateCcw" :size="13" />
          </button>
        </div>

        <div v-if="urlFor === s.id" class="ic-url">
          <input
            v-model="urlDraft"
            class="field"
            :placeholder="t('iconMgmt.urlPlaceholder')"
            @keydown.enter="applyUrl(s)"
          />
          <button class="btn-primary sm" @click="applyUrl(s)">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <div v-if="!list.length" class="empty glass">
      <AppIcon name="Image" :size="26" />
      <span>{{ t('common.empty') }}</span>
    </div>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
  </div>
</template>

<style scoped>
.icon-page {
  animation: fadeInUp 0.32s ease both;
  margin: 0 auto;
  max-width: 1180px;
  padding: 24px 28px 60px;
}

.back {
  align-items: center;
  color: var(--muted_text_color);
  display: inline-flex;
  font-size: 13px;
  gap: 5px;
  margin-bottom: 16px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  transition: background-color 0.18s ease, color 0.18s ease;
}

.back:hover {
  background-color: var(--item_hover_color);
  color: var(--accent-text);
}

.head {
  align-items: flex-start;
  display: flex;
  gap: 20px;
  justify-content: space-between;
  margin-bottom: 20px;
}

.head h1 {
  align-items: center;
  display: flex;
  font-size: 21px;
  font-weight: 600;
  gap: 8px;
}

.hint {
  color: var(--muted_text_color);
  font-size: 12.5px;
  line-height: 1.6;
  margin-top: 7px;
  max-width: 620px;
}

.stats {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.chip {
  background-color: var(--item_bg_color);
  border: 1px solid var(--border_color);
  border-radius: 999px;
  color: var(--muted_text_color);
  font-size: 12px;
  padding: 5px 12px;
}

.chip.accent {
  background-color: var(--accent-soft);
  border-color: transparent;
  color: var(--accent-text);
}

.bar {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 14px;
}

.mini-search {
  align-items: center;
  border-radius: var(--radius);
  color: var(--muted_text_color);
  display: flex;
  gap: 8px;
  max-width: 340px;
  padding: 8px 12px;
  width: 100%;
}

.mini-search input {
  background: none;
  font-size: 13px;
  width: 100%;
}

.mini-search input::placeholder {
  color: var(--muted_text_color);
}

.count-hint {
  color: var(--muted_text_color);
  flex-shrink: 0;
  font-size: 12px;
}

.grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
}

.icon-card {
  align-items: center;
  border-radius: var(--radius);
  display: flex;
  gap: 11px;
  padding: 11px 12px;
  position: relative;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.icon-card:hover {
  background-color: var(--item_hover_color);
}

.preview {
  border-radius: 9px;
  flex-shrink: 0;
  line-height: 0;
}

.ic-text {
  min-width: 0;
}

.ic-text strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-text span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11.5px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-ops {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.icon-card:hover .ic-ops,
.icon-card:focus-within .ic-ops {
  opacity: 1;
}

.mini {
  align-items: center;
  border-radius: 5px;
  color: var(--muted_text_color);
  display: flex;
  height: 24px;
  justify-content: center;
  transition: background-color 0.16s ease, color 0.16s ease;
  width: 24px;
}

.mini:hover:not(:disabled) {
  background-color: var(--accent-soft);
  color: var(--accent-text);
}

.mini.on {
  color: var(--accent-text);
}

.mini:disabled {
  cursor: default;
  opacity: 0.3;
}

.ic-url {
  bottom: -6px;
  display: flex;
  gap: 6px;
  left: 10px;
  position: absolute;
  right: 10px;
  transform: translateY(100%);
  z-index: 5;
}

.ic-url .field {
  background-color: var(--main_bg_color);
  font-size: 12px;
  padding: 6px 10px;
}

.btn-primary.sm {
  font-size: 12px;
  padding: 6px 12px;
}

.empty {
  align-items: center;
  border-radius: var(--radius);
  color: var(--muted_text_color);
  display: flex;
  flex-direction: column;
  font-size: 13px;
  gap: 10px;
  padding: 48px;
}

@media (max-width: 760px) {
  .icon-page {
    padding: 16px 14px 48px;
  }

  .head {
    flex-direction: column;
    gap: 12px;
  }

  .ic-ops {
    opacity: 1;
  }
}
</style>
