<script setup>
/** 分类新增 / 编辑弹窗。带图标选择器（从内置图标集里挑）。 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import Modal from '@/components/Modal.vue'
import { createCategory, flatCategories, updateCategory } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 传 null 表示新增 */
  category: { type: Object, default: null },
  /** 新增时的父分类 */
  parentId: { type: String, default: null },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const ICON_CHOICES = [
  'Code2', 'Palette', 'Sparkles', 'Film', 'GraduationCap', 'Zap',
  'Folder', 'Star', 'Bookmark', 'Heart', 'Globe', 'Cpu',
  'Newspaper', 'Music', 'Video', 'Cloud', 'ShoppingBag', 'Wrench',
  'Briefcase', 'BookOpen', 'Database', 'MessageSquare', 'BarChart3', 'Compass',
]

const form = ref({ name: '', icon: 'Folder', parentId: null })
const error = ref('')
const saving = ref(false)
const nameEl = ref(null)

const isEdit = computed(() => !!props.category)
const title = computed(() => (isEdit.value ? t('category.edit') : t('category.new')))

/** 编辑时不能把自己或自己的子孙选成父级。 */
const parentOptions = computed(() => {
  const all = flatCategories.value
  if (!isEdit.value) return all
  const banned = new Set([props.category.id])
  const collect = (id) => {
    all.filter((c) => c.parentId === id).forEach((c) => {
      banned.add(c.id)
      collect(c.id)
    })
  }
  collect(props.category.id)
  return all.filter((c) => !banned.has(c.id))
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.category) {
      form.value = {
        name: props.category.name,
        icon: props.category.icon || 'Folder',
        parentId: props.category.parentId ?? null,
      }
    } else {
      form.value = { name: '', icon: 'Folder', parentId: props.parentId ?? null }
    }
    error.value = ''
    nextTick(() => nameEl.value?.focus())
  },
)

async function save() {
  if (!form.value.name.trim()) {
    error.value = t('bookmark.needFields')
    await nextTick()
    const el = nameEl.value
    if (el) {
      el.style.animation = 'none'
      void el.offsetHeight
      el.style.animation = 'shake 0.5s ease-in-out'
    }
    return
  }
  saving.value = true
  try {
    const ok = isEdit.value
      ? await updateCategory(props.category.id, {
          name: form.value.name.trim(),
          icon: form.value.icon,
          parentId: form.value.parentId || null,
        })
      : await createCategory({
          name: form.value.name.trim(),
          icon: form.value.icon,
          parentId: form.value.parentId || null,
        })
    if (ok) {
      toast(isEdit.value ? t('toast.updated') : t('toast.created'))
      emit('update:modelValue', false)
    } else {
      toast(t('toast.saveFail'), 'error')
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Modal :model-value="modelValue" :title="title" size="sm" @update:model-value="emit('update:modelValue', $event)">
    <div class="cat-form">
      <label class="fld">
        <span>{{ t('category.name') }}</span>
        <input ref="nameEl" v-model="form.name" class="field" :placeholder="t('category.name')" @keydown.enter="save" />
        <small v-if="error" class="err">{{ error }}</small>
      </label>

      <div class="fld">
        <span>{{ t('category.icon') }}</span>
        <div class="icon-grid">
          <button
            v-for="ic in ICON_CHOICES"
            :key="ic"
            class="icon-opt"
            :class="{ active: form.icon === ic }"
            @click="form.icon = ic"
          >
            <AppIcon :name="ic" :size="16" />
          </button>
        </div>
      </div>

      <label class="fld">
        <span>{{ t('category.root') }}</span>
        <select v-model="form.parentId" class="field">
          <option :value="null">{{ t('category.root') }}</option>
          <option v-for="c in parentOptions" :key="c.id" :value="c.id">
            {{ '　'.repeat(c.depth) }}{{ c.name }}
          </option>
        </select>
      </label>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</button>
      <button class="btn-primary" :disabled="saving" @click="save">
        {{ isEdit ? t('category.save') : t('category.create') }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.cat-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.fld {
  display: block;
}

.fld > span {
  color: var(--muted_text_color);
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}

.err {
  color: var(--danger);
  display: block;
  font-size: 11.5px;
  margin-top: 5px;
}

.icon-grid {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(8, 1fr);
}

.icon-opt {
  align-items: center;
  border: 1px solid var(--border_color);
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  height: 32px;
  justify-content: center;
  transition: border-color 0.18s ease, color 0.18s ease, background-color 0.18s ease;
}

.icon-opt:hover {
  background-color: var(--item_hover_color);
  color: var(--main_text_color);
}

.icon-opt.active {
  background-color: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-text);
}

select.field {
  cursor: pointer;
}
</style>
