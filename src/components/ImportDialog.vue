<script setup>
/**
 * 导入浏览器书签。
 * 解析 Netscape 书签格式（Chrome / Edge / Firefox 导出的 .html 都是这个格式），
 * 把 <H3> 当文件夹、<A> 当书签，逐层还原成分类树。
 * 先让用户勾选要导入的条目，确认后再写入。
 */
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import Modal from '@/components/Modal.vue'
import { createCategory, state, upsertBookmarks } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { readFileAsText } from '@/utils/helpers'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const fileInput = ref(null)
const parsed = ref([])
const selected = ref(new Set())
const importing = ref(false)
const fileName = ref('')

const allSelected = computed(
  () => parsed.value.length > 0 && selected.value.size === parsed.value.length,
)

const totalCount = computed(() => parsed.value.length)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    parsed.value = []
    selected.value = new Set()
    fileName.value = ''
  },
)

function pickFile() {
  fileInput.value?.click()
}

/**
 * 递归解析 <DL> 结构。
 *
 * 顺带读 <DD> 当描述。Netscape 格式里 <DD> 是书签的备注位，
 * Chrome / Firefox 导出时都会带上（浏览器里叫「备注」），
 * 但原来的实现只读 <A> 的文字，于是导入进来的卡片第二行永远是空的。
 *
 * ⚠️ <DD> 是 <DT> 的**兄弟**，不是子元素。
 * 按 HTML 规范，`<dd>` 起始标签会先把开着的 `<dd>`/`<dt>` 弹掉再插入自己，
 * 所以解析出来是 `DT, DD, DT, DD…` 这样平铺的。
 * 写成 `child.querySelector(':scope > DD')` 会一条都读不到（实测过）。
 */
