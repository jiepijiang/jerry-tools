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
  /** 是否显示拖拽手柄，并让卡片真的可拖 */
  draggable: { type: Boolean, default: false },
  /** 是否显示编辑/删除 */
  editable: { type: Boolean, default: false },
  /** 正在被拖拽的那张（源卡片）—— 父级按 id 判定 */
  dragging: { type: Boolean, default: false },
  /** 当前悬停的落点 —— 父级按 id 判定 */
  dropping: { type: Boolean, default: false },
})

/**
 * ⚠️ `dragstart` / `dragend` / `dragover` / `drop` **必须列进来**。
 *
 * 列进 `defineEmits` 之后，父级写的 `@dragstart` 会被当成**组件事件**，
 * 原生事件不会自己冒泡上去 —— 所以下面必须在根元素上**显式 emit**。
 *
 * 反过来，**不列**进来也不行：那样父级的 `@dragstart` 会变成原生监听器挂在根元素上，
 * 而根元素在 `draggable=false` 时也会收到冒泡上来的 dragstart（比如从别处拖进来），
 * 于是「拖了 A 却记成 B」这种鬼故事就来了。
 */
const emit = defineEmits(['open', 'edit', 'delete', 'dragstart', 'dragend', 'dragover', 'drop'])

const pressed = ref(false)

const iconSrc = computed(() => faviconOf(props.bookmark.url, props.bookmark.icon))

/** 实际生效的排列密度。极简布局会强制压到 compact。 */
const density = computed(() => (props.dense ? 'compact' : settings.density))

/**
 * 悬停提示框。
 *
 * ⚠️ 这里**不能按密度门控**。原来写的是
 *   `settings.showBookmarkTooltip && density.value === 'normal' && !!description`，
 *   但 `.bm-desc` 本身也只在 normal 密度渲染（模板里 `v-if="density === 'normal'"`）
 *   —— 两处一叠加，**compact / icon 密度下简介就彻底看不到了**：
 *   卡片上没有，悬停也不出。实测 18 个「布局 × 密度 × 卡片风格」组合里
 *   只有 4 个（grid / drawer + normal）能出提示框，其余 **14 个简介不可达**
 *   （`/tmp/jerry-sb/tooltip-probe.mjs`）。
 *
 *   那个 `density === 'normal'` 是「补上书签排列设置」那次重构的**副作用**：
 *   原本大概写的是 `!props.compact`（两值），改成 normal/compact/icon 三值枚举后
 *   被直译成 `=== 'normal'`，顺带把新加的 icon 密度也一起关掉了 ——
 *   提交信息里只字未提，是查 `git log -S` 才定位到的。
 *
 *   提示框的职责恰恰是**揭示卡片放不下的东西**，所以卡片显示得越少它越该出现：
 *   compact 只有名称、icon 连名称都没有，这两个密度最需要它。
 *
 * 保留 `!!description`：种子里 24 条书签全都有简介，所以这条实际不影响演示数据。
 * 代价是「icon 密度 + 用户自己新增的、没填简介的书签」仍然悬停无反应
 * （那种情况下连名称都看不到）—— 这是**已知的遗留边界**，
 * `tooltip-probe.mjs` 里有一条断言专门钉住它，改掉时会报红。
 */
const showTooltip = computed(
  () => settings.showBookmarkTooltip && !!props.bookmark.description,
)

/** 提示框元素，用来量它有没有伸出视口（见 `clampTooltip`）。 */
const tipEl = ref(null)

/**
 * 把提示框水平方向夹回视口内。
 *
 * 提示框是 `left: 50%` + `translateX(-50%)` 居中在卡片上的，
 * 而它是 `width: max-content`（最宽 280px）—— 卡片越窄、离视口边缘越近，
 * 左右两头就越容易伸到视口外面被切掉。实测：
 *
 * | 场景 | 首卡提示框 left |
 * | --- | --- |
 * | 1440 宽 + `drawer` + icon 密度 | **-39**（卡片只有 ~66px 宽） |
 * | 375 宽 + `grid` + normal 密度 | **-43** |
 *
 * ⚠️ 第二行说明这**不是新问题** —— 窄视口下 normal 密度早就溢出了，
 * 只是没人量过。放开 icon 密度的提示框之后才变得显眼。
 *
 * 做法：不改 `left`，只给 `transform` 加一个 `--tip-shift` 偏移量
 * （见 `.bm-tooltip`）。要先把当前偏移量减掉，才能拿到「没有偏移时」的位置，
 * 否则每次悬停都会在已有偏移上再叠一次、越推越远。
 *
 * 在 `mouseenter` 里算而不是常驻监听：位置只跟布局有关，
 * 每次悬停重算一次就够，也不用挂 resize / scroll 监听。
 */
