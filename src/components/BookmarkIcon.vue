<script setup>
/**
 * 站点图标。
 * 优先用自定义图标 / favicon，加载失败或没有时退回「首字母 + 渐变底」。
 * 渐变按 url 哈希稳定取色，同一站点每次颜色一致。
 *
 * 结构上字母底是常驻的，图片加载完再盖上去：
 * 这样懒加载期间看到的是设计好的字母块，而不是一块空白。
 */
import { computed, ref, watch } from 'vue'
import { gradientFor } from '@/data/themeColors'
import { fallbackIconFor, initialOf } from '@/utils/helpers'
import { settings } from '@/composables/useSettings'

const props = defineProps({
  src: { type: String, default: '' },
  name: { type: String, default: '' },
  /** 哈希用的 key，通常传 url */
  hashKey: { type: String, default: '' },
  size: { type: Number, default: 34 },
  /** 圆角半径，默认方形微圆角 */
  radius: { type: Number, default: 8 },
  /** 列表很长时（比如发现页 377 条）开懒加载，首页几十个直接立即加载 */
  lazy: { type: Boolean, default: true },
})

/*
 * 把「图到底加载出来没有」报出去。
 *
 * ⚠️ 只有**编辑弹窗**在用（要显示「已获取站点图标 / 没抓到，将显示首字母」）。
 *    卡片列表**不该**监听它 —— 那会让每个图标多一次组件事件，
 *    而列表里没人在意这件事。
 *
 * ⚠️ `error` 在 `src` 为空时**不会**发出（`<img>` 压根没渲染），
 *    所以「没有图」和「图加载失败」在调用方看来是两回事，别混为一谈。
 */
const emit = defineEmits(['load', 'error'])

const failed = ref(false)
const loaded = ref(false)

/** 已经换过一次兜底地址没有。只换一次 —— 兜底自己失败就认命，否则会来回打。 */
const triedFallback = ref(false)

/**
 * `src` 加载失败时的**第二候选**：站点 origin 的 `/favicon.ico`。
 *
 * 规则、以及「什么时候不该再试」全在 `fallbackIconFor` 里 —— 那是纯函数，
 * CI 的零依赖探针可以直接测它（组件状态测不了，纯函数能测）。
 *
 * 兜底地址从 `hashKey` 推导 —— 调用方本来就都传了 url（渐变色哈希用），
 * 所以这里不需要新增 prop，也**不用改任何调用点**。
 */
const fallbackSrc = computed(() => fallbackIconFor(props.src, props.hashKey))

/** 真正交给 `<img>` 的地址：第一次加载失败后换成兜底地址。 */
const displaySrc = computed(() => (triedFallback.value ? fallbackSrc.value : props.src))

watch(
  () => props.src,
  () => {
    failed.value = false
    loaded.value = false
    triedFallback.value = false
  },
)

function onLoad() {
  loaded.value = true
  emit('load')
}

function onError() {
  /*
   * 还有一次机会：换成兜底地址重试。
   *
   * ⚠️ 这一次**不** emit('error') —— 对调用方来说图还没到「失败」那一步。
   *    弹窗靠这个事件显示「没抓到，将显示首字母」，提前报会把
   *    「正在换地址重试」说成「没抓到」。
   */
  if (!triedFallback.value && fallbackSrc.value) {
    triedFallback.value = true
    loaded.value = false
    return
  }
  failed.value = true
  emit('error')
}

const showImage = computed(() => !!displaySrc.value && !failed.value)

const initial = computed(() => initialOf(props.name))

const gradient = computed(() => {
  const g = gradientFor(props.hashKey || props.name || 'x', settings.iconGradient)
  return `linear-gradient(135deg, ${g.from}, ${g.to})`
})

const style = computed(() => ({
  background: gradient.value,
  borderRadius: `${props.radius}px`,
  fontSize: `${Math.round(props.size * 0.44)}px`,
  height: `${props.size}px`,
  width: `${props.size}px`,
}))
</script>

<template>
  <div class="bm-icon" :style="style">
    <span class="bm-initial">{{ initial }}</span>
    <img
      v-if="showImage"
      :class="{ loaded }"
      :src="displaySrc"
      :alt="name"
      :loading="lazy ? 'lazy' : 'eager'"
      referrerpolicy="no-referrer"
      @load="onLoad"
      @error="onError"
    />
  </div>
</template>

<style scoped>
.bm-icon {
  align-items: center;
  color: #fff;
  display: flex;
  flex-shrink: 0;
  font-weight: 600;
  justify-content: center;
  overflow: hidden;
  position: relative;
  user-select: none;
}

/* 真实图标：盖在字母底之上，留 4px 内边距 + 中性底色。
   很多站点的 logo 是透明底的白色图形（比如 Notion），
   压在彩色渐变上会糊成一片，必须给它一个中性的底。
   底色只在图片真正加载完成后才加，否则加载期间会白板一块盖住字母。 */
.bm-icon img {
  border: 1px solid transparent;
  border-radius: inherit;
  box-sizing: border-box;
  height: 100%;
  inset: 0;
  object-fit: contain;
  padding: 4px;
  position: absolute;
  width: 100%;
}

.bm-icon img.loaded {
  background-color: var(--icon_tile_bg);
  border-color: var(--icon_tile_border);
}
</style>