function walkDl(dl, parentName, out) {
  for (const child of dl.children) {
    if (child.tagName !== 'DT') continue
    const h3 = child.querySelector(':scope > H3')
    const a = child.querySelector(':scope > A')
    if (h3) {
      const folder = h3.textContent.trim()
      const sub = child.querySelector(':scope > DL')
      const full = parentName ? `${parentName}/${folder}` : folder
      if (sub) walkDl(sub, full, out)
      else out.push({ folder: full, title: folder, url: '', description: '' })
    } else if (a) {
      const url = a.getAttribute('HREF') || ''
      const title = a.textContent.trim() || url
      const sib = child.nextElementSibling
      const description = sib && sib.tagName === 'DD' ? sib.textContent.trim() : ''
      if (url && /^https?:\/\//i.test(url)) out.push({ folder: parentName, title, url, description })
    }
  }
}

async function onFile(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!/\.html?$/i.test(file.name)) {
    toast(t('import.unsupported'), 'error')
    return
  }
  fileName.value = file.name
  try {
    const text = await readFileAsText(file)
    const doc = new DOMParser().parseFromString(text, 'text/html')
    const out = []
    /**
     * 只从**最外层**的 <DL> 开始走。
     *
     * 这里原本写的是 `dl.closest('DL') === null || dl.parentElement?.tagName === 'DT'`，
     * 有 bug：`closest()` 是**包含自身**的，对 <DL> 调它永远返回自己、永不返回 null，
     * 所以前半句恒为假。剩下的后半句只能命中「嵌在 <DT> 里的 <DL>」，
     * 也就是各分类内部的那些 —— 根 <DL> 被整个跳过。
     *
     * 而嵌套调用传进去的 parentName 是 ''，于是每个书签的 folder 都算成空字符串，
     * 导入后 100% 落进「未分类」，`ensureCategories` 一个分类也建不出来。
     * 不只是自制文件，Chrome / Edge 自己导出的书签导进来也一样。
     *
     * 正确判据：父元素不在另一个 <DL> 里面，就说明这个 <DL> 是最外层的。
     */
    doc.querySelectorAll('DL').forEach((dl) => {
      if (dl.parentElement?.closest('DL') == null) {
        walkDl(dl, '', out)
      }
    })
    // 上面可能重复遍历，按 url 去重
    const seen = new Set()
    parsed.value = out.filter((x) => {
      const k = x.url || `folder:${x.folder}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (!parsed.value.length) {
      toast(t('import.noData'), 'warning')
    } else {
      selected.value = new Set(parsed.value.map((_, i) => i))
    }
  } catch {
    toast(t('import.importFail'), 'error')
  }
}

function toggleAll() {
  if (allSelected.value) selected.value = new Set()
  else selected.value = new Set(parsed.value.map((_, i) => i))
}

function toggleOne(i) {
  const s = new Set(selected.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  selected.value = s
}

/** 按文件夹路径创建（或复用）分类，返回 folder → categoryId 的映射。 */
async function ensureCategories(items) {
  const map = {}
  const existing = {}
  for (const c of state.categories) existing[c.name] = c.id

  const folders = [...new Set(items.map((i) => i.folder).filter(Boolean))]
  for (const path of folders) {
    const parts = path.split('/').filter(Boolean)
    let parentId = null
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      if (map[acc]) {
        parentId = map[acc]
        continue
      }
      if (existing[part] && parts.length === 1) {
        map[acc] = existing[part]
        parentId = existing[part]
        continue
      }
      const created = await createCategory({ name: part, icon: 'Folder', parentId })
      if (created) {
        map[acc] = created.id
        parentId = created.id
      }
    }
  }
  return map
}

async function doImport() {
  const items = parsed.value.filter((_, i) => selected.value.has(i) && _.url)
  if (!items.length) {
    toast(t('import.notFound'), 'warning')
    return
  }
  importing.value = true
  try {
    const map = await ensureCategories(items)
    /**
     * ⚠️ 用 upsert 而不是逐条 createBookmark。
     *
     * 导入文件是会重新生成的（标题清洗规则一改就得重导一遍），
     * 而用户库里已经躺着上一份 975 条。逐条 create 会让整体翻倍到 1950 条，
     * 用户只能先清库 —— 那会连带丢掉他自己手加的书签和分类排序。
     *
     * upsert 按 URL 认人：同一条更新 name / description / categoryId，
     * 新的才新建。顺带把「每条落一次盘」改成「整批落一次」。
     */
    const res = await upsertBookmarks(
      items.map((item) => ({
        name: item.title,
        url: item.url,
        description: item.description || '',
        categoryId: item.folder ? map[item.folder] || null : null,
      })),
    )
    if (!res) throw new Error('upsert failed')
    toast(t('import.done', { n: res.created, u: res.updated }))
    emit('update:modelValue', false)
  } catch {
    toast(t('import.importFail'), 'error')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <Modal :model-value="modelValue" :title="t('import.title')" size="lg" @update:model-value="emit('update:modelValue', $event)">
    <!-- 未选文件 -->
    <div v-if="!parsed.length" class="drop" @click="pickFile">
      <AppIcon name="FileUp" :size="30" />
      <strong>{{ t('import.title') }}</strong>
      <span>{{ t('import.hint') }}</span>
      <button class="btn-primary">{{ t('bookmark.import') }}</button>
    </div>

    <!-- 已解析 -->
    <div v-else class="parsed">
      <div class="parsed-head">
        <span class="file-name">{{ fileName }} · {{ t('common.sites', { n: totalCount }) }}</span>
        <button class="btn-ghost sm" @click="toggleAll">
          <AppIcon :name="allSelected ? 'X' : 'Check'" :size="14" />
          {{ allSelected ? t('import.deselectAll') : t('import.selectAll') }}
        </button>
        <button class="btn-ghost sm" @click="pickFile">
          <AppIcon name="RotateCcw" :size="14" />{{ t('import.reselect') }}
        </button>
      </div>

      <div class="parsed-list">
        <label v-for="(item, i) in parsed" :key="item.url + i" class="parsed-item">
          <input type="checkbox" :checked="selected.has(i)" @change="toggleOne(i)" />
          <div class="parsed-text">
            <strong>{{ item.title }}</strong>
            <span>{{ item.folder || t('common.uncategorized') }} · {{ item.url }}</span>
          </div>
        </label>
      </div>
    </div>

    <template #footer>
      <button class="btn-ghost" @click="emit('update:modelValue', false)">{{ t('common.cancel') }}</button>
      <button v-if="parsed.length" class="btn-primary" :disabled="importing || !selected.size" @click="doImport">
        {{ importing ? t('import.importing') : t('import.title') }}
      </button>
    </template>

    <input ref="fileInput" type="file" accept=".html,.htm,text/html" hidden @change="onFile" />
  </Modal>
</template>

<style scoped>
.drop {
  align-items: center;
  border: 2px dashed var(--border_color);
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 44px 20px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.drop:hover {
  background-color: var(--accent-softer);
  border-color: var(--accent);
}

.drop :deep(svg) {
  color: var(--accent-text);
}

.drop strong {
  font-size: 14px;
  margin-top: 4px;
}

.drop span {
  color: var(--muted_text_color);
  font-size: 12.5px;
  margin-bottom: 8px;
  text-align: center;
}

.parsed-head {
  align-items: center;
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.file-name {
  color: var(--muted_text_color);
  flex: 1;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-ghost.sm {
  font-size: 12px;
  padding: 6px 11px;
}

.parsed-list {
  border: 1px solid var(--border_color);
  border-radius: var(--radius);
  max-height: 340px;
  overflow-y: auto;
  padding: 4px;
}

.parsed-item {
  align-items: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  gap: 10px;
  padding: 7px 9px;
  transition: background-color 0.14s ease;
}

.parsed-item:hover {
  background-color: var(--item_hover_color);
}

.parsed-item input {
  accent-color: var(--accent);
  flex-shrink: 0;
  height: 15px;
  width: 15px;
}

.parsed-text {
  min-width: 0;
}

.parsed-text strong {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parsed-text span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
