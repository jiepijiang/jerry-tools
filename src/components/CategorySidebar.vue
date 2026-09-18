<script setup>
/**
 * 左侧分类侧栏。
 * 网格布局下固定显示；抽屉/极简布局下变成可折叠的手风琴。
 * 编辑模式下支持拖拽排序与右键操作。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { categoryCounts, categoryTree, state } from '@/composables/useStore'
import { settings } from '@/composables/useSettings'
import { useI18n } from '@/composables/useI18n'

const props = defineProps({
  modelValue: { type: String, default: '' },
  /** 是否处于抽屉（手风琴）模式 */
  accordion: { type: Boolean, default: false },
  /** 是否显示「新建分类」 */
  canCreate: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'create', 'edit', 'delete', 'move'])

const { t } = useI18n()

const collapsed = ref(false)
const expanded = ref([])
const dragId = ref(null)

const tree = computed(() => categoryTree.value)

const totalCount = computed(() => state.bookmarks.length)

function select(id) {
  emit('update:modelValue', props.modelValue === id ? '' : id)
}

function toggleExpand(id) {
  const i = expanded.value.indexOf(id)
  if (i >= 0) expanded.value.splice(i, 1)
  else expanded.value.push(id)
}

function isExpanded(id) {
  return expanded.value.includes(id)
}

/* —— 拖拽排序 —— */
function onDragStart(id, e) {
  dragId.value = id
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', id)
}

function onDrop(targetId) {
  if (!dragId.value || dragId.value === targetId) return
  emit('move', { from: dragId.value, to: targetId })
  dragId.value = null
}
</script>

<template>
  <aside class="sidebar glass" :class="{ collapsed }">
    <div class="sb-head">
      <button class="icon-btn" :title="t('common.allCategories')" @click="collapsed = !collapsed">
        <AppIcon :name="collapsed ? 'ChevronsRight' : 'ChevronsLeft'" :size="16" />
      </button>
      <span v-if="!collapsed" class="sb-title">{{ t('common.allCategories') }}</span>
    </div>

    <nav class="sb-list">
      <!-- 全部 -->
      <button
        class="cat-item"
        :class="{ active: !modelValue }"
        :title="t('common.allBookmarks')"
        @click="select('')"
      >
        <AppIcon name="Layers" :size="16" />
        <span v-if="!collapsed" class="cat-name">{{ t('common.allBookmarks') }}</span>
        <span v-if="!collapsed" class="cat-count">{{ totalCount }}</span>
      </button>

      <template v-for="cat in tree" :key="cat.id">
        <div
          class="cat-row"
          :class="{ dragging: dragId === cat.id }"
          :draggable="settings.editMode"
          @dragstart="onDragStart(cat.id, $event)"
          @dragover.prevent
          @drop="onDrop(cat.id)"
        >
          <button
            class="cat-item"
            :class="{ active: modelValue === cat.id }"
            :title="cat.name"
            @click="select(cat.id)"
          >
            <AppIcon :name="cat.icon || 'Folder'" :size="16" />
            <span v-if="!collapsed" class="cat-name">{{ cat.name }}</span>
            <span v-if="!collapsed" class="cat-count">{{ categoryCounts[cat.id] || 0 }}</span>
          </button>

          <button
            v-if="!collapsed && cat.children?.length"
            class="cat-toggle"
            @click.stop="toggleExpand(cat.id)"
          >
            <AppIcon :name="isExpanded(cat.id) ? 'ChevronDown' : 'ChevronRight'" :size="13" />
          </button>

          <div v-if="settings.editMode && !collapsed" class="cat-ops">
            <button class="mini" @click.stop="emit('create', cat.id)"><AppIcon name="Plus" :size="12" /></button>
            <button class="mini" @click.stop="emit('edit', cat)"><AppIcon name="Pencil" :size="12" /></button>
            <button class="mini danger" @click.stop="emit('delete', cat)"><AppIcon name="Trash2" :size="12" /></button>
          </div>
        </div>

        <!-- 子分类 -->
        <template v-if="cat.children?.length && (isExpanded(cat.id) || accordion)">
          <button
            v-for="sub in cat.children"
            :key="sub.id"
            class="cat-item sub"
            :class="{ active: modelValue === sub.id }"
            :title="sub.name"
            @click="select(sub.id)"
          >
            <AppIcon :name="sub.icon || 'Folder'" :size="14" />
            <span v-if="!collapsed" class="cat-name">{{ sub.name }}</span>
            <span v-if="!collapsed" class="cat-count">{{ categoryCounts[sub.id] || 0 }}</span>
          </button>
        </template>
      </template>

      <p v-if="!tree.length && !collapsed" class="empty">
        {{ t('category.empty') }}
        <br />
        <small>{{ t('category.createHint') }}</small>
      </p>
    </nav>

    <button v-if="canCreate && !collapsed" class="sb-add" @click="emit('create', null)">
      <AppIcon name="Plus" :size="15" />
      <span>{{ t('category.new') }}</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 12px 8px;
  transition: width 0.28s ease;
  width: 196px;
}

