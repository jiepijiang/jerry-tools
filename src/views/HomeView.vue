<script setup>
/**
 * 导航主页。
 *
 * 三种布局：
 *   grid    —— 左侧固定侧栏 + 右侧按分类分组的卡片网格（默认）
 *   drawer  —— 分类变成可折叠的手风琴，侧栏收起
 *   minimal —— 只保留分类标题和一行行文字链接，信息密度最高
 *
 * 卡片列数由设置里的 perRow 决定；展示范围 full 时去掉最大宽度限制。
 */
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkCard from '@/components/BookmarkCard.vue'
import BookmarkDialog from '@/components/BookmarkDialog.vue'
import CategoryDialog from '@/components/CategoryDialog.vue'
import CategorySidebar from '@/components/CategorySidebar.vue'
import ImportDialog from '@/components/ImportDialog.vue'
import MainSearchBar from '@/components/MainSearchBar.vue'
import Modal from '@/components/Modal.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import {
  categoryMap,
  createCategory,
  deleteBookmark,
  deleteCategory,
  groupedBookmarks,
  moveBookmark,
  recordVisit,
  reorderBookmarks,
  reorderCategories,
  state,
  updateCategory,
} from '@/composables/useStore'
import { setSetting, settings } from '@/composables/useSettings'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'

const { t } = useI18n()

/* ---------------------------------------------------------------- 状态 */

const activeCategory = ref('')
const collapsedCats = ref([])

const settingsOpen = ref(false)
const importOpen = ref(false)

const bookmarkDialog = ref({ open: false, bookmark: null, categoryId: '' })
const categoryDialog = ref({ open: false, category: null, parentId: null })
const confirmState = ref({ open: false, title: '', text: '', action: null })

/** 正在拖的那张卡片。`name` 用来在空落点上显示「将「X」放入此处」。 */
const dragState = ref({ id: null, categoryId: null, name: '' })

/**
 * 当前悬停的落点。
 * - `kind: 'card'`  → 插到这张卡片**前面**
 * - `kind: 'group'` → 追加到该分组**末尾**
 *
 * 只靠 dragover 持续刷新（不用 dragleave，那个在子元素间穿梭时会闪）。
 */
const dropTarget = ref({ kind: '', id: '', categoryId: '' })

/* ---------------------------------------------------------------- 派生 */

/** 当前筛选下要展示的分组。 */
const groups = computed(() => {
  const all = groupedBookmarks.value
  if (!activeCategory.value) {
    /*
     * 拖拽中把**空分类也放出来**当落点。
     *
     * 平时空分类是藏起来的（不然一屏全是「暂无内容」），但拖拽时它必须可见 ——
     * 否则「把书签挪进一个空分类」这个操作根本没有下手的地方，
     * 得先去侧栏选中那个分类才行，非常反直觉。
     */
    if (dragState.value.id) return all
    return all.filter((g) => g.bookmarks.length || g.subs.length)
  }

  const cat = categoryMap.value[activeCategory.value]
  if (!cat) return all

  // 选中的是子分类 → 只显示它
  if (cat.parentId) {
    const parent = all.find((g) => g.category.id === cat.parentId)
    const sub = parent?.subs.find((s) => s.category.id === cat.id)
    return sub ? [{ category: cat, bookmarks: sub.bookmarks, subs: [] }] : []
  }
  // 选中的是一级分类 → 显示它（含子分类）
  const g = all.find((x) => x.category.id === cat.id)
  return g ? [g] : []
})

const isEmpty = computed(() => !groups.value.length)

/**
 * 子分类个数。
 *
 * 原来这里算的是 `state.categories.length - groups.length`，是错的：
 * `groups` 会随筛选变（选中某个分类时它只剩 1 个），也会把空分类滤掉，
 * 于是这个数字完全不能反映「有几个子分类」—— 选中分类时它直接变成
 * 「全部分类数 - 1」。直接数有 parentId 的分类才对。
 */
const subCategoryCount = computed(() => state.categories.filter((c) => c.parentId).length)

const gridStyle = computed(() => ({
  '--cols': settings.perRow,
}))

