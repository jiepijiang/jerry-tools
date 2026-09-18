<script setup>
/** 轻提示容器。挂在 App 根节点，全局共用一份队列。 */
import AppIcon from '@/components/AppIcon.vue'
import { dismissToast, toasts } from '@/composables/useToast'

const ICONS = {
  success: 'CheckCircle',
  error: 'XCircle',
  warning: 'AlertCircle',
  info: 'Info',
}
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast glass"
        :class="item.type"
        @click="dismissToast(item.id)"
      >
        <AppIcon :name="ICONS[item.type] || 'Info'" :size="17" />
        <span>{{ item.text }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  bottom: 26px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  left: 50%;
  pointer-events: none;
  position: fixed;
  transform: translateX(-50%);
  z-index: 9000;
}

.toast {
  align-items: center;
  border-radius: var(--radius);
  box-shadow: 0 10px 28px var(--shadow-hover);
  cursor: pointer;
  display: flex;
  font-size: 13.5px;
  gap: 8px;
  max-width: 78vw;
  padding: 10px 16px;
  pointer-events: auto;
  white-space: nowrap;
}

.toast.success {
  color: var(--success);
}

.toast.error {
  color: var(--danger);
}

.toast.warning {
  color: var(--warning);
}

.toast.info {
  color: var(--main_text_color);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}
</style>
