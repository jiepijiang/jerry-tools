<script setup>
/**
 * 主搜索栏。
 * 左侧是搜索引擎选择，中间输入，右侧按钮；下方是常用书签标签。
 * 输入时实时在本地书签里过滤，回车则用选中的搜索引擎跳转。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { frequentBookmarks, recordVisit, state } from '@/composables/useStore'
import { settings, setSetting } from '@/composables/useSettings'
import { searchEngines } from '@/data/seed'
import { useI18n } from '@/composables/useI18n'
import { faviconOf } from '@/utils/helpers'

const props = defineProps({
  /** 当前限定的分类（空 = 全部） */
  categoryId: { type: String, default: '' },
})

const emit = defineEmits(['open'])

const { t } = useI18n()

const keyword = ref('')
const engineOpen = ref(false)
const focused = ref(false)

const engine = computed(
  () => searchEngines.find((e) => e.id === settings.searchEngine) || searchEngines[0],
)

/** 实时匹配本地书签。 */
const matches = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return []
  return state.bookmarks
    .filter((b) => {
      if (props.categoryId && b.categoryId !== props.categoryId) return false
      return (
        b.name.toLowerCase().includes(k) ||
        b.url.toLowerCase().includes(k) ||
        (b.description || '').toLowerCase().includes(k)
      )
    })
    .slice(0, 8)
})

function pickEngine(id) {
  setSetting('searchEngine', id)
  engineOpen.value = false
}

function submit() {
  const k = keyword.value.trim()
  if (!k) return
  if (matches.value.length) {
    openBookmark(matches.value[0])
    return
  }
  window.open(engine.value.url + encodeURIComponent(k), '_blank', 'noopener,noreferrer')
}

function openBookmark(b) {
  recordVisit(b.id)
  window.open(b.url, '_blank', 'noopener,noreferrer')
  keyword.value = ''
  emit('open', b)
}

function blurSoon() {
  setTimeout(() => {
    focused.value = false
  }, 160)
}
</script>

