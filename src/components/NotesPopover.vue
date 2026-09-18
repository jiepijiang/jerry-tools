<script setup>
/** 便签弹层。参考站顶部有个「便签」卡片，显示条数，点开可以增删改。 */
import { computed, nextTick, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { deleteNote, saveNote, state } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { uid } from '@/utils/helpers'

const { t } = useI18n()

const open = ref(false)
const draft = ref('')
const editingId = ref(null)
const inputEl = ref(null)

const notes = computed(() => state.notes)

function toggle() {
  open.value = !open.value
  if (open.value) nextTick(() => inputEl.value?.focus())
}

function startEdit(note) {
  editingId.value = note.id
  draft.value = note.content
  nextTick(() => inputEl.value?.focus())
}

async function submit() {
  const content = draft.value.trim()
  if (!content) return
  await saveNote({ id: editingId.value || uid('note'), content })
  draft.value = ''
  editingId.value = null
  toast(t('toast.saved'))
}

async function remove(note) {
  await deleteNote(note.id)
  if (editingId.value === note.id) {
    editingId.value = null
    draft.value = ''
  }
  toast(t('toast.deleted'))
}

function cancelEdit() {
  editingId.value = null
  draft.value = ''
}
</script>

<template>
  <div class="notes-wrap">
    <button class="top-card" :class="{ active: open }" @click="toggle">
      <AppIcon name="StickyNote" :size="19" />
      <div class="card-text">
        <strong>{{ t('notes.title') }}</strong>
        <span>{{ t('notes.count', { n: notes.length }) }}</span>
      </div>
    </button>

    <Transition name="pop">
      <div v-if="open" class="notes-pop glass">
        <div class="pop-head">
          <span>{{ t('notes.title') }}</span>
          <button class="icon-btn tiny" @click="open = false">
            <AppIcon name="X" :size="15" />
          </button>
        </div>

        <div class="note-list">
          <p v-if="!notes.length" class="empty">{{ t('notes.empty') }}</p>
          <div v-for="n in notes" :key="n.id" class="note-row">
            <p class="note-text">{{ n.content }}</p>
            <div class="note-ops">
              <button class="mini" @click="startEdit(n)"><AppIcon name="Pencil" :size="13" /></button>
              <button class="mini danger" @click="remove(n)"><AppIcon name="Trash2" :size="13" /></button>
            </div>
          </div>
        </div>

        <div class="note-input">
          <input
            ref="inputEl"
            v-model="draft"
            class="field"
            :placeholder="t('notes.placeholder')"
            @keydown.enter="submit"
          />
          <button class="btn-primary sm" :disabled="!draft.trim()" @click="submit">
            {{ editingId ? t('notes.save') : t('notes.add') }}
          </button>
          <button v-if="editingId" class="btn-ghost sm" @click="cancelEdit">
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.notes-wrap {
  position: relative;
}

.top-card {
  align-items: center;
  border-radius: var(--radius);
  color: var(--main_text_color);
  display: flex;
  gap: 9px;
  padding: 7px 11px;
  transition: background-color 0.2s ease;
}

.top-card:hover,
.top-card.active {
  background-color: var(--item_hover_color);
}

.card-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  text-align: left;
}

.card-text strong {
  font-size: 12.5px;
  font-weight: 500;
}

.card-text span {
  color: var(--muted_text_color);
  font-size: 11px;
}

.notes-pop {
  border-radius: var(--radius-lg);
  box-shadow: 0 18px 44px var(--shadow-hover);
  padding: 12px;
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: 292px;
  z-index: 300;
}

.pop-head {
  align-items: center;
  display: flex;
  font-size: 13px;
  font-weight: 600;
  justify-content: space-between;
  margin-bottom: 8px;
}

.icon-btn.tiny {
  height: 26px;
  width: 26px;
}

.note-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.empty {
  color: var(--muted_text_color);
  font-size: 12.5px;
  padding: 10px 0;
  text-align: center;
}

.note-row {
  align-items: flex-start;
  background-color: var(--text_bg_color);
  border-radius: var(--radius-sm);
  display: flex;
  gap: 6px;
  padding: 8px 9px;
}

.note-text {
  flex: 1;
  font-size: 12.5px;
  line-height: 1.55;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.note-row:hover .note-ops {
  opacity: 1;
}

.mini {
  align-items: center;
  border-radius: 4px;
  color: var(--muted_text_color);
  display: flex;
  height: 22px;
  justify-content: center;
  width: 22px;
}

.mini:hover {
  background-color: var(--accent-soft);
  color: var(--accent-text);
}

.mini.danger:hover {
  background-color: rgba(229, 72, 77, 0.16);
  color: var(--danger);
}

.note-input {
  display: flex;
  gap: 6px;
  margin-top: 10px;
}

.btn-primary.sm,
.btn-ghost.sm {
  flex-shrink: 0;
  font-size: 12.5px;
  padding: 7px 12px;
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}
</style>