/** 实际生效的排列密度（极简布局强制压到 compact），只用来加样式类。 */
const gridDensityClass = computed(
  () => `density-${settings.layout === 'minimal' ? 'compact' : settings.density}`,
)

const wrapperClass = computed(() => [
  `layout-${settings.layout}`,
  settings.displayScope === 'full' ? 'full-width' : 'std-width',
])

/* ---------------------------------------------------------------- 副作用 */

/**
 * 切换分类后把页面滚回顶部。
 *
 * 不重置的话：你滚到页面下方再点另一个分类，新分类的链接是从上往下铺的，
 * 而滚动位置还停在原来的高度 —— 看到的是新分类的中段甚至空白。
 * （实测：滚到 3000px 时切换分类，第一张卡片落在视口 y=-2749，
 *  用户必须手动往上滚才能看到第一条链接。）
 *
 * 用 auto 而不是 smooth：页面可能有一万多像素高，平滑滚动会拖很久，
 * 而且滚动过程中内容还在重排，观感很差。
 */
watch(activeCategory, () => {
  window.scrollTo({ top: 0, behavior: 'auto' })
})

/* ---------------------------------------------------------------- 操作 */

function openBookmark(b) {
  recordVisit(b.id)
  window.open(b.url, '_blank', 'noopener,noreferrer')
}

function addBookmark(categoryId = '') {
  bookmarkDialog.value = { open: true, bookmark: null, categoryId: categoryId || activeCategory.value }
}

function editBookmark(b) {
  bookmarkDialog.value = { open: true, bookmark: b, categoryId: '' }
}

function addCategory(parentId = null) {
  categoryDialog.value = { open: true, category: null, parentId }
}

function editCategory(cat) {
  categoryDialog.value = { open: true, category: cat, parentId: null }
}

function askDeleteBookmark(b) {
  confirmState.value = {
    open: true,
    title: t('common.delete'),
    text: `「${b.name}」`,
    action: async () => {
      const ok = await deleteBookmark(b.id)
      toast(ok ? t('toast.deleted') : t('toast.deleteFail'), ok ? 'success' : 'error')
    },
  }
}

function askDeleteCategory(cat) {
  confirmState.value = {
    open: true,
    title: t('common.delete'),
    text: `「${cat.name}」 — ${t('settings.clearCategoriesConfirm')}`,
    action: async () => {
      const ok = await deleteCategory(cat.id)
      toast(ok ? t('toast.deleted') : t('toast.deleteFail'), ok ? 'success' : 'error')
    },
  }
}

/** 侧栏拖拽：把 from 挪到 to 的位置。 */
async function onSidebarMove({ from, to }) {
  const list = state.categories
    .filter((c) => c.parentId === state.categories.find((x) => x.id === from)?.parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => c.id)
  const fi = list.indexOf(from)
  const ti = list.indexOf(to)
  if (fi < 0 || ti < 0) return
  list.splice(ti, 0, list.splice(fi, 1)[0])
  const ok = await reorderCategories(list)
  toast(ok ? t('toast.sortSaved') : t('toast.rolledBack'), ok ? 'success' : 'error')
}

/**
 * 卡片拖拽：同一分类内换位，跨分类则移动过去。
 *
 * 落点语义统一为「**插到目标卡片前面**」——
 * 因为视觉提示就是目标卡片左边那条竖线，两者必须一致。
 * 想放到某个分类的**末尾**，就往那个分组的空白处放（走 onGroupDrop）。
 */
async function onCardDragStart(b, categoryId) {
  dragState.value = { id: b.id, categoryId, name: b.name }
  dropTarget.value = { kind: '', id: '', categoryId: '' }
}

/** 拖拽结束（含中途按 Esc 取消）—— 清掉所有高亮。 */
function onCardDragEnd() {
  clearDrag()
}

function clearDrag() {
  dragState.value = { id: null, categoryId: null, name: '' }
  dropTarget.value = { kind: '', id: '', categoryId: '' }
}

/** 悬停到某张卡片上 → 高亮它（落点 = 它前面）。 */
function onCardDragOver(b, categoryId) {
  if (!dragState.value.id) return
  dropTarget.value = { kind: 'card', id: b.id, categoryId }
}

