<script setup>
/**
 * 书签新增 / 编辑弹窗。
 *
 * ## 图标：从「隐式先后关系」改成「显式三选一」（2026-10-14）
 *
 * 以前图标只有一条隐式规则：**先试站点自己的 favicon，失败才显示首字母**。
 * 用户看不见、也控制不了 —— 站点有图标就一定有图标，想要纯字母块做不到；
 * 而且「到底有没有抓到图标」这件事，只有在卡片上才看得出来。
 *
 * 现在上面有个三选一（见 `helpers.js` 的 `ICON_MODES`）：
 *
 *   initial  只用「名称首字母 + 渐变底」
 *   favicon  自动抓站点自己的 `/favicon.ico`（**抓没抓到会当场显示出来**）
 *   custom   上传一张图，或直接填图标地址
 *
 * ⚠️ 上传走 `uploadImage()`（`@/data/iconStorage`）：登录状态下会把图缩到
 *    最长边 256px、转 WebP、传进 Storage，只往书签里存一个**公开 URL**；
 *    未登录（纯本机模式）才回落 dataURL。以前这里直接 `readFileAsDataURL()`
 *    把 base64 塞进书签，一张 2MB 的图 base64 之后是 ~2.7MB 一行。
 *
 * ⚠️ 保存时非 custom 一律把 `icon` 清空 —— 不然「切回首字母」之后，
 *    那个旧的自定义地址还躺在数据里，下次误切到 custom 会突然冒出来。
 */
