<script setup>
/**
 * 主搜索栏。
 * 左侧是搜索引擎选择，中间输入，右侧按钮；下方是常用书签标签。
 * 输入时实时在本地书签里过滤，回车则用选中的搜索引擎跳转。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { frequentBookmarks, recordVisit, state } from '@/composables/useStore'
import { settings, setSetting } from '@/composables/useSettings'
import { searchEngines } from '@/data/seed'
import { useI18n } from '@/composables/useI18n'
import { iconSrcFor } from '@/utils/helpers'

const props = defineProps({
  /** 当前限定的分类（空 = 全部） */
  categoryId: { type: String, default: '' },
})

const emit = defineEmits(['open'])

const { t } = useI18n()

const keyword = ref('')
const engineOpen = ref(false)
const focused = ref(false)

/* ⚠️ 下拉框要能「点别处就收起」——2026-10-13 补。
 *
 * 之前只有 `pickEngine()` 会把 engineOpen 置 false，也就是**只有选中某一项
 * 才关得掉**：点输入框、点侧栏、点卡片……它都一直挂在那儿。
 * （旁边那个搜索建议下拉 .match-pop 没这问题 —— 它挂在 `focused` 上，
 *  输入框一失焦就收，是浏览器给的 blur 顺带做掉的。engineOpen 没有对应机制。）
 *
 * 判据不是「点按钮会切换」——那是 `@click` 本来就有的——而是
 * 「**凡是点在 .engine 之外的 pointerdown，都要收起**」。
 *
 * 两个实现细节：
 *  1. 用 **pointerdown** 而不是 click：按下就收，和原生 <select> 一致，
 *     不用等一次完整的按下+抬起；也避免「按在别处、松在按钮上」被当成
 *     一次点击。
 *  2. 用**捕获阶段**（第三个参数 true）：这样即便中途有元素
 *     `stopPropagation()`，document 仍然先收到，不会漏收。
 *     `.engine` 自身（含按钮和下拉项）在判据里被排除，所以点按钮仍是
 *     `@click` 的切换、点下拉项仍是 `pickEngine()`。
 */
const engineWrap = ref(null)

function onDocPointerDown(e) {
  if (!engineWrap.value?.contains(e.target)) engineOpen.value = false
}

function onDocKeydown(e) {
  if (e.key === 'Escape') engineOpen.value = false
}

/* 只在打开时挂监听、关掉立刻摘 —— 不常驻一个全局 pointerdown。
   常驻的代价是「页面上每个实例、每次点击都要走一遍处理函数」，
   而这个下拉绝大多数时间是关着的。 */
watch(engineOpen, (open) => {
  if (open) {
    document.addEventListener('pointerdown', onDocPointerDown, true)
    document.addEventListener('keydown', onDocKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocPointerDown, true)
    document.removeEventListener('keydown', onDocKeydown)
  }
})

/* 组件在下拉开着的时候被卸载（切路由等），监听要跟着走，否则留在 document 上。 */
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
})

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
      <div ref="engineWrap" class="engine">
        <button class="engine-btn" @click="engineOpen = !engineOpen">
          <span class="engine-dot" :style="{ background: engine.color }" />
          <span>{{ engine.name }}</span>
          <AppIcon name="ChevronDown" :size="13" />
        </button>
        <Transition name="pop">
          <div v-if="engineOpen" class="engine-pop">
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
        <div v-if="focused && matches.length" class="match-pop">
          <button v-for="b in matches" :key="b.id" class="match-item" @mousedown.prevent="openBookmark(b)">
            <img v-if="iconSrcFor(b)" :src="iconSrcFor(b)" alt="" class="match-icon" />
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
        <img v-if="iconSrcFor(b)" :src="iconSrcFor(b)" alt="" />
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
  /* ⚠️ 这个 z-index 不是装饰，是**必须的** —— 2026-10-13 修。
   *
   * 下面两个下拉（.engine-pop / .match-pop）写的是 z-index: 110 / 120，
   * 但它们**都在 .bar 里面**，而 .bar 是 .glass → 带 backdrop-filter，
   * **backdrop-filter 会创建层叠上下文**。于是那两个 z-index 只在 .bar
   * **内部**有效；在根层叠上下文里 .bar 仍是 z-index:auto（=0），
   * 而 DOM 更靠后的 .bm-card（也带 backdrop-filter，各自成上下文）排在它后面
   * → **卡片直接盖住下拉框**。
   *
   * 实测（scripts/probe-engine-pop.mjs）：下拉第 5 项 `npm` 那个坐标上，
   * `elementsFromPoint()` 最上层是 `bm-name`（书签卡片的标题），不是下拉项
   * —— 最后一项**点不到**。搜索建议下拉（.match-pop）同一个病。
   *
   * 修法：把 z-index 提到 .bar 上，让整个搜索栏（含两个下拉）作为一个
   * 层叠上下文整体压在卡片之上。取 30 —— 高于卡片（auto/0），
   * 低于顶栏（200）、弹窗（8000）、浮层（8500）。
   */
  z-index: 30;
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

/* ⚠️ 刻意**不用** .glass —— 与 BookmarkCard 的 .bm-tooltip 同一条理由：
   下拉框浮在书签卡片上方，而 .glass 的底色是 --item_bg_color
   （实测 rgba(255,255,255,0.62)，只有 62% 不透明），底下的卡片标题、
   分类计数（「24 个网址 · 0 个子分类」）会**透上来和下拉项叠在一起**。
   改用 --tip_bg_color（0.97，近不透明）+ 自身的模糊兜底。 */
.engine-pop {
  backdrop-filter: blur(var(--back_filter));
  -webkit-backdrop-filter: blur(var(--back_filter));
  background-color: var(--tip_bg_color);
  border: 1px solid var(--tip_border_color);
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

/* —— 匹配下拉 ——
   ⚠️ 同样不用 .glass，理由见上面 .engine-pop 的注释。 */
.match-pop {
  backdrop-filter: blur(var(--back_filter));
  -webkit-backdrop-filter: blur(var(--back_filter));
  background-color: var(--tip_bg_color);
  border: 1px solid var(--tip_border_color);
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