/**
 * 悬停到分组的空白处 → 高亮整个分组（落点 = 该分类末尾）。
 *
 * ⚠️ `preventDefault()` 必须放在**所有 early return 之前**，这是最容易写错的一处：
 *    `dragover` 在悬停期间是**持续触发**的。第一次进来把 dropTarget 设成这个分组，
 *    之后每一次都会命中下面那条「已经是它了，不用改」的 early return。
 *    如果 `preventDefault` 写在 return 之后，那么**只有第一次**被 preventDefault，
 *    后面全都不 —— 浏览器据此认为这里不接受放置，`drop` 永远不会派发，
 *    表现为「高亮得好好的，一松手什么也没发生」。
 *
 * ⚠️ 另外还要判断 `e.target` 是不是在卡片里：dragover 会从卡片冒泡上来，
 *    不判的话「悬停在卡片上」会被这里覆盖成「整个分组」，竖线一闪就没了。
 *    卡片那边也做了 `@dragover.stop`，这里是第二道保险。
 */
function onGroupDragOver(e, categoryId) {
  if (!dragState.value.id) return
  e.preventDefault()
  if (e.target?.closest?.('.bm-card')) return
  if (dropTarget.value.kind === 'group' && dropTarget.value.categoryId === categoryId) return
  dropTarget.value = { kind: 'group', id: '', categoryId }
}