import { computed, nextTick, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import Modal from '@/components/Modal.vue'
import { createBookmark, flatCategories, isDuplicateUrl, updateBookmark } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { uploadImage } from '@/data/iconStorage'
import { faviconOf, isUsableIcon, isValidUrl, resolveIconMode } from '@/utils/helpers'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 传 null 表示新增 */
  bookmark: { type: Object, default: null },
  /** 新建时默认落在哪个分类 */
  defaultCategory: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

/**
 * 三个选项。**顺序就是用户看到的顺序**，也是「从简到繁」：
 * 首字母（零配置）→ 网站图标（自动）→ 自定义（要动手）。
 */
const ICON_MODE_OPTIONS = [
  { id: 'initial', labelKey: 'bookmark.iconInitial' },
  { id: 'favicon', labelKey: 'bookmark.iconFavicon' },
  { id: 'custom', labelKey: 'bookmark.iconCustom' },
]

/** 新建时的默认来源。保持「有图标就显示图标」这个老默认，别让老用户觉得变了。 */
const DEFAULT_ICON_MODE = 'favicon'

const form = ref({ name: '', url: '', description: '', categoryId: '', icon: '' })
const errors = ref({ name: '', url: '', urlShake: false, nameShake: false })
const saving = ref(false)
const iconMode = ref(DEFAULT_ICON_MODE)
/** idle | loading | ok | fail —— 只在 favicon 模式下有意义 */
const faviconState = ref('idle')
const fileInput = ref(null)
const nameEl = ref(null)
const urlEl = ref(null)

const isEdit = computed(() => !!props.bookmark)
const title = computed(() => (isEdit.value ? t('bookmark.editTitle') : t('bookmark.addTitle')))

/**
 * 预览框里显示的那张图。
 *
 * ⚠️ custom 模式下**故意不过滤**，原样显示：编辑框是「我填了什么」的视图 ——
 *    用户粘了个坏地址，这里就该看见它加载失败，而不是看见一张**看起来正常的**
 *    站点图标，那样他会以为填对了，保存后卡片上却换成另一张图。
 *    真正的提醒交给下面的 `iconUnusable` 文案。
 *
 * ⚠️ 也正因为 custom 那条分支，这里**不能**直接调 `iconSrcFor(item)` ——
 *    那个函数对不合格的自定义地址会回落到站点图标，正是上面要避免的行为。
 *    所以 initial / favicon 两条分支虽然和 `iconSrcFor` 结果一致，
 *    仍是**各写一份**。改 `iconSrcFor` 的语义时，这里不会跟着变
 *    （`probe-icon-source.mjs` 的造红 C 实测确认过这一点）。
 */
const iconPreview = computed(() => {
  if (iconMode.value === 'initial') return ''
  if (iconMode.value === 'favicon') {
    return form.value.url.trim() ? faviconOf(form.value.url, '') : ''
  }
  return form.value.icon
})

/**
 * 站点图标的获取状态。
 *
 * ⚠️ 同时看 `iconMode` 和 `iconPreview` 两个源。只看 `iconPreview` 的话，
 *    「custom 填的正好也是同一个 /favicon.ico，再切到 favicon」这种情况下
 *    值没变、watch 不触发，状态会永远停在 idle，界面上什么都不显示。
 */
watch([iconPreview, iconMode], ([src, mode]) => {
  if (mode !== 'favicon') {
    faviconState.value = 'idle'
    return
  }
  faviconState.value = src ? 'loading' : 'idle'
})

/*
 * ⚠️ 事件回调里要再判一次模式：切换来源时旧的 `<img>` 可能还会补发一次
 *    load / error（src 变了、但上一个请求已经回来了），不判就会把
 *    custom 的加载结果算到 favicon 头上。
 */
function onIconLoad() {
  if (iconMode.value === 'favicon') faviconState.value = 'ok'
}
function onIconError() {
  if (iconMode.value === 'favicon') faviconState.value = 'fail'
}

/** 当前来源的一句话说明。 */
const iconHint = computed(
  () =>
    t(
      {
        initial: 'bookmark.iconInitialHint',
        favicon: 'bookmark.iconFaviconHint',
        custom: 'bookmark.iconCustomHint',
      }[iconMode.value],
    ),
)

/**
 * favicon 模式下那行状态字。
 *
 * 「没抓到」必须**说出来** —— 否则用户选了「网站图标」，看到字母块，
 * 会以为是这个选项坏了，而不是「这个站点本来就没有 /favicon.ico」。
 */
const faviconStatus = computed(() => {
  if (iconMode.value !== 'favicon') return ''
  if (faviconState.value === 'ok') return t('bookmark.iconFaviconOk')
  if (faviconState.value === 'fail') return t('bookmark.iconFaviconFail')
  if (!form.value.url.trim()) return t('bookmark.iconNeedUrl')
  return t('bookmark.iconFaviconLoading')
})

const faviconTone = computed(() => {
  if (iconMode.value !== 'favicon') return ''
  if (faviconState.value === 'ok') return 'ok'
  if (faviconState.value === 'fail') return 'warn'
  return 'muted'
})

/**
 * 填了自定义图标，但地址不合格 —— 保存后**渲染时会被忽略**。
 * 在这儿说出来，比让用户保存完对着卡片纳闷强。
 */
const iconUnusable = computed(
  () => iconMode.value === 'custom' && !!form.value.icon && !isUsableIcon(form.value.icon),
)

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
      // 老数据没有 iconMode → resolveIconMode 按当时的行为推断，显示不变
      iconMode.value = resolveIconMode(props.bookmark)
    } else {
      form.value = {
        name: '',
        url: '',
        description: '',
        categoryId: props.defaultCategory || categoryOptions.value[0]?.id || '',
        icon: '',
      }
      iconMode.value = DEFAULT_ICON_MODE
    }
    faviconState.value = 'idle'
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
      iconMode: iconMode.value,
      // 非 custom 一律清空，见文件头那条 ⚠️
      icon: iconMode.value === 'custom' ? form.value.icon.trim() : '',
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