function clampTooltip() {
  const el = tipEl.value
  if (!el) return
  const cur = parseFloat(el.style.getPropertyValue('--tip-shift')) || 0
  const r = el.getBoundingClientRect()
  const left = r.left - cur
  const right = r.right - cur
  const pad = 8
  let shift = 0
  if (left < pad) shift = pad - left
  else if (right > window.innerWidth - pad) shift = window.innerWidth - pad - right
  el.style.setProperty('--tip-shift', `${Math.round(shift)}px`)
}

function open() {
  emit('open', props.bookmark)
}

/* ------------------------------------------------------------ 拖拽 */

function onDragStart(e) {
  if (!props.draggable) return
  /*
   * ⚠️ `setData` 不是可选的：**Firefox 里不调它，拖拽根本不会启动**
   *    （表现为「按住拖不动」，Chrome 下却正常 —— 很容易被当成浏览器怪癖）。
   *    值本身用不上（状态走 emit 传），但必须写一个。
   */
  try {
    e.dataTransfer.setData('text/plain', props.bookmark.url || props.bookmark.name || '')
    e.dataTransfer.effectAllowed = 'move'
  } catch {
    /* 某些环境拿不到 dataTransfer，不影响拖拽本身 */
  }
  emit('dragstart', props.bookmark)
}

function onDragEnd() {
  emit('dragend', props.bookmark)
}

/**
 * 落点高亮靠 dragover 持续触发来更新（**不靠 dragleave**）。
 *
 * `dragleave` 在子元素之间穿梭时会疯狂触发，用它清高亮会闪；
 * 而 dragover 是持续触发的，最后一次落在谁身上谁就是当前落点，
 * 天然自洽。清空交给 dragend / drop。
 *
 * `.stop` 是必须的：卡片在分组容器内部，不拦的话事件会继续冒泡到
 * 分组容器的 dragover，把高亮从「某张卡片」改成「整个分组」。
 */
function onDragOver(e) {
  if (!props.draggable) return
  e.preventDefault()
  e.stopPropagation()
  try {
    e.dataTransfer.dropEffect = 'move'
  } catch {
    /* 忽略 */
  }
  emit('dragover', props.bookmark)
}

