<script setup>
/**
 * 全局搜索浮层。
 * 同时搜书签和发现页站点，键盘上下选、回车打开；
 * 没有结果时给出「用当前搜索引擎搜索」的兜底项。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import { state } from '@/composables/useStore'
import { settings } from '@/composables/useSettings'
import { searchEngines } from '@/data/seed'
import { useI18n } from '@/composables/useI18n'
import { faviconOf, hostOf } from '@/utils/helpers'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const router = useRouter()
const { t } = useI18n()

const keyword = ref('')
const cursor = ref(0)
const inputEl = ref(null)

const engine = computed(
  () => searchEngines.find((e) => e.id === settings.searchEngine) || searchEngines[0],
)

const results = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  if (!k) return []

  const bms = state.bookmarks
    .filter(
      (b) =>
        b.name.toLowerCase().includes(k) ||
        b.url.toLowerCase().includes(k) ||
        (b.description || '').toLowerCase().includes(k),
    )
    .slice(0, 6)
    .map((b) => ({
      kind: 'bookmark',
      id: b.id,
      name: b.name,
      desc: b.description,
      url: b.url,
      icon: faviconOf(b.url, b.icon),
    }))

  const sites = state.sites
    .filter(
      (s) =>
        s.title?.toLowerCase().includes(k) ||
        s.url?.toLowerCase().includes(k) ||
        (s.description || '').toLowerCase().includes(k),
    )
    .slice(0, 6)
    .map((s) => ({
      kind: 'site',
      id: s.id,
      name: s.title,
      desc: s.description,
      url: s.url,
      icon: faviconOf(s.url, s.icon),
    }))

  const list = [...bms, ...sites]
  list.push({
    kind: 'search',
    id: 'engine',
    name: t('search.openWith', { name: engine.value.name }),
    desc: keyword.value,
    url: engine.value.url + encodeURIComponent(keyword.value),
  })
  return list
})

watch(keyword, () => {
  cursor.value = 0
})

watch(
  () => props.modelValue,
  async (v) => {
    if (v) {
      keyword.value = ''
      cursor.value = 0
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function open(item) {
  if (item.kind === 'search') {
    window.open(item.url, '_blank', 'noopener,noreferrer')
  } else {
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }
  close()
}

function onKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    cursor.value = Math.min(cursor.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    cursor.value = Math.max(cursor.value - 1, 0)
  } else if (e.key === 'Enter') {
    const item = results.value[cursor.value]
    if (item) open(item)
  } else if (e.key === 'Escape') {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="so-mask" @click.self="close">
        <div class="so glass" @keydown="onKey">
          <div class="so-input">
            <AppIcon name="Search" :size="18" />
            <input
              ref="inputEl"
              v-model="keyword"
              :placeholder="t('search.placeholder')"
              autocomplete="off"
            />
            <kbd>ESC</kbd>
          </div>

          <div v-if="results.length" class="so-list">
            <button
              v-for="(item, i) in results"
              :key="item.kind + item.id"
              class="so-item"
              :class="{ active: i === cursor }"
              @mouseenter="cursor = i"
              @click="open(item)"
            >
              <BookmarkIcon
                v-if="item.kind !== 'search'"
                :src="item.icon"
                :name="item.name"
                :hash-key="item.url"
                :size="26"
                :radius="6"
              />
              <div v-else class="so-engine">
                <AppIcon name="Globe" :size="18" />
              </div>
              <div class="so-text">
                <strong>{{ item.name }}</strong>
                <span>{{ item.desc || hostOf(item.url) }}</span>
              </div>
              <AppIcon name="ExternalLink" :size="14" class="so-go" />
            </button>
          </div>

          <p v-else-if="keyword.trim()" class="so-empty">{{ t('search.noResult') }}</p>
          <p v-else class="so-hint">{{ t('search.placeholder') }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.so-mask {
  align-items: flex-start;
  background-color: var(--overlay_color);
  backdrop-filter: blur(3px);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 12vh 24px 24px;
  position: fixed;
  z-index: 8500;
}

.so {
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px var(--shadow-hover);
  max-height: 62vh;
  overflow: hidden;
  width: 100%;
  max-width: 580px;
}

.so-input {
  align-items: center;
  border-bottom: 1px solid var(--border_color);
  display: flex;
  gap: 11px;
  padding: 15px 18px;
}

.so-input :deep(svg) {
  color: var(--muted_text_color);
  flex-shrink: 0;
}

.so-input input {
  background: none;
  border: none;
  flex: 1;
  font-size: 15px;
  min-width: 0;
}

.so-input kbd {
  background-color: var(--text_bg_color);
  border-radius: 5px;
  color: var(--muted_text_color);
  font-size: 10.5px;
  padding: 3px 6px;
}

.so-list {
  max-height: 46vh;
  overflow-y: auto;
  padding: 6px;
}

.so-item {
  align-items: center;
  border-radius: var(--radius-sm);
  display: flex;
  gap: 11px;
  padding: 9px 11px;
  text-align: left;
  transition: background-color 0.14s ease;
  width: 100%;
}

.so-item.active {
  background-color: var(--accent-soft);
}

.so-engine {
  align-items: center;
  background-color: var(--text_bg_color);
  border-radius: 6px;
  color: var(--accent-text);
  display: flex;
  flex-shrink: 0;
  height: 26px;
  justify-content: center;
  width: 26px;
}

.so-text {
  flex: 1;
  min-width: 0;
}

.so-text strong {
  display: block;
  font-size: 13.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.so-text span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11.5px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.so-go {
  color: var(--muted_text_color);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.so-item.active .so-go {
  opacity: 1;
}

.so-empty,
.so-hint {
  color: var(--muted_text_color);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .so,
.modal-leave-active .so {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .so,
.modal-leave-to .so {
  opacity: 0;
  transform: translateY(-12px) scale(0.97);
}
</style>
