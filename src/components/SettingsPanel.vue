<script setup>
/**
 * 设置面板。
 * 左侧分区导航 + 右侧选项列表，右侧栏固定宽度，整体走弹窗。
 */
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import Modal from '@/components/Modal.vue'
import { accentColors, gradientPresets, iconSchemes } from '@/data/themeColors'
import { cardStyles, densityModes, displayScopes, layoutModes, perRowOptions, themeModes } from '@/data/options'
import { searchEngines } from '@/data/seed'
import { resetSettings, setSetting, settings } from '@/composables/useSettings'
import { useI18n } from '@/composables/useI18n'
import { state, updateShare } from '@/composables/useStore'
import { exportSnapshot, storage } from '@/data/storage'
import { storageKeys } from '@/data/options'
import { copyText, download, formatDate } from '@/utils/helpers'
import { toast } from '@/composables/useToast'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'import'])

const { t } = useI18n()

const SECTIONS = [
  { id: 'appearance', labelKey: 'layout.title', icon: 'LayoutGrid' },
  { id: 'theme', labelKey: 'theme.title', icon: 'Palette' },
  { id: 'content', labelKey: 'scope.title', icon: 'SlidersHorizontal' },
  { id: 'share', labelKey: 'share.title', icon: 'Link' },
  { id: 'data', labelKey: 'settings.data', icon: 'Database' },
]

const section = ref('appearance')
const confirmState = ref({ open: false, title: '', text: '', action: null })
const shareSlug = ref(state.share.slug)
const fileInput = ref(null)

watch(
  () => props.modelValue,
  (v) => {
    if (v) shareSlug.value = state.share.slug
  },
)

/** 一级分类数量超过 10 时禁用网格布局（与参考站一致）。 */
const topLevelCount = computed(() => state.categories.filter((c) => !c.parentId).length)
const gridLocked = computed(() => topLevelCount.value > 10)

async function pick(key, value) {
  if (key === 'layout' && value === 'grid' && gridLocked.value) {
    toast(t('layout.gridLockedHint'), 'warning')
    return
  }
  await setSetting(key, value)
}

function ask(title, text, action) {
  confirmState.value = { open: true, title, text, action }
}

async function runConfirm() {
  const fn = confirmState.value.action
  confirmState.value.open = false
  if (fn) await fn()
}

/* ---------------------------------------------------------------- 数据 */

async function doExport() {
  const payload = {
    categories: state.categories,
    bookmarks: state.bookmarks,
  }
  download(`jerry-tools-bookmarks-${formatDate()}.json`, JSON.stringify(payload, null, 2))
  toast(t('toast.exportOk'))
}

async function doBackup() {
  const snap = await exportSnapshot()
  download(`jerry-tools-backup-${formatDate()}.json`, JSON.stringify(snap, null, 2))
  toast(t('toast.backupOk'))
}

function pickRestore() {
  fileInput.value?.click()
}

async function onRestoreFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    const snap = parsed.data ?? parsed
    ask(t('settings.restore'), t('settings.restoreConfirm'), async () => {
      await storage.writeAll(snap)
      toast(t('toast.restoreOk'))
      setTimeout(() => location.reload(), 500)
    })
  } catch {
    toast(t('toast.restoreFail'), 'error')
  }
}

async function clearCategories() {
  ask(t('settings.clearCategories'), t('settings.clearCategoriesConfirm'), async () => {
    state.categories = []
    await storage.write(storageKeys.categories, [])
    state.bookmarks = state.bookmarks.map((b) => ({ ...b, categoryId: null }))
    await storage.write(storageKeys.bookmarks, state.bookmarks)
    toast(t('toast.clearOk'))
  })
}

async function clearBookmarks() {
  ask(t('settings.clearBookmarks'), t('settings.clearBookmarksConfirm'), async () => {
    state.bookmarks = []
    await storage.write(storageKeys.bookmarks, [])
    toast(t('toast.clearOk'))
  })
}

/* ---------------------------------------------------------------- 分享 */