.sidebar.collapsed {
  width: 50px;
}

.sb-head {
  align-items: center;
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  padding: 0 2px;
}

.sb-title {
  color: var(--muted_text_color);
  font-size: 11.5px;
  font-weight: 500;
}

.sb-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.cat-row {
  position: relative;
}

.cat-row.dragging {
  opacity: 0.45;
}

.cat-item {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  gap: 9px;
  padding: 8px 9px;
  transition: background-color 0.18s ease, color 0.18s ease;
  width: 100%;
}

.cat-item:hover {
  background-color: var(--item_hover_color);
  color: var(--main_text_color);
}

.cat-item.active {
  background-color: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 500;
}

.cat-item.sub {
  font-size: 12.5px;
  padding-left: 20px;
}

.cat-item :deep(svg) {
  flex-shrink: 0;
}

.cat-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-count {
  color: var(--muted_text_color);
  font-size: 10.5px;
  opacity: 0.8;
}

.cat-toggle {
  align-items: center;
  color: var(--muted_text_color);
  display: flex;
  height: 100%;
  justify-content: center;
  position: absolute;
  right: 6px;
  top: 0;
  width: 18px;
}

.cat-toggle:hover {
  color: var(--accent-text);
}

.cat-ops {
  align-items: center;
  background-color: var(--item_hover_color);
  border-radius: var(--radius-sm);
  display: none;
  gap: 1px;
  padding: 2px;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
}

.cat-row:hover .cat-ops {
  display: flex;
}

.cat-row:hover .cat-count {
  visibility: hidden;
}

.mini {
  align-items: center;
  border-radius: 4px;
  color: var(--muted_text_color);
  display: flex;
  height: 20px;
  justify-content: center;
  width: 20px;
}

.mini:hover {
  background-color: var(--accent-soft);
  color: var(--accent-text);
}

.mini.danger:hover {
  background-color: rgba(229, 72, 77, 0.16);
  color: var(--danger);
}

.empty {
  color: var(--muted_text_color);
  font-size: 12px;
  padding: 20px 8px;
  text-align: center;
}

.empty small {
  font-size: 11px;
  opacity: 0.75;
}

.sb-add {
  align-items: center;
  border: 1px dashed var(--border_color);
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  font-size: 12.5px;
  gap: 7px;
  justify-content: center;
  margin-top: 10px;
  padding: 8px;
  transition: border-color 0.2s ease, color 0.2s ease;
  width: 100%;
}

.sb-add:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}

@media (max-width: 760px) {
  .sidebar {
    width: 100%;
  }

  .sidebar.collapsed {
    width: 100%;
  }

  .sb-list {
    flex-direction: row;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .cat-item {
    flex-shrink: 0;
    width: auto;
  }

  .cat-name {
    flex: none;
  }

  .cat-count,
  .cat-toggle,
  .cat-ops {
    display: none !important;
  }
}
</style>