async function onCardDrop(target, categoryId) {
  const src = dragState.value
  clearDrag()
  if (!src.id || !target?.id || src.id === target.id) return

  if (src.categoryId === categoryId) {
    const list = state.bookmarks
      .filter((b) => b.categoryId === categoryId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((b) => b.id)
    const fi = list.indexOf(src.id)
    const ti = list.indexOf(target.id)
    if (fi < 0 || ti < 0) return
    // 摘掉源之后，目标左边的元素会左移一位。所以「插到 ti - 1」才是
    // 「插到目标前面」；源本来就在目标前面时（fi === ti - 1）什么都不用做。
    if (fi === ti - 1) return
    list.splice(fi, 1)
    list.splice(ti > fi ? ti - 1 : ti, 0, src.id)
    const ok = await reorderBookmarks(list)
    toast(ok ? t('toast.sortSaved') : t('toast.rolledBack'), ok ? 'success' : 'error')
  } else {
    // 跨分类：插到目标卡片前面。index 是「目标在**不含源**的兄弟列表里」的下标。
    const siblings = state.bookmarks
      .filter((b) => b.categoryId === categoryId && b.id !== src.id)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const at = siblings.findIndex((b) => b.id === target.id)
    const ok = await moveBookmark(src.id, categoryId, at < 0 ? null : at)
    toast(ok ? t('toast.moved') : t('toast.moveFail'), ok ? 'success' : 'error')
  }
}

/** 落在分组空白处 → 挪到该分类末尾（空分类也只能这样落）。 */
async function onGroupDrop(categoryId) {
  const src = dragState.value
  clearDrag()
  if (!src.id || src.categoryId === categoryId) return
  const ok = await moveBookmark(src.id, categoryId, null)
  toast(ok ? t('toast.moved') : t('toast.moveFail'), ok ? 'success' : 'error')
}

function toggleCat(id) {
  const i = collapsedCats.value.indexOf(id)
  if (i >= 0) collapsedCats.value.splice(i, 1)
  else collapsedCats.value.push(id)
}

function isCatCollapsed(id) {
  return collapsedCats.value.includes(id)
}

async function quickToggleEdit() {
  await setSetting('editMode', !settings.editMode)
}
</script>

<template>
  <div class="home" :class="wrapperClass">
    <!-- 侧栏 -->
    <CategorySidebar
      v-if="settings.layout === 'grid'"
      v-model="activeCategory"
      :can-create="settings.editMode"
      @create="addCategory"
      @edit="editCategory"
      @delete="askDeleteCategory"
      @move="onSidebarMove"
    />

    <div class="content">
      <!-- 搜索 -->
      <MainSearchBar :category-id="activeCategory" @open="openBookmark" />

      <!-- 编辑工具条 -->
      <div class="toolbar">
        <div class="tb-left">
          <span v-if="activeCategory" class="filter-chip">
            {{ categoryMap[activeCategory]?.name }}
            <button @click="activeCategory = ''"><AppIcon name="X" :size="12" /></button>
          </span>
          <span class="count-hint">
            {{ t('common.sites', { n: state.bookmarks.length }) }}
            · {{ t('common.subCategories', { n: subCategoryCount }) }}
          </span>
        </div>

        <div class="tb-right">
          <button class="tb-btn" :class="{ on: settings.editMode }" @click="quickToggleEdit">
            <AppIcon name="Pencil" :size="14" />
            {{ t('settings.editMode') }}
          </button>
          <template v-if="settings.editMode">
            <button class="tb-btn" @click="addBookmark()">
              <AppIcon name="Plus" :size="14" />{{ t('bookmark.add') }}
            </button>
            <button class="tb-btn" @click="addCategory(null)">
              <AppIcon name="Folder" :size="14" />{{ t('category.new') }}
            </button>
            <button class="tb-btn" @click="importOpen = true">
              <AppIcon name="FileUp" :size="14" />{{ t('bookmark.import') }}
            </button>
          </template>
          <button class="tb-btn" @click="settingsOpen = true">
            <AppIcon name="SlidersHorizontal" :size="14" />{{ t('settings.title') }}
          </button>
        </div>
      </div>

      <!-- 空态 -->
      <div v-if="isEmpty" class="empty-state glass">
        <AppIcon name="Inbox" :size="34" />
        <strong>{{ t('common.empty') }}</strong>
        <span>{{ t('category.createHint') }}</span>
        <button v-if="settings.editMode" class="btn-primary" @click="addBookmark()">
          <AppIcon name="Plus" :size="15" />{{ t('bookmark.add') }}
        </button>
      </div>

      <!-- 分类分组 -->
      <section
        v-for="group in groups"
        :key="group.category.id"
        class="cat-group"
        :class="{ folded: settings.layout === 'drawer' && isCatCollapsed(group.category.id) }"
      >
        <header class="group-head" @click="settings.layout === 'drawer' && toggleCat(group.category.id)">
          <div class="gh-left">
            <div class="gh-icon">
              <AppIcon :name="group.category.icon || 'Folder'" :size="15" />
            </div>
            <h2>{{ group.category.name }}</h2>
            <span class="gh-count">{{ group.bookmarks.length + group.subs.reduce((n, s) => n + s.bookmarks.length, 0) }}</span>
          </div>
          <div class="gh-right">
            <button
              v-if="settings.editMode"
              class="icon-btn sm"
              :title="t('bookmark.add')"
              @click.stop="addBookmark(group.category.id)"
            >
              <AppIcon name="Plus" :size="15" />
            </button>
            <button
              v-if="settings.layout === 'drawer'"
              class="icon-btn sm"
              @click.stop="toggleCat(group.category.id)"
            >
              <AppIcon :name="isCatCollapsed(group.category.id) ? 'ChevronRight' : 'ChevronDown'" :size="15" />
            </button>
          </div>
        </header>

        <div
          v-show="!(settings.layout === 'drawer' && isCatCollapsed(group.category.id))"
          class="group-body"
          :class="{
            droppable: !!dragState.id,
            'drag-over': dropTarget.kind === 'group' && dropTarget.categoryId === group.category.id,
          }"
          @dragover="onGroupDragOver($event, group.category.id)"
          @drop="onGroupDrop(group.category.id)"
        >
          <!-- 一级分类下的书签 -->
          <div v-if="group.bookmarks.length" class="grid" :class="gridDensityClass" :style="gridStyle">
            <BookmarkCard
              v-for="b in group.bookmarks"
              :key="b.id"
              :bookmark="b"
              :dense="settings.layout === 'minimal'"
              :draggable="settings.editMode"
              :editable="settings.editMode"
              :dragging="dragState.id === b.id"
              :dropping="dropTarget.kind === 'card' && dropTarget.id === b.id"
              @open="openBookmark"
              @edit="editBookmark"
              @delete="askDeleteBookmark"
              @dragstart="onCardDragStart(b, group.category.id)"
              @dragend="onCardDragEnd"
              @dragover="onCardDragOver(b, group.category.id)"
              @drop="onCardDrop(b, group.category.id)"
            />
          </div>

          <!-- 子分类 -->
          <div v-for="sub in group.subs" :key="sub.category.id" class="sub-group">
            <h3 class="sub-head">
              <AppIcon name="ChevronRight" :size="13" />
              {{ sub.category.name }}
              <span class="gh-count">{{ sub.bookmarks.length }}</span>
            </h3>
            <div class="grid" :class="gridDensityClass" :style="gridStyle">
              <BookmarkCard
                v-for="b in sub.bookmarks"
                :key="b.id"
                :bookmark="b"
                :dense="settings.layout === 'minimal'"
                :draggable="settings.editMode"
                :editable="settings.editMode"
                :dragging="dragState.id === b.id"
                :dropping="dropTarget.kind === 'card' && dropTarget.id === b.id"
                @open="openBookmark"
                @edit="editBookmark"
                @delete="askDeleteBookmark"
                @dragstart="onCardDragStart(b, sub.category.id)"
                @dragend="onCardDragEnd"
                @dragover="onCardDragOver(b, sub.category.id)"
                @drop="onCardDrop(b, sub.category.id)"
              />
            </div>
          </div>

          <!--
            空分类的落点。
            ⚠️ 这里**不再自己挂 drop** —— 它在 .group-body 内部，
               事件冒泡上去由 onGroupDrop 统一处理（落点 = 该分类末尾）。
               自己再挂一个的话，两个处理器都会跑，会重复移动一次。
          -->
          <div
            v-if="settings.editMode && !group.bookmarks.length && !group.subs.length"
            class="empty-drop"
          >
            {{ dragState.id ? t('bookmark.dropHere', { name: dragState.name }) : t('common.empty') }}
          </div>
        </div>
      </section>
    </div>

    <!-- 弹窗 -->
    <BookmarkDialog
      v-model="bookmarkDialog.open"
      :bookmark="bookmarkDialog.bookmark"
      :default-category="bookmarkDialog.categoryId"
    />
    <CategoryDialog
      v-model="categoryDialog.open"
      :category="categoryDialog.category"
      :parent-id="categoryDialog.parentId"
    />
    <ImportDialog v-model="importOpen" />
    <SettingsPanel v-model="settingsOpen" @import="importOpen = true; settingsOpen = false" />

    <Modal
      :model-value="confirmState.open"
      :title="confirmState.title"
      size="sm"
      @update:model-value="confirmState.open = $event"
    >
      <p class="confirm-text">{{ confirmState.text }}</p>
      <template #footer>
        <button class="btn-ghost" @click="confirmState.open = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="confirmState.action && confirmState.action(); confirmState.open = false">
          {{ t('common.confirm') }}
        </button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.home {
  /* ⚠️ align-items 默认是 stretch，会把侧栏拉到和右侧内容一样高
     （997 条书签时实测 15985px），侧栏里的 sticky / overflow 全部失效。
     必须显式 flex-start，侧栏才能靠自己的 height + position:sticky 工作。 */
  align-items: flex-start;
  display: flex;
  gap: 18px;
  margin: 0 auto;
  padding: 18px;
  width: 100%;
}