async function toggleShare(v) {
  await updateShare({ enabled: v })
}

async function saveSlug() {
  const slug = shareSlug.value.trim().replace(/[^\w-]/g, '')
  shareSlug.value = slug
  await updateShare({ slug })
  toast(t('toast.saved'))
}

const shareUrl = computed(() => {
  if (!state.share.slug) return ''
  return `${location.origin}${import.meta.env.BASE_URL}s/${state.share.slug}`
})

async function copyShare() {
  if (!shareUrl.value) return
  const ok = await copyText(shareUrl.value)
  toast(ok ? t('common.linkCopied') : t('toast.fail', undefined) || t('toast.saveFail'), ok ? 'success' : 'error')
}
</script>

<template>
  <Modal :model-value="modelValue" :title="t('settings.title')" size="lg" @update:model-value="emit('update:modelValue', $event)">
    <div class="settings">
      <!-- 左侧分区 -->
      <aside class="sec-nav">
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          class="sec-item"
          :class="{ active: section === s.id }"
          @click="section = s.id"
        >
          <AppIcon :name="s.icon" :size="16" />
          <span>{{ t(s.labelKey) }}</span>
        </button>
      </aside>

      <div class="sec-body">
        <!-- ============ 外观 ============ -->
        <template v-if="section === 'appearance'">
          <div class="group">
            <label class="group-label">{{ t('layout.title') }}</label>
            <div class="opt-row">
              <button
                v-for="m in layoutModes"
                :key="m.id"
                class="opt-card"
                :class="{ active: settings.layout === m.id, disabled: m.id === 'grid' && gridLocked }"
                @click="pick('layout', m.id)"
              >
                <AppIcon :name="m.icon" :size="18" />
                <strong>{{ t(m.nameKey) }}</strong>
                <span>{{ t(m.hintKey) }}</span>
              </button>
            </div>
            <p v-if="gridLocked" class="warn">
              <AppIcon name="AlertCircle" :size="13" />{{ t('layout.gridLockedHint') }}
            </p>
          </div>

          <div class="group">
            <label class="group-label">{{ t('card.title') }}</label>
            <div class="opt-row">
              <button
                v-for="c in cardStyles"
                :key="c.id"
                class="opt-card"
                :class="{ active: settings.cardStyle === c.id }"
                @click="pick('cardStyle', c.id)"
              >
                <AppIcon :name="c.icon" :size="18" />
                <strong>{{ t(c.nameKey) }}</strong>
                <span>{{ t(c.hintKey) }}</span>
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('density.title') }}</label>
            <div class="opt-row">
              <button
                v-for="d in densityModes"
                :key="d.id"
                class="opt-card"
                :class="{ active: settings.density === d.id }"
                @click="pick('density', d.id)"
              >
                <AppIcon :name="d.icon" :size="18" />
                <strong>{{ t(d.nameKey) }}</strong>
                <span>{{ t(d.hintKey) }}</span>
              </button>
            </div>
          </div>
        </template>

        <!-- ============ 主题 ============ -->
        <template v-else-if="section === 'theme'">
          <div class="group">
            <label class="group-label">{{ t('theme.title') }}</label>
            <div class="seg">
              <button
                v-for="m in themeModes"
                :key="m.id"
                class="seg-item"
                :class="{ active: settings.themeMode === m.id }"
                @click="pick('themeMode', m.id)"
              >
                <AppIcon :name="m.icon" :size="15" />{{ t(m.nameKey) }}
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('theme.accent') }}</label>
            <div class="swatches">
              <button
                v-for="c in accentColors"
                :key="c.id"
                class="swatch-lg"
                :class="{ active: settings.accent === c.id }"
                :style="{ background: c.hex }"
                :title="c.name"
                @click="pick('accent', c.id)"
              >
                <AppIcon v-if="settings.accent === c.id" name="Check" :size="14" />
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('theme.iconGradient') }}</label>
            <div class="swatches">
              <button
                v-for="g in gradientPresets"
                :key="g.id"
                class="grad-chip"
                :class="{ active: settings.iconGradient === g.id }"
                :style="{ background: `linear-gradient(135deg, ${g.colors[0][0]}, ${g.colors[1][0]}, ${g.colors[3][0]})` }"
                :title="g.name"
                @click="pick('iconGradient', g.id)"
              />
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('theme.iconScheme') }}</label>
            <div class="swatches">
              <button
                v-for="s in iconSchemes"
                :key="s.id"
                class="scheme-chip"
                :class="{ active: settings.iconScheme === s.id }"
                :style="{ background: `hsl(${s.background})`, borderColor: `hsl(${s.border})` }"
                :title="s.name"
                @click="pick('iconScheme', s.id)"
              />
            </div>
          </div>
        </template>

        <!-- ============ 内容 ============ -->
        <template v-else-if="section === 'content'">
          <div class="group">
            <label class="group-label">{{ t('scope.title') }}</label>
            <div class="opt-row two">
              <button
                v-for="s in displayScopes"
                :key="s.id"
                class="opt-card"
                :class="{ active: settings.displayScope === s.id }"
                @click="pick('displayScope', s.id)"
              >
                <strong>{{ t(s.nameKey) }}</strong>
                <span>{{ t(s.hintKey) }}</span>
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('scope.perRow') }}</label>
            <div class="seg">
              <button
                v-for="n in perRowOptions"
                :key="n"
                class="seg-item"
                :class="{ active: settings.perRow === n }"
                @click="pick('perRow', n)"
              >
                {{ n }} {{ t('scope.perRowUnit') }}
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('search.engine') }}</label>
            <div class="seg wrap">
              <button
                v-for="e in searchEngines"
                :key="e.id"
                class="seg-item"
                :class="{ active: settings.searchEngine === e.id }"
                @click="pick('searchEngine', e.id)"
              >
                {{ e.name }}
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('settings.title') }}</label>
            <div class="toggles">
              <label class="toggle">
                <div>
                  <strong>{{ t('settings.favorites') }}</strong>
                  <span>{{ settings.showFavoritesUnderSearch ? t('settings.favoritesHint') : t('settings.favoritesOff') }}</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.showFavoritesUnderSearch"
                  @change="setSetting('showFavoritesUnderSearch', $event.target.checked)"
                />
              </label>
              <label class="toggle">
                <div>
                  <strong>{{ t('settings.tooltip') }}</strong>
                  <span>{{ settings.showBookmarkTooltip ? t('settings.tooltipHint') : t('settings.tooltipOff') }}</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.showBookmarkTooltip"
                  @change="setSetting('showBookmarkTooltip', $event.target.checked)"
                />
              </label>
              <label class="toggle">
                <div>
                  <strong>{{ t('settings.editMode') }}</strong>
                  <span>{{ settings.editMode ? t('settings.editModeHint') : t('settings.editModeOff') }}</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.editMode"
                  @change="setSetting('editMode', $event.target.checked)"
                />
              </label>
              <label class="toggle">
                <div>
                  <strong>{{ t('settings.weatherAnimation') }}</strong>
                  <span>{{ t('settings.weatherAnimationHint') }}</span>
                </div>
                <input
                  type="checkbox"
                  :checked="settings.weatherAnimation"
                  @change="setSetting('weatherAnimation', $event.target.checked)"
                />
              </label>
            </div>
          </div>
        </template>

        <!-- ============ 分享 ============ -->
        <template v-else-if="section === 'share'">
          <div class="group">
            <label class="toggle">
              <div>
                <strong>{{ t('share.enable') }}</strong>
                <span>{{ t('share.enableHint') }}</span>
              </div>
              <input type="checkbox" :checked="state.share.enabled" @change="toggleShare($event.target.checked)" />
            </label>
          </div>

          <div class="group">
            <label class="group-label">{{ t('share.slug') }}</label>
            <div class="inline">
              <input v-model="shareSlug" class="field" :placeholder="t('share.slugPlaceholder')" @keydown.enter="saveSlug" />
              <button class="btn-primary" @click="saveSlug">{{ t('common.save') }}</button>
            </div>
          </div>

          <div v-if="shareUrl" class="group">
            <label class="group-label">{{ t('share.link') }}</label>
            <div class="inline">
              <input class="field" :value="shareUrl" readonly />
              <button class="btn-ghost" @click="copyShare">
                <AppIcon name="Copy" :size="15" />{{ t('common.copy') }}
              </button>
            </div>
          </div>
        </template>

        <!-- ============ 数据 ============ -->
        <template v-else>
          <div class="group">
            <label class="group-label">{{ t('settings.data') }}</label>
            <div class="btn-grid">
              <button class="btn-ghost" @click="doExport">
                <AppIcon name="FileDown" :size="15" />{{ t('settings.export') }}
              </button>
              <button class="btn-ghost" @click="emit('import')">
                <AppIcon name="FileUp" :size="15" />{{ t('settings.import') }}
              </button>
              <button class="btn-ghost" @click="doBackup">
                <AppIcon name="Database" :size="15" />{{ t('settings.backup') }}
              </button>
              <button class="btn-ghost" @click="pickRestore">
                <AppIcon name="RotateCcw" :size="15" />{{ t('settings.restore') }}
              </button>
            </div>
          </div>

          <div class="group">
            <label class="group-label">{{ t('settings.confirmClear') }}</label>
            <div class="btn-grid">
              <button class="btn-ghost danger" @click="clearCategories">
                <AppIcon name="Trash2" :size="15" />{{ t('settings.clearCategories') }}
              </button>
              <button class="btn-ghost danger" @click="clearBookmarks">
                <AppIcon name="Trash2" :size="15" />{{ t('settings.clearBookmarks') }}
              </button>
            </div>
          </div>

          <div class="group">
            <button class="btn-ghost" @click="resetSettings(); toast(t('toast.saved'))">
              <AppIcon name="RefreshCw" :size="15" />{{ t('common.reset') }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onRestoreFile" />
  </Modal>

  <!-- 二次确认 -->
  <Modal
    :model-value="confirmState.open"
    :title="confirmState.title"
    size="sm"
    @update:model-value="confirmState.open = $event"
  >
    <p class="confirm-text">{{ confirmState.text }}</p>
    <template #footer>
      <button class="btn-ghost" @click="confirmState.open = false">{{ t('common.cancel') }}</button>
      <button class="btn-primary" @click="runConfirm">{{ t('common.confirm') }}</button>
    </template>
  </Modal>
</template>

<style scoped>
.settings {
  display: flex;
  gap: 18px;
  min-height: 380px;
}

.sec-nav {
  border-right: 1px solid var(--border_color);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 3px;
  margin: -20px 0 -20px -20px;
  padding: 16px 10px 16px 14px;
  width: 158px;
}

.sec-item {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  font-size: 13px;
  gap: 9px;
  padding: 9px 11px;
  text-align: left;
  transition: background-color 0.18s ease, color 0.18s ease;
  width: 100%;
}

.sec-item:hover {
  background-color: var(--item_hover_color);
  color: var(--main_text_color);
}

.sec-item.active {
  background-color: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 500;
}

.sec-body {
  flex: 1;
  min-width: 0;
}

.group {
  margin-bottom: 22px;
}

.group:last-child {
  margin-bottom: 0;
}

.group-label {
  color: var(--muted_text_color);
  display: block;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 9px;
}

.opt-row {
  display: grid;
  gap: 9px;
  grid-template-columns: repeat(3, 1fr);
}

.opt-row.two {
  grid-template-columns: repeat(2, 1fr);
}

.opt-card {
  align-items: flex-start;
  background-color: var(--item_bg_color);
  border: 1px solid var(--border_color);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  text-align: left;
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.2s ease;
}

.opt-card:hover {
  background-color: var(--item_hover_color);
}

.opt-card:active {
  transform: scale(0.97);
}

.opt-card.active {
  background-color: var(--accent-soft);
  border-color: var(--accent);
}

.opt-card.active :deep(svg) {
  color: var(--accent-text);
}

.opt-card.disabled {
  opacity: 0.42;
}

.opt-card strong {
  font-size: 13px;
  font-weight: 500;
  margin-top: 2px;
}

.opt-card span {
  color: var(--muted_text_color);
  font-size: 11px;
  line-height: 1.45;
}

.warn {
  align-items: center;
  color: var(--warning);
  display: flex;
  font-size: 11.5px;
  gap: 5px;
  margin-top: 8px;
}

/* —— 分段控件 —— */
.seg {
  background-color: var(--text_bg_color);
  border-radius: var(--radius);
  display: inline-flex;
  gap: 3px;
  padding: 3px;
}

.seg.wrap {
  flex-wrap: wrap;
}

.seg-item {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  font-size: 12.5px;
  gap: 6px;
  padding: 7px 13px;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.seg-item:hover {
  color: var(--main_text_color);
}

.seg-item.active {
  background-color: var(--item_hover_color);
  box-shadow: 0 2px 6px var(--shadow-color);
  color: var(--accent-text);
  font-weight: 500;
}

/* —— 色块 —— */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.swatch-lg {
  align-items: center;
  border: 2px solid transparent;
  border-radius: 9px;
  color: #fff;
  display: flex;
  height: 30px;
  justify-content: center;
  transition: transform 0.18s ease, border-color 0.18s ease;
  width: 30px;
}

.swatch-lg:hover {
  transform: scale(1.1);
}

.swatch-lg.active {
  border-color: var(--main_text_color);
}

.grad-chip {
  border: 2px solid transparent;
  border-radius: 9px;
  height: 30px;
  transition: transform 0.18s ease, border-color 0.18s ease;
  width: 42px;
}

.grad-chip:hover {
  transform: scale(1.06);
}

.grad-chip.active {
  border-color: var(--main_text_color);
}

.scheme-chip {
  border-radius: 7px;
  border-style: solid;
  border-width: 1px;
  height: 26px;
  transition: transform 0.18s ease, outline-color 0.18s ease;
  width: 26px;
  outline: 2px solid transparent;
  outline-offset: 1px;
}

.scheme-chip:hover {
  transform: scale(1.1);
}

.scheme-chip.active {
  outline-color: var(--accent);
}

/* —— 开关 —— */
.toggles {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.toggle {
  align-items: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 9px 10px;
  transition: background-color 0.18s ease;
}

.toggle:hover {
  background-color: var(--item_hover_color);
}

.toggle strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
}

.toggle span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11px;
  margin-top: 2px;
}

.toggle input[type='checkbox'] {
  appearance: none;
  background-color: var(--text_bg_color);
  border-radius: 999px;
  cursor: pointer;
  flex-shrink: 0;
  height: 21px;
  position: relative;
  transition: background-color 0.22s ease;
  width: 38px;
}

.toggle input[type='checkbox']::after {
  background-color: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.28);
  content: '';
  height: 17px;
  left: 2px;
  position: absolute;
  top: 2px;
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  width: 17px;
}

.toggle input[type='checkbox']:checked {
  background-color: var(--accent);
}

.toggle input[type='checkbox']:checked::after {
  transform: translateX(17px);
}

/* —— 其它 —— */
.inline {
  display: flex;
  gap: 8px;
}

.btn-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, 1fr);
}

.btn-ghost.danger:hover {
  background-color: rgba(229, 72, 77, 0.14);
  border-color: var(--danger);
  color: var(--danger);
}

.confirm-text {
  color: var(--muted_text_color);
  font-size: 13.5px;
  line-height: 1.65;
}

@media (max-width: 640px) {
  .settings {
    flex-direction: column;
  }

  .sec-nav {
    border-bottom: 1px solid var(--border_color);
    border-right: none;
    flex-direction: row;
    margin: -20px -20px 0;
    overflow-x: auto;
    padding: 10px 14px;
    width: auto;
  }

  .sec-item {
    flex-shrink: 0;
    width: auto;
  }

  .opt-row {
    grid-template-columns: 1fr;
  }
}
</style>