function onPickIcon() {
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
    iconMode.value = 'custom'
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
</script>

<template>
  <Modal :model-value="modelValue" :title="title" @update:model-value="emit('update:modelValue', $event)">
    <div class="bm-form">
      <!-- 图标来源：先选，再看效果 -->
      <div class="fld">
        <span>{{ t('bookmark.iconSource') }}</span>
        <div class="seg" role="group" :aria-label="t('bookmark.iconSource')">
          <button
            v-for="o in ICON_MODE_OPTIONS"
            :key="o.id"
            type="button"
            class="seg-btn"
            :class="{ on: iconMode === o.id }"
            :aria-pressed="iconMode === o.id"
            @click="iconMode = o.id"
          >
            {{ t(o.labelKey) }}
          </button>
        </div>
      </div>

      <div class="icon-row">
        <BookmarkIcon
          :src="iconPreview"
          :name="form.name || '?'"
          :hash-key="form.url"
          :size="48"
          :radius="12"
          :lazy="false"
          @load="onIconLoad"
          @error="onIconError"
        />
        <div class="icon-meta">
          <p class="icon-hint">{{ iconHint }}</p>
          <p v-if="faviconStatus" class="icon-status" :class="faviconTone">
            <AppIcon v-if="faviconTone === 'ok'" name="CheckCircle" :size="13" />
            <AppIcon v-else-if="faviconTone === 'warn'" name="AlertCircle" :size="13" />
            <AppIcon v-else name="Loader" :size="13" />
            {{ faviconStatus }}
          </p>
          <p v-if="iconUnusable" class="icon-warn">
            <AppIcon name="AlertCircle" :size="13" />{{ t('bookmark.iconUnusable') }}
          </p>
        </div>
      </div>

      <!-- 只有自定义才需要动手：上传 或 填地址 -->
      <template v-if="iconMode === 'custom'">
        <button type="button" class="btn-ghost icon-upload" @click="onPickIcon">
          <AppIcon name="Upload" :size="15" />{{ t('bookmark.iconUpload') }}
        </button>
        <label class="fld">
          <span>{{ t('bookmark.iconUrl') }}</span>
          <input v-model="form.icon" class="field" placeholder="https://" />
        </label>
      </template>

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

/* —— 图标来源：分段控件 —— */
.seg {
  background-color: var(--item_bg_color);
  border: 1px solid var(--border_color);
  border-radius: var(--radius);
  display: flex;
  gap: 3px;
  padding: 3px;
}

.seg-btn {
  border-radius: calc(var(--radius) - 3px);
  color: var(--muted_text_color);
  flex: 1;
  font-size: 12.5px;
  padding: 7px 4px;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.seg-btn:hover {
  color: var(--main_text_color);
}

/* 选中态用主题色底 + 白字，和 .btn-primary 保持同一套语言。
   不用描边区分：三个并排时描边看不出哪个是「选中的那个」。 */
.seg-btn.on {
  background-color: var(--accent);
  color: #fff;
  font-weight: 600;
}

.icon-row {
  align-items: center;
  display: flex;
  gap: 14px;
}

.icon-meta {
  min-width: 0;
}

.icon-hint {
  color: var(--muted_text_color);
  font-size: 12px;
  line-height: 1.4;
}

/* favicon 的获取状态。三档颜色：
   ok   —— 拿到了，用 --success
   warn —— 没拿到，会退回首字母（用 --warning_text，理由见下）
   muted —— 加载中 / 还没填网址，不该抢注意力 */
.icon-status {
  align-items: center;
  display: flex;
  font-size: 11.5px;
  gap: 4px;
  margin-top: 5px;
}

.icon-status.ok {
  color: var(--success);
}

/* 「你填的这个地址会被忽略」「没抓到站点图标」。
   用 --warning_text 而不是 --warning：这是 11.5px 正文，
   亮橙压在玻璃面板上对比度只有 1.9:1，读不清。深色主题下两者等价。 */
.icon-status.warn,
.icon-warn {
  align-items: center;
  color: var(--warning_text);
  display: flex;
  font-size: 11.5px;
  gap: 4px;
  margin-top: 5px;
}

.icon-status.muted {
  color: var(--muted_text_color);
  opacity: 0.85;
}

/* 加载中那个转圈。--reduced-motion 下不转（转动的装饰对这类用户是干扰）。 */
.icon-status.muted :deep(svg) {
  animation: spin 1.1s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .icon-status.muted :deep(svg) {
    animation: none;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.icon-upload {
  align-self: flex-start;
  font-size: 13px;
  padding: 7px 14px;
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