<template>
  <div class="msb">
    <div class="bar glass" :class="{ focused }">
      <!-- 搜索引擎 -->
      <div class="engine">
        <button class="engine-btn" @click="engineOpen = !engineOpen">
          <span class="engine-dot" :style="{ background: engine.color }" />
          <span>{{ engine.name }}</span>
          <AppIcon name="ChevronDown" :size="13" />
        </button>
        <Transition name="pop">
          <div v-if="engineOpen" class="engine-pop glass">
            <button
              v-for="e in searchEngines"
              :key="e.id"
              class="engine-item"
              :class="{ active: settings.searchEngine === e.id }"
              @click="pickEngine(e.id)"
            >
              <span class="engine-dot" :style="{ background: e.color }" />
              <span>{{ e.name }}</span>
              <AppIcon v-if="settings.searchEngine === e.id" name="Check" :size="13" />
            </button>
          </div>
        </Transition>
      </div>

      <input
        v-model="keyword"
        class="msb-input"
        :placeholder="t('search.placeholder')"
        autocomplete="off"
        @focus="focused = true"
        @blur="blurSoon"
        @keydown.enter="submit"
      />

      <button class="msb-go" @click="submit">
        <AppIcon name="Search" :size="17" />
      </button>

      <!-- 本地匹配下拉 -->
      <Transition name="pop">
        <div v-if="focused && matches.length" class="match-pop glass">
          <button v-for="b in matches" :key="b.id" class="match-item" @mousedown.prevent="openBookmark(b)">
            <img v-if="faviconOf(b.url, b.icon)" :src="faviconOf(b.url, b.icon)" alt="" class="match-icon" />
            <div class="match-text">
              <strong>{{ b.name }}</strong>
              <span>{{ b.description || b.url }}</span>
            </div>
            <AppIcon name="ArrowRight" :size="13" />
          </button>
        </div>
      </Transition>
    </div>

    <!-- 常用书签 -->
    <div v-if="settings.showFavoritesUnderSearch && frequentBookmarks.length" class="favs">
      <span class="favs-label">{{ t('settings.favorites') }}</span>
      <button
        v-for="b in frequentBookmarks"
        :key="b.id"
        class="fav-chip"
        @click="openBookmark(b)"
      >
        <img v-if="faviconOf(b.url, b.icon)" :src="faviconOf(b.url, b.icon)" alt="" />
        <span v-else class="fav-dot" />
        {{ b.name }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.msb {
  position: relative;
}

.bar {
  align-items: center;
  border-radius: var(--radius-lg);
  display: flex;
  gap: 4px;
  padding: 6px;
  position: relative;
  transition: box-shadow 0.25s ease, border-color 0.25s ease;
}

.bar.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

/* —— 搜索引擎 —— */
.engine {
  flex-shrink: 0;
  position: relative;
}

.engine-btn {
  align-items: center;
  border-radius: var(--radius);
  color: var(--main_text_color);
  display: flex;
  font-size: 13px;
  gap: 7px;
  padding: 8px 11px;
  transition: background-color 0.18s ease;
  white-space: nowrap;
}

.engine-btn:hover {
  background-color: var(--item_hover_color);
}

.engine-dot {
  border-radius: 50%;
  display: block;
  flex-shrink: 0;
  height: 9px;
  width: 9px;
}

.engine-pop {
  border-radius: var(--radius);
  box-shadow: 0 14px 34px var(--shadow-hover);
  left: 0;
  min-width: 152px;
  padding: 5px;
  position: absolute;
  top: calc(100% + 8px);
  z-index: 120;
}

.engine-item {
  align-items: center;
  border-radius: var(--radius-sm);
  display: flex;
  font-size: 13px;
  gap: 9px;
  padding: 8px 10px;
  text-align: left;
  transition: background-color 0.16s ease;
  width: 100%;
}

.engine-item:hover {
  background-color: var(--item_hover_color);
}

.engine-item.active {
  color: var(--accent-text);
}

.engine-item :deep(svg:last-child) {
  margin-left: auto;
}

/* —— 输入 —— */
.msb-input {
  background: none;
  border: none;
  flex: 1;
  font-size: 14.5px;
  min-width: 0;
  padding: 0 8px;
}

.msb-input::placeholder {
  color: var(--muted_text_color);
}

.msb-go {
  align-items: center;
  background-color: var(--accent);
  border-radius: var(--radius);
  color: var(--on-accent);
  display: flex;
  flex-shrink: 0;
  height: 38px;
  justify-content: center;
  transition: background-color 0.2s ease, transform 0.2s ease;
  width: 42px;
}

.msb-go:hover {
  background-color: var(--accent-strong);
}

.msb-go:active {
  transform: scale(0.94);
}

/* —— 匹配下拉 —— */
.match-pop {
  border-radius: var(--radius);
  box-shadow: 0 16px 40px var(--shadow-hover);
  left: 0;
  max-height: 330px;
  overflow-y: auto;
  padding: 5px;
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 110;
}

.match-item {
  align-items: center;
  border-radius: var(--radius-sm);
  display: flex;
  gap: 11px;
  padding: 8px 10px;
  text-align: left;
  transition: background-color 0.16s ease;
  width: 100%;
}

.match-item:hover {
  background-color: var(--item_hover_color);
}

.match-icon {
  border-radius: 6px;
  flex-shrink: 0;
  height: 26px;
  object-fit: contain;
  width: 26px;
}

.match-text {
  flex: 1;
  min-width: 0;
}

.match-text strong {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-text span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11.5px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-item :deep(svg) {
  color: var(--muted_text_color);
  flex-shrink: 0;
}

/* —— 常用书签 —— */
.favs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.favs-label {
  color: var(--muted_text_color);
  font-size: 11.5px;
  margin-right: 2px;
}

.fav-chip {
  align-items: center;
  backdrop-filter: blur(var(--back_filter));
  background-color: var(--item_bg_color);
  border: 1px solid var(--item_border_color);
  border-radius: 999px;
  display: flex;
  font-size: 12px;
  gap: 6px;
  padding: 5px 11px 5px 6px;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.fav-chip:hover {
  background-color: var(--item_hover_color);
  transform: translateY(-1px);
}

.fav-chip img {
  border-radius: 50%;
  height: 16px;
  object-fit: contain;
  width: 16px;
}

.fav-dot {
  background-color: var(--accent);
  border-radius: 50%;
  height: 16px;
  width: 16px;
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

@media (max-width: 640px) {
  .engine-btn span:not(.engine-dot) {
    display: none;
  }

  .engine-btn {
    padding: 8px;
  }
}
</style>