function onDrop(e) {
  if (!props.draggable) return
  e.preventDefault()
  e.stopPropagation()
  emit('drop', props.bookmark)
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
    :class="[settings.cardStyle, `density-${density}`, { pressed, dragging, dropping }]"
    :draggable="draggable"
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
    @mouseenter="clampTooltip"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @dragover="onDragOver"
    @drop="onDrop"
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
      <div v-if="showTooltip" ref="tipEl" class="bm-tooltip">
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

/* —— 拖拽 —— */

/* 源卡片：半透明 + 虚线边，明确「它正在被搬走」。
   不用 `display:none` —— 那样网格会立刻重排，拖到一半布局跳一下很难受。 */
.bm-card.dragging {
  border-style: dashed;
  opacity: 0.4;
}

.bm-card.dragging:hover {
  transform: none;
}

/* 落点卡片：左边一条竖线，表示「会插到它前面」。
   `outline` 而不是 `border` —— 加 border 会让卡片尺寸变 1px，整行跟着抖。
   `::before` 定位到卡片外侧，不占布局。 */
.bm-card.dropping::before {
  background: var(--accent-text);
  border-radius: 2px;
  bottom: -2px;
  content: '';
  left: -7px;
  position: absolute;
  top: -2px;
  width: 3px;
}

/* 极简布局是紧凑列表，竖线贴太近会看不清，往外挪一点 */
.bm-card.density-compact.dropping::before,
.bm-card.density-icon.dropping::before {
  left: -5px;
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
   一行只有 ~133px（卡片 209px - 内边距 28 - 图标 34 - 间距 12，实测 133.2px），
   只放得下约 9 个汉字 —— 像
   「echarts-legend中如何配置图标和文字的位置」这种标题会被截成
   「echarts-legend…」，完全认不出是哪个站。两行把可用宽度翻倍到 ~266px。
   用 -webkit-line-clamp 而不是自己截字符串：让浏览器按实际宽度断行，
   中英文混排、不同字号都能自适应。
   ⚠️ line-clamp 自带省略号，不能再配 `white-space:nowrap` + `text-overflow:ellipsis`
   （那会强制单行，clamp 失效）。
   ⚠️ **量这个宽度时不能直接读 `clientWidth`**：`.bm-text` 是 `flex: 0 1 auto`
   （只写了 min-width:0），**短名字的卡片会收缩到内容宽** —— 读到的是内容宽，
   不是可用宽。要先把里面的文字换成超长串撑满，量完再换回来。
   （实测 `/tmp/jerry-sb/desc-fit2.mjs`：撑满后非编辑 133.2px、编辑 71.2px。）
   ⚠️ `overflow-wrap: break-word` 是必需的，不是保险：没有它时，
   **一整串没有断行机会的字符**（长英文单词、粘进来的 URL）不会折行，
   只会被 `overflow:hidden` **横向硬切**，而且**连省略号都没有**
   （line-clamp 的省略号只在「行数超出 clamp」时画，横向溢出不算）。
   实测 `'x'.repeat(120)` → 占 1 行、`scrollWidth 855` / `clientWidth 133`、无省略号。
   用 `break-word` 而不是 `anywhere`：后者会改变 min-content 固有尺寸，
   连带影响 `.bm-text` 这个 flex 项的伸缩基准；前者只负责「该断的时候断」。 */
.bm-name {
  color: var(--main_text_color);
  display: -webkit-box;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.35;
  overflow: hidden;
  overflow-wrap: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* 描述允许**两行**（原来是单行 nowrap + ellipsis）。
 *
 * 为什么改：单行时可用宽度只有 **133.2px**，只放得下约 12 个汉字。实测种子里
 * 「在线串口调试与固件升级」已占 126.5px —— 想再加个「· 需 Chrome」
 * （约 163px）就放不下，只能截成「…」。两行把可用宽度翻倍到 ~266px。
 *
 * ⚠️ 别把「可用宽度」和「这张卡当前量到的宽度」搞混：
 *    - 非编辑视图 `.bm-text` 可用 **133.2px**；
 *    - 编辑视图只剩 **71.2px** —— 差的 62px 是 `.bm-actions`（编辑/删除
 *      两个按钮 50px）+ 它多带出来的一个 12px flex gap。
 *      ⚠️ 拖拽手柄 `.bm-grip` 是 `position:absolute`，**一点宽度都不占**，
 *         别把它算进去（我一开始就写错了）。
 *    - 直接读 `clientWidth` 还会更小：`.bm-text` 是 `flex: 0 1 auto`，
 *      短内容会收缩到内容宽。要量可用宽度得先撑满。
 *
 * 写法与 `.bm-name` 完全一致，理由也一样：
 * - 用 `-webkit-line-clamp` 而不是自己截字符串 —— 让浏览器按实际宽度断行，
 *   中英文混排、不同字号都能自适应；
 * - ⚠️ line-clamp 自带省略号，**不能再配 `white-space:nowrap` +
 *   `text-overflow:ellipsis`**（那会强制单行，clamp 直接失效）。
 *
 * 代价（实测，见 `/tmp/jerry-sb/desc-cost.mjs`）：
 * 卡片从 65px 变 81px，而且 `.grid` 是 `align-items: stretch`，
 * **同一行有一张变高，整行都被撑高**。
 * 但这不是新引入的 —— `.bm-name` 允许两行时**本来就**是这个行为
 * （实测长名字让整行 65 → 83px），所以只是沿用既有设计。
 * ⚠️ 量布局影响别用「整页高度」：`body` 有 `min-height:100vh`，
 * 书签少的时候页面高度是**钝的**。要用 `.content` 高度或最后一张卡的底边。
 *
 * ⚠️ `overflow-wrap: break-word` 同样必需，理由见 `.bm-name` 上的注释 ——
 * 没有它时，粘进来的长 URL 会被硬切且没有省略号。
 *
 * ⚠️ 别断言 `getComputedStyle(d).display === '-webkit-box'`：
 * 现代 Chromium 把 `display:-webkit-box` 归一化成了 **`flow-root`**，
 * 而 `-webkit-line-clamp` 作为独立属性照常生效。
 * 要断言就断言 `-webkit-line-clamp` 的值。 */
.bm-desc {
  color: var(--muted_text_color);
  display: -webkit-box;
  font-size: 11.5px;
  line-height: 1.4;
  margin-top: 3px;
  overflow: hidden;
  overflow-wrap: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
   和网址叠在一起。改用 --tip_bg_color（近不透明）+ 自身的模糊兜底。

   ⚠️ `--tip-shift` 是「水平夹回视口」的偏移量，由 `clampTooltip()` 在
   `mouseenter` 时算出并写在元素的行内样式上（默认 0）。
   提示框是 `left:50%` + `translateX(-50%)` 居中在卡片上的，
   而它是 `width:max-content`（最宽 280px）—— 卡片窄到一定程度
   （icon 密度只有 ~66px）或视口窄到 375px 时，两头就会伸出视口被切掉。
   ⚠️ 别改成用 `left` 来做这个偏移：`left` 一变，`clampTooltip()` 里
   用 `getBoundingClientRect()` 反推「没偏移时的位置」就没法算了，
   偏移会在每次悬停时累加、越推越远。 */
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
  transform: translate(calc(-50% + var(--tip-shift, 0px)), 4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
  width: max-content;
  z-index: 40;
}

.bm-card:hover .bm-tooltip {
  opacity: 1;
  transform: translate(calc(-50% + var(--tip-shift, 0px)), 0);
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
