<script setup>
/**
 * 天气动效图标。
 * 每种天气一组纯 CSS 动画：太阳旋转光芒、云朵漂移、雨滴下落、雪花飘落、闪电闪烁。
 * 关掉「天气动效」设置后只渲染静态图形。
 */
import { computed } from 'vue'
import { settings } from '@/composables/useSettings'

const props = defineProps({
  group: { type: String, default: 'sun' },
  size: { type: Number, default: 44 },
})

const animate = computed(() => settings.weatherAnimation)
</script>

<template>
  <div
    class="wx"
    :class="[group, { animated: animate }]"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <!-- 晴 -->
      <template v-if="group === 'sun'">
        <g class="rays">
          <line v-for="a in 8" :key="a" x1="24" y1="4" x2="24" y2="10"
            :transform="`rotate(${(a - 1) * 45} 24 24)`" />
        </g>
        <circle class="core" cx="24" cy="24" r="8" />
      </template>

      <!-- 多云转晴 -->
      <template v-else-if="group === 'cloud-sun'">
        <circle class="core small" cx="17" cy="17" r="6" />
        <g class="rays small">
          <line v-for="a in 8" :key="a" x1="17" y1="4" x2="17" y2="8"
            :transform="`rotate(${(a - 1) * 45} 17 17)`" />
        </g>
        <path class="cloud" d="M33 38H17a7 7 0 1 1 6.7-9H25a5 5 0 1 1 8 7.5" />
      </template>

      <!-- 阴 -->
      <template v-else-if="group === 'cloud'">
        <path class="cloud" d="M36 32H14a8 8 0 1 1 7.7-10H24a6 6 0 1 1 12 9" />
        <path class="cloud back" d="M32 38H12a6 6 0 1 1 5.8-8H20a5 5 0 1 1 12 7" />
      </template>

      <!-- 雨 -->
      <template v-else-if="group === 'rain'">
        <path class="cloud" d="M34 24H14a7 7 0 1 1 6.7-9H23a5 5 0 1 1 11 7" />
        <line v-for="(x, i) in [17, 24, 31]" :key="x" class="drop" :style="{ animationDelay: i * 0.28 + 's' }"
          :x1="x" y1="29" :x2="x" y2="37" />
      </template>

      <!-- 雪 -->
      <template v-else-if="group === 'snow'">
        <path class="cloud" d="M34 22H14a7 7 0 1 1 6.7-9H23a5 5 0 1 1 11 7" />
        <g v-for="(x, i) in [17, 24, 31]" :key="x" class="flake"
          :style="{ animationDelay: i * 0.4 + 's' }">
          <line :x1="x - 3" :y1="29" :x2="x + 3" :y2="29" />
          <line :x1="x" :y1="26" :x2="x" :y2="32" />
        </g>
      </template>

      <!-- 雷暴 -->
      <template v-else-if="group === 'storm'">
        <path class="cloud" d="M34 24H14a7 7 0 1 1 6.7-9H23a5 5 0 1 1 11 7" />
        <path class="bolt" d="M26 27l-5 8h5l-2 7 7-9h-5z" />
        <line v-for="(x, i) in [15, 33]" :key="x" class="drop" :style="{ animationDelay: i * 0.3 + 's' }"
          :x1="x" y1="30" :x2="x" y2="36" />
      </template>

      <!-- 雾 -->
      <template v-else-if="group === 'fog'">
        <path class="cloud" d="M34 22H14a7 7 0 1 1 6.7-9H23a5 5 0 1 1 11 7" />
        <line class="fogline" x1="12" y1="30" x2="36" y2="30" />
        <line class="fogline" x1="16" y1="36" x2="32" y2="36" style="animation-delay: 0.6s" />
      </template>

      <!-- 兜底 -->
      <template v-else>
        <path class="cloud" d="M36 32H14a8 8 0 1 1 7.7-10H24a6 6 0 1 1 12 9" />
      </template>
    </svg>
  </div>
</template>

<style scoped>
.wx {
  color: var(--accent-text);
  flex-shrink: 0;
}

.wx svg {
  height: 100%;
  width: 100%;
}

.wx svg * {
  stroke: currentColor;
  stroke-width: 2.4;
}

.wx .core {
  fill: currentColor;
  stroke: none;
}

.wx .bolt {
  fill: currentColor;
  stroke: none;
}

/* —— 动效 —— */
.wx.animated .rays {
  animation: wx-spin 18s linear infinite;
  transform-origin: 24px 24px;
}

.wx.animated .rays.small {
  animation-duration: 12s;
  transform-origin: 17px 17px;
}

.wx.animated .core {
  animation: wx-pulse 3s ease-in-out infinite;
  transform-origin: 24px 24px;
}

.wx.animated .core.small {
  transform-origin: 17px 17px;
}

.wx.animated .cloud {
  animation: wx-drift 5s ease-in-out infinite;
}

.wx.animated .cloud.back {
  animation-delay: 0.8s;
  animation-duration: 6.5s;
  opacity: 0.55;
}

.wx.animated .drop {
  animation: wx-rain 1.1s linear infinite;
}

.wx.animated .flake {
  animation: wx-snow 2.2s ease-in-out infinite;
}

.wx.animated .bolt {
  animation: wx-flash 2.4s ease-in-out infinite;
}

.wx.animated .fogline {
  animation: wx-fog 3s ease-in-out infinite;
}

@keyframes wx-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes wx-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.62;
  }
}

@keyframes wx-drift {
  0%,
  100% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(2.5px);
  }
}

@keyframes wx-rain {
  0% {
    opacity: 0;
    transform: translateY(-3px);
  }
  30% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes wx-snow {
  0% {
    opacity: 0;
    transform: translateY(-3px) rotate(0deg);
  }
  40% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(7px) rotate(120deg);
  }
}

@keyframes wx-flash {
  0%,
  62%,
  100% {
    opacity: 1;
  }
  66%,
  74% {
    opacity: 0.25;
  }
  70% {
    opacity: 1;
  }
}

@keyframes wx-fog {
  0%,
  100% {
    opacity: 0.35;
    transform: translateX(-2px);
  }
  50% {
    opacity: 0.9;
    transform: translateX(2px);
  }
}
</style>
