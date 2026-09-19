<script setup>
/**
 * 书签新增 / 编辑弹窗。
 * 图标支持三种来源：自动获取 favicon、手填图标 URL、上传本地图片（转 dataURL 存本地）。
 * 校验失败时输入框会抖动一下（沿用 jerry-site 留言板的 shake 反馈）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import Modal from '@/components/Modal.vue'
import { createBookmark, flatCategories, isDuplicateUrl, updateBookmark } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { faviconOf, isValidUrl, readFileAsDataURL } from '@/utils/helpers'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 传 null 表示新增 */
  bookmark: { type: Object, default: null },
  /** 新建时默认落在哪个分类 */
  defaultCategory: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const form = ref({ name: '', url: '', description: '', categoryId: '', icon: '' })
const errors = ref({ name: '', url: '', urlShake: false, nameShake: false })
const saving = ref(false)
const iconMode = ref('auto') // auto | url | upload
const fileInput = ref(null)
const nameEl = ref(null)
const urlEl = ref(null)

const isEdit = computed(() => !!props.bookmark)
const title = computed(() => (isEdit.value ? t('bookmark.editTitle') : t('bookmark.addTitle')))

const iconPreview = computed(() => {
  if (form.value.icon) return form.value.icon
  if (form.value.url) return faviconOf(form.value.url)
  return ''
})

const categoryOptions = computed(() => flatCategories.value)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.bookmark) {
      form.value = {
        name: props.bookmark.name,
        url: props.bookmark.url,
        description: props.bookmark.description || '',
        categoryId: props.bookmark.categoryId || '',
        icon: props.bookmark.icon || '',
      }
      iconMode.value = props.bookmark.icon ? 'url' : 'auto'
    } else {
      form.value = {
        name: '',
        url: '',
        description: '',
        categoryId: props.defaultCategory || categoryOptions.value[0]?.id || '',
        icon: '',
      }
      iconMode.value = 'auto'
    }
    errors.value = { name: '', url: '', urlShake: false, nameShake: false }
    nextTick(() => nameEl.value?.focus())
  },
)

/** 重放抖动动画：先清掉动画 → 强制重排 → 再挂上。 */
async function shake(target) {
  await nextTick()
  const el = target === 'name' ? nameEl.value : urlEl.value
  if (!el) return
  el.style.animation = 'none'
  void el.offsetHeight
  el.style.animation = 'shake 0.5s ease-in-out'
}

async function save() {
  errors.value.name = form.value.name.trim() ? '' : t('bookmark.needFields')
  const url = form.value.url.trim()
  if (!url) errors.value.url = t('bookmark.needUrl')
  else if (!isValidUrl(url)) errors.value.url = t('bookmark.badUrl')
  else if (isDuplicateUrl(url, props.bookmark?.id)) errors.value.url = t('bookmark.duplicateHint')
  else errors.value.url = ''

  if (errors.value.name) shake('name')
  if (errors.value.url) {
    shake('url')
    toast(errors.value.url, 'error')
    return
  }
  if (errors.value.name) {
    toast(errors.value.name, 'error')
    return
  }

  saving.value = true
  try {
    const payload = {
      name: form.value.name.trim(),
      url,
      description: form.value.description.trim(),
      categoryId: form.value.categoryId || null,
      icon: iconMode.value === 'auto' ? '' : form.value.icon,
    }
    const ok = isEdit.value
      ? await updateBookmark(props.bookmark.id, payload)
      : await createBookmark(payload)
    if (ok) {
      toast(isEdit.value ? t('toast.updated') : t('toast.added'))
      emit('update:modelValue', false)
    } else {
      toast(t('toast.saveFail'), 'error')
    }
  } finally {
    saving.value = false
  }
}

async function onPickIcon() {
  fileInput.value?.click()
}

async function onIconFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!/^image\//.test(file.type)) {
    toast(t('toast.saveFail'), 'error')
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    toast(t('auth.imageTooBig'), 'error')
    return
  }
  const dataUrl = await readFileAsDataURL(file)
  form.value.icon = dataUrl
  iconMode.value = 'upload'
}

