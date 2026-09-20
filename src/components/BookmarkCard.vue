<script setup>
/**
 * 书签卡片。
 *
 * 卡片风格（决定卡片长什么样）：
 *   default     —— 图标 + 名称 + 简介，横向排布（与参考站一致）
 *   neumorphic  —— 柔和浮雕阴影，浅色下质感更明显
 *   mac         —— 圆角方块，图标居中竖排，密集排布
 *
 * 书签排列（决定卡片里放多少信息，与上面是两套独立设置）：
 *   normal      —— 名称 + 简介
 *   compact     —— 只显示名称
 *   icon        —— 只显示图标
 *
 * 悬停/按下动效沿用 jerry-site 的语言：hover 上浮 2px + 阴影，
 * 按下缩到 0.9。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import { settings } from '@/composables/useSettings'
import { faviconOf } from '@/utils/helpers'

const props = defineProps({
  bookmark: { type: Object, required: true },
  /** 由父级强制压到「紧凑」密度（极简布局用） */
  dense: { type: Boolean, default: false },
  /** 是否显示拖拽手柄 */
  draggable: { type: Boolean, default: false },
  /** 是否显示编辑/删除 */
  editable: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'edit', 'delete', 'dragstart'])

const pressed = ref(false)

const iconSrc = computed(() => props.bookmark.icon || faviconOf(props.bookmark.url))

/** 实际生效的排列密度。极简布局会强制压到 compact。 */
const density = computed(() => (props.dense ? 'compact' : settings.density))

const showTooltip = computed(
  () => settings.showBookmarkTooltip && density.value === 'normal' && !!props.bookmark.description,
)

function open() {
  emit('open', props.bookmark)
}

function onMouseDown() {
  pressed.value = true
}

function onRelease() {
  pressed.value = false
}
</script>