.home.std-width {
  max-width: 1340px;
}

.home.full-width {
  max-width: none;
}

.content {
  flex: 1;
  min-width: 0;
}

/* —— 工具条 —— */
.toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  margin: 16px 0 6px;
}

.tb-left,
.tb-right {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.count-hint {
  color: var(--muted_text_color);
  font-size: 11.5px;
}

.filter-chip {
  align-items: center;
  background-color: var(--accent-soft);
  border-radius: 999px;
  color: var(--accent-text);
  display: inline-flex;
  font-size: 12px;
  gap: 5px;
  padding: 4px 6px 4px 11px;
}

.filter-chip button {
  align-items: center;
  border-radius: 50%;
  color: inherit;
  display: flex;
  height: 17px;
  justify-content: center;
  width: 17px;
}

.filter-chip button:hover {
  background-color: var(--accent-ring);
}

.tb-btn {
  align-items: center;
  background-color: var(--item_bg_color);
  border: 1px solid var(--item_border_color);
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: inline-flex;
  font-size: 12.5px;
  gap: 6px;
  padding: 7px 12px;
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.tb-btn:hover {
  background-color: var(--item_hover_color);
  color: var(--main_text_color);
}

.tb-btn.on {
  background-color: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-text);
}

/* —— 分组 —— */
.cat-group {
  margin-top: 24px;
}

.group-head {
  align-items: center;
  border-radius: var(--radius-sm);
  display: flex;
  justify-content: space-between;
  padding: 4px 2px;
  transition: background-color 0.18s ease;
}

.layout-drawer .group-head {
  cursor: pointer;
}

.layout-drawer .group-head:hover {
  background-color: var(--item_hover_color);
}

.gh-left {
  align-items: center;
  display: flex;
  gap: 9px;
}

.gh-icon {
  align-items: center;
  background-color: var(--accent-soft);
  border-radius: 7px;
  color: var(--accent-text);
  display: flex;
  height: 26px;
  justify-content: center;
  width: 26px;
}

.group-head h2 {
  font-size: 14.5px;
  font-weight: 600;
}

.gh-count {
  color: var(--muted_text_color);
  font-size: 11px;
  font-weight: 400;
}

.gh-right {
  align-items: center;
  display: flex;
  gap: 4px;
}

.icon-btn.sm {
  height: 28px;
  width: 28px;
}

/* —— 网格 —— */
.group-body {
  margin-top: 12px;
}

/* —— 拖拽落点 —— */

/* 拖拽中：所有分组都亮出「可以往这儿放」的虚线框。
   不这样做的话，用户不知道哪些区域是落点，只能靠试。 */
.group-body.droppable {
  border: 1px dashed transparent;
  border-radius: var(--radius);
  outline: 1px dashed var(--border_color);
  outline-offset: 6px;
  padding: 2px;
}

/* 当前悬停的分组：换成实色强调 + 淡底，明确「松手就放这儿」 */
.group-body.drag-over {
  background-color: var(--item_hover_color);
  outline: 2px dashed var(--accent-text);
}

/* 拖拽中给空落点加个底，让它从「一句灰字」变成看得见的框 */
.group-body.droppable .empty-drop {
  border-color: var(--accent-text);
  color: var(--accent-text);
}

.grid {
  display: grid;
  gap: 11px;
  grid-template-columns: repeat(var(--cols, 5), minmax(0, 1fr));
}

/* 只显示图标时，每格一个图标太空，改成按最小宽度自动密排 */
.grid.density-icon {
  grid-template-columns: repeat(auto-fill, minmax(66px, 1fr));
}

.sub-group {
  margin-top: 16px;
}

.sub-head {
  align-items: center;
  color: var(--muted_text_color);
  display: flex;
  font-size: 12.5px;
  font-weight: 500;
  gap: 6px;
  margin-bottom: 9px;
}

.empty-drop {
  border: 1px dashed var(--border_color);
  border-radius: var(--radius);
  color: var(--muted_text_color);
  font-size: 12px;
  padding: 18px;
  text-align: center;
}

/* —— 空态 —— */
.empty-state {
  align-items: center;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 24px;
  padding: 56px 20px;
}

.empty-state :deep(svg) {
  color: var(--muted_text_color);
  opacity: 0.6;
}

.empty-state strong {
  font-size: 14px;
  margin-top: 4px;
}

.empty-state span {
  color: var(--muted_text_color);
  font-size: 12.5px;
  margin-bottom: 8px;
}

.confirm-text {
  color: var(--muted_text_color);
  font-size: 13.5px;
  line-height: 1.65;
}

/* —— 极简布局：单列列表 —— */
.layout-minimal .grid {
  gap: 6px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

/* —— 响应式 —— */
@media (max-width: 1240px) {
  .grid {
    grid-template-columns: repeat(min(var(--cols, 5), 4), minmax(0, 1fr));
  }
}

@media (max-width: 1000px) {
  .grid {
    grid-template-columns: repeat(min(var(--cols, 5), 3), minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .home {
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }

  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .layout-minimal .grid {
    grid-template-columns: 1fr;
  }

  .tb-right .tb-btn span {
    display: none;
  }
}
</style>