function useAutoIcon() {
  form.value.icon = ''
  iconMode.value = 'auto'
}
</script>

<template>
  <Modal :model-value="modelValue" :title="title" @update:model-value="emit('update:modelValue', $event)">
    <div class="bm-form">
      <!-- 图标 -->
      <div class="icon-row">
        <button class="icon-pick" :title="t('bookmark.iconPick')" @click="onPickIcon">
          <BookmarkIcon :src="iconPreview" :name="form.name || '?'" :hash-key="form.url" :size="48" :radius="12" />
          <span class="icon-overlay"><AppIcon name="Image" :size="15" /></span>
        </button>
        <div class="icon-meta">
          <p class="icon-hint">{{ t('bookmark.iconPick') }}</p>
          <button v-if="iconMode !== 'auto'" class="link-btn" @click="useAutoIcon">
            {{ t('bookmark.iconDefault') }}
          </button>
        </div>
      </div>

      <label class="fld">
        <span>{{ t('bookmark.name') }} <em>*</em></span>
        <input ref="nameEl" v-model="form.name" class="field" :placeholder="t('bookmark.namePlaceholder')" />
        <small v-if="errors.name" class="err">{{ errors.name }}</small>
      </label>

      <label class="fld">
        <span>{{ t('bookmark.url') }} <em>*</em></span>
        <input ref="urlEl" v-model="form.url" class="field" placeholder="https://" />
        <small v-if="errors.url" class="err">{{ errors.url }}</small>
      </label>

      <label class="fld">
        <span>{{ t('bookmark.desc') }} <em class="opt">{{ t('common.optional') }}</em></span>
        <input v-model="form.description" class="field" :placeholder="t('bookmark.descPlaceholder')" />
      </label>

      <label class="fld">
        <span>{{ t('bookmark.category') }}</span>
        <select v-model="form.categoryId" class="field">
          <option value="">{{ t('common.uncategorized') }}</option>
          <option v-for="c in categoryOptions" :key="c.id" :value="c.id">
            {{ '　'.repeat(c.depth) }}{{ c.name }}
          </option>
        </select>
      </label>

      <label v-if="iconMode !== 'auto'" class="fld">
        <span>{{ t('bookmark.iconUrl') }}</span>
        <input v-model="form.icon" class="field" placeholder="https://" />
      </label>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</button>
      <button class="btn-primary" :disabled="saving" @click="save">
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </template>

    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/x-icon,image/svg+xml" hidden @change="onIconFile" />
  </Modal>
</template>

<style scoped>
.bm-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.icon-row {
  align-items: center;
  display: flex;
  gap: 14px;
}

.icon-pick {
  border-radius: 12px;
  flex-shrink: 0;
  position: relative;
  transition: transform 0.2s ease;
}

.icon-pick:hover {
  transform: scale(1.05);
}

.icon-overlay {
  align-items: center;
  background-color: rgba(0, 0, 0, 0.55);
  border-radius: 12px;
  color: #fff;
  display: flex;
  inset: 0;
  justify-content: center;
  opacity: 0;
  position: absolute;
  transition: opacity 0.2s ease;
}

.icon-pick:hover .icon-overlay {
  opacity: 1;
}

.icon-meta {
  min-width: 0;
}

.icon-hint {
  color: var(--muted_text_color);
  font-size: 12px;
}

.link-btn {
  color: var(--accent-text);
  font-size: 12px;
  margin-top: 5px;
  text-decoration: underline;
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

.fld em {
  color: var(--danger);
  font-style: normal;
}

.fld em.opt {
  color: var(--muted_text_color);
  font-size: 11px;
  opacity: 0.8;
}

.err {
  color: var(--danger);
  display: block;
  font-size: 11.5px;
  margin-top: 5px;
}

select.field {
  cursor: pointer;
}
</style>
