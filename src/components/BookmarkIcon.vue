<script setup>
/**
 * 站点图标。
 * 优先用自定义图标 / favicon，加载失败或没有时退回「首字母 + 渐变底」。
 * 渐变按 url 哈希稳定取色，同一站点每次颜色一致。
 */
import { computed, ref, watch } from 'vue'
import { gradientFor } from '@/data/themeColors'
import { initialOf } from '@/utils/helpers'
import { settings } from '@/composables/useSettings'

const props = defineProps({
  src: { type: String, default: '' },
  name: { type: String, default: '' },
  /** 哈希用的 key，通常传 url */
  hashKey: { type: String, default: '' },
  size: { type: Number, default: 34 },
  /** 圆角半径，默认方形微圆角 */
  radius: { type: Number, default: 8 },
})

const failed = ref(false)

watch(
  () => props.src,
  () => {
    failed.value = false
  },
)

const showImage = computed(() => !!props.src && !failed.value)

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
    <img
      v-if="showImage"
      :src="src"
      :alt="name"
      loading="lazy"
      referrerpolicy="no-referrer"
      @error="failed = true"
    />
    <span v-else>{{ initial }}</span>
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
  user-select: none;
}

.bm-icon img {
  height: 100%;
  object-fit: contain;
  width: 100%;
}
</style>
