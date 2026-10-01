<script setup>
/**
 * 书签新增 / 编辑弹窗。
 * 图标支持三种来源：自动获取 favicon、手填图标 URL、上传本地图片。
 *
 * ⚠️ 上传走 `uploadImage()`（`@/data/iconStorage`）：登录状态下会把图缩到
 *    最长边 256px、转 WebP、传进 Storage，只往书签里存一个**公开 URL**；
 *    未登录（纯本机模式）才回落 dataURL。以前这里直接 `readFileAsDataURL()`
 *    把 base64 塞进书签，一张 2MB 的图 base64 之后是 ~2.7MB 一行。
 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import Modal from '@/components/Modal.vue'
import { createBookmark, flatCategories, isDuplicateUrl, updateBookmark } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { uploadImage } from '@/data/iconStorage'
import { faviconOf, isUsableIcon, isValidUrl } from '@/utils/helpers'

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

/**
 * 预览框里显示的那张图。
 *
 * ⚠️ 这里**故意**跟卡片不一样：`form.icon` 非空时直接原样显示，**不过滤**。
 *    卡片那边 `faviconOf(url, icon)` 会把不合格的地址挡掉、回落到站点自己的
 *    `/favicon.ico`；但编辑框是「我填了什么」的视图 —— 用户粘了个坏地址，
 *    这里就该看见它加载失败，而不是看见一张**看起来正常的**站点图标，
 *    那样他会以为填对了，保存后卡片上却换成另一张图。
 *    真正的提醒交给下面的 `iconUnusable` 文案。
 */
const iconPreview = computed(() => {
  if (form.value.icon) return form.value.icon
  if (form.value.url) return faviconOf(form.value.url, form.value.icon)
  return ''
})

/**
 * 填了自定义图标，但地址不合格 —— 保存后**渲染时会被忽略**。
 * 在这儿说出来，比让用户保存完对着卡片纳闷强。
 */
const iconUnusable = computed(() => !!form.value.icon && !isUsableIcon(form.value.icon))

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
  try {
    const { url } = await uploadImage(file, 'icon')
    form.value.icon = url
    iconMode.value = 'upload'
  } catch (err) {
    /*
     * ⚠️ 这里**故意不回落 dataURL**。已登录却传不上去（网络 / 策略 / bucket 没建），
     *    悄悄存成 base64 就等于把要修的问题又做了一遍，而且没人会发现 ——
     *    表现是「图标设上了」。详见 iconStorage.js 顶部的取舍说明。
     *    （未登录那条路不会走到这里，它在 uploadImage 内部就返回 dataURL 了。）
     */
    console.warn('[icon] 上传失败，未写入：', err)
    toast(t('toast.uploadFail'), 'error')
  }
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
          <p v-if="iconUnusable" class="icon-warn">
            <AppIcon name="AlertCircle" :size="13" />{{ t('bookmark.iconUnusable') }}
          </p>
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
        <!--
          说明为什么要有这行：卡片上可用宽度只有 ~133px（编辑模式下 127px），
          两行也就放得下二十来个汉字。**用户在这儿完全看不出这一点** ——
          他写了一句 40 字的简介，保存后卡片上只剩「前半句…」，
          而他多半不会去悬停，只会觉得「我写的东西丢了」。
          提前说清「截断的是卡片、悬停能看全」，他就不用被迫把简介砍短。
        -->
        <small class="fld-hint">{{ t('bookmark.descHint') }}</small>
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

/* 「你填的这个地址会被忽略」。
   用 --warning_text 而不是 --warning：这是 11.5px 正文，
   亮橙压在玻璃面板上对比度只有 1.9:1，读不清。深色主题下两者等价。 */
.icon-warn {
  align-items: center;
  color: var(--warning_text);
  display: flex;
  font-size: 11.5px;
  gap: 4px;
  margin-top: 5px;
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

/* 字段说明（不是错误，所以用 muted 而不是 --danger）。
   和 `.err` 同样的排版，保证有错误提示时两行不会跳。 */
.fld-hint {
  color: var(--muted_text_color);
  display: block;
  font-size: 11.5px;
  line-height: 1.4;
  margin-top: 5px;
  opacity: 0.85;
}

select.field {
  cursor: pointer;
}
</style>