<template>
  <div
    class="bm-card"
    :class="[settings.cardStyle, `density-${density}`, { pressed }]"
    role="link"
    tabindex="0"
    @mousedown="onMouseDown"
    @mouseup="onRelease"
    @mouseleave="onRelease"
    @touchstart.passive="onMouseDown"
    @touchend="onRelease"
    @touchcancel="onRelease"
    @click="open"
    @keydown.enter="open"
    @keydown.space.prevent="open"
  >
    <div v-if="draggable" class="bm-grip" title="拖拽排序" @mousedown.stop @click.stop>
      <AppIcon name="GripVertical" :size="15" />
    </div>

    <BookmarkIcon
      :src="iconSrc"
      :name="bookmark.name"
      :hash-key="bookmark.url"
      :size="density === 'normal' ? 34 : 30"
      :lazy="false"
    />

    <div v-if="density !== 'icon'" class="bm-text">
      <h3 class="bm-name">{{ bookmark.name }}</h3>
      <p v-if="density === 'normal' && bookmark.description" class="bm-desc">{{ bookmark.description }}</p>
    </div>

    <div v-if="editable" class="bm-actions">
      <button class="bm-act" title="编辑" @click.stop="emit('edit', bookmark)">
        <AppIcon name="Pencil" :size="14" />
      </button>
      <button class="bm-act danger" title="删除" @click.stop="emit('delete', bookmark)">
        <AppIcon name="Trash2" :size="14" />
      </button>
    </div>

    <!-- 悬停提示框 -->
    <Transition name="tip">
      <div v-if="showTooltip" class="bm-tooltip">
        <div class="tip-head">
          <strong>{{ bookmark.name }}</strong>
        </div>
        <p class="tip-desc">{{ bookmark.description }}</p>
        <span class="tip-url">{{ bookmark.url }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.bm-card {
  align-items: center;
  backdrop-filter: blur(var(--back_filter));
  -webkit-backdrop-filter: blur(var(--back_filter));
  background-color: var(--item_bg_color);
  border: 1px solid var(--item_border_color);
  border-radius: var(--radius);
  cursor: pointer;
  display: flex;
  gap: 12px;
  min-width: 0;
  padding: 13px 14px;
  position: relative;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.3s ease,
    transform 0.3s ease;
}

.bm-card:hover {
  background-color: var(--item_hover_color);
  box-shadow: 0 8px 16px -4px var(--shadow-color);
  transform: translateY(-2px);
}

.bm-card.pressed {
  transform: scale(0.94);
}

/* —— 柔和阴影：浅色下用双向阴影做浮雕感 —— */
.bm-card.neumorphic {
  background-color: var(--main_bg_color);
  border-color: transparent;
  box-shadow:
    4px 4px 10px var(--shadow-color),
    -4px -4px 10px rgba(255, 255, 255, 0.65);
}

[data-theme='Dark'] .bm-card.neumorphic {
  box-shadow:
    4px 4px 10px rgba(0, 0, 0, 0.5),
    -3px -3px 8px rgba(255, 255, 255, 0.04);
}

.bm-card.neumorphic:hover {
  box-shadow:
    6px 6px 14px var(--shadow-hover),
    -4px -4px 10px rgba(255, 255, 255, 0.7);
}

[data-theme='Dark'] .bm-card.neumorphic:hover {
  box-shadow:
    7px 7px 16px rgba(0, 0, 0, 0.6),
    -4px -4px 10px rgba(255, 255, 255, 0.06);
}

/* —— 圆角方块：图标居中竖排，密集排布 —— */
.bm-card.mac {
  flex-direction: column;
  gap: 7px;
  justify-content: center;
  padding: 14px 8px;
  text-align: center;
}

.bm-card.mac .bm-text {
  width: 100%;
}

.bm-card.mac .bm-name {
  font-size: 12px;
  /* 和上面一样给两行，别退回单行 nowrap */
  line-height: 1.3;
}

/* —— 排列密度：图标 —— */
.bm-card.density-icon {
  justify-content: center;
  padding: 12px;
}

.bm-text {
  min-width: 0;
}

/* 名称允许**两行**。
   一行只有 127px（卡片 209px - 图标 34 - 间距 12 - 内边距 28），
   只放得下约 9 个汉字 / 17 个拉丁字符 —— 像
   「echarts-legend中如何配置图标和文字的位置」这种标题会被截成
   「echarts-legend…」，完全认不出是哪个站。两行把可用宽度翻倍到 ~254px。
   用 -webkit-line-clamp 而不是自己截字符串：让浏览器按实际宽度断行，
   中英文混排、不同字号都能自适应。
   ⚠️ line-clamp 自带省略号，不能再配 `white-space:nowrap` + `text-overflow:ellipsis`
   （那会强制单行，clamp 失效）。 */
.bm-name {
  color: var(--main_text_color);
  display: -webkit-box;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.35;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.bm-desc {
  color: var(--muted_text_color);
  font-size: 11.5px;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 拖拽手柄 —— */
.bm-grip {
  color: var(--muted_text_color);
  cursor: grab;
  display: flex;
  left: -2px;
  opacity: 0;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  transition: opacity 0.2s ease;
}

.bm-card:hover .bm-grip {
  opacity: 0.7;
}

/* —— 编辑按钮 —— */
.bm-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.bm-card:hover .bm-actions,
.bm-card:focus-within .bm-actions {
  opacity: 1;
}

.bm-card.mac .bm-actions {
  position: absolute;
  right: 2px;
  top: 2px;
}

.bm-act {
  align-items: center;
  border-radius: 5px;
  color: var(--muted_text_color);
  display: flex;
  height: 24px;
  justify-content: center;
  transition: background-color 0.16s ease, color 0.16s ease;
  width: 24px;
}

.bm-act:hover {
  background-color: var(--accent-soft);
  color: var(--accent-text);
}

.bm-act.danger:hover {
  background-color: rgba(229, 72, 77, 0.16);
  color: var(--danger);
}

/* —— 悬停提示框 ——
   这里刻意不用 .glass：提示框浮在分类标题上方，半透明底会把底下的字透上来
   和网址叠在一起。改用 --tip_bg_color（近不透明）+ 自身的模糊兜底。 */
.bm-tooltip {
  backdrop-filter: blur(var(--back_filter));
  -webkit-backdrop-filter: blur(var(--back_filter));
  background-color: var(--tip_bg_color);
  border: 1px solid var(--tip_border_color);
  border-radius: var(--radius);
  bottom: calc(100% + 8px);
  box-shadow: 0 12px 30px var(--shadow-hover);
  left: 50%;
  max-width: 280px;
  opacity: 0;
  padding: 10px 12px;
  pointer-events: none;
  position: absolute;
  transform: translate(-50%, 4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  width: max-content;
  z-index: 40;
}

.bm-card:hover .bm-tooltip {
  opacity: 1;
  transform: translate(-50%, 0);
}

.tip-head strong {
  color: var(--main_text_color);
  font-size: 12.5px;
  font-weight: 600;
}

.tip-desc {
  color: var(--muted_text_color);
  font-size: 11.5px;
  line-height: 1.5;
  margin-top: 3px;
}

.tip-url {
  color: var(--accent-text);
  display: block;
  font-size: 11.5px;
  margin-top: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tip-enter-active,
.tip-leave-active {
  transition: opacity 0.16s ease;
}

.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}
</style>
