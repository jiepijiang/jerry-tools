<script setup>
/**
 * 通用弹窗。
 * 用法：<Modal v-model="open" title="标题"> ... </Modal>
 * 点遮罩 / 按 Esc 关闭；打开时锁滚动。
 */
import { onUnmounted, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** sm | md | lg */
  size: { type: String, default: 'md' },
  /** 是否显示右上角关闭按钮 */
  closable: { type: Boolean, default: true },
  /** 点遮罩是否关闭 */
  maskClosable: { type: Boolean, default: true },
})

const emit = defineEmits(['update:modelValue', 'close'])

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape') close()
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  },
)

onUnmounted(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="modal-mask" @click.self="maskClosable && close()">
        <div class="modal glass" :class="size">
          <header v-if="title || closable" class="modal-head">
            <h3 v-if="title">{{ title }}</h3>
            <button v-if="closable" class="icon-btn modal-x" @click="close">
              <AppIcon name="X" :size="18" />
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  align-items: center;
  background-color: var(--overlay_color);
  backdrop-filter: blur(3px);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 24px;
  position: fixed;
  z-index: 8000;
}

.modal {
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 60px var(--shadow-hover);
  display: flex;
  flex-direction: column;
  max-height: 88vh;
  overflow: hidden;
  width: 100%;
}

.modal.sm {
  max-width: 400px;
}

.modal.md {
  max-width: 540px;
}

.modal.lg {
  max-width: 780px;
}

.modal-head {
  align-items: center;
  border-bottom: 1px solid var(--border_color);
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  padding: 16px 20px;
}

.modal-head h3 {
  font-size: 15px;
  font-weight: 600;
}

.modal-x {
  margin-right: -6px;
}

.modal-body {
  overflow-y: auto;
  padding: 20px;
}

.modal-foot {
  border-top: 1px solid var(--border_color);
  display: flex;
  flex-shrink: 0;
  gap: 10px;
  justify-content: flex-end;
  padding: 14px 20px;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.22s ease;
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}
</style>
