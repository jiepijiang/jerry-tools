<script setup>
/**
 * 顶部信息栏。
 * 从左到右：Logo / 导航 / 时钟 / 农历 / 便签 / 天气 / 搜索 / 语言 / 主题色 / 主题 / 设置 / 登录
 * 窄屏时收起信息卡片，只留 Logo、导航和几个按钮。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import NotesPopover from '@/components/NotesPopover.vue'
import WeatherIcon from '@/components/WeatherIcon.vue'
import { useClock } from '@/composables/useClock'
import { useI18n } from '@/composables/useI18n'
import { cycleThemeMode, isDark, setSetting, settings } from '@/composables/useSettings'
import { accentColors } from '@/data/themeColors'
import { isLoggedIn } from '@/composables/useAuth'
import { state } from '@/composables/useStore'
import { hostOf } from '@/utils/helpers'

const emit = defineEmits(['openSettings', 'openSearch'])

const router = useRouter()
const { t } = useI18n()
const { timeText, dateText, lunarText, todayBadge, weather, geo } = useClock()

const accentOpen = ref(false)
const userOpen = ref(false)
const mobileMenu = ref(false)

const navItems = computed(() => {
  const items = [
    { name: 'home', label: t('nav.home'), icon: 'Home' },
    { name: 'discover', label: t('nav.discover'), icon: 'Compass' },
  ]
  if (state.session?.isAdmin) items.push({ name: 'admin', label: t('nav.admin'), icon: 'Shield' })
  return items
})

const activeName = computed(() => {
  if (router.currentRoute.value.name === 'discover') return 'discover'
  if (router.currentRoute.value.name === 'admin') return 'admin'
  return 'home'
})

const themeIcon = computed(() => {
  if (settings.themeMode === 'system') return 'MonitorSmartphone'
  return isDark.value ? 'Moon' : 'Sun'
})

/**
 * 现在显示的天气是不是「谁都没给、落到内置默认城市」的那份。
 * 是的话要在卡片上标出来 —— 否则用户会把默认城市的天气当成本地天气。
 */
const needsCity = computed(() => weather.source === 'default')

async function pickAccent(id) {
  await setSetting('accent', id)
  accentOpen.value = false
}

async function toggleLang() {
  await setSetting('language', settings.language === 'zh' ? 'en' : 'zh')
}

function go(name) {
  router.push({ name })
  mobileMenu.value = false
}
</script>

<template>
  <header class="topbar glass">
    <!-- Logo -->
    <div class="brand" @click="go('home')">
      <div class="brand-mark">
        <AppIcon name="Sparkle" :size="17" />
      </div>
      <div class="brand-text">
        <strong>{{ t('app.name') }}</strong>
        <span>{{ t('app.tagline') }}</span>
      </div>
    </div>

    <!-- 导航 -->
    <nav class="nav" :class="{ open: mobileMenu }">
      <button
        v-for="item in navItems"
        :key="item.name"
        class="nav-item"
        :class="{ active: activeName === item.name }"
        @click="go(item.name)"
      >
        <AppIcon :name="item.icon" :size="15" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="spacer" />

    <!-- 时钟 -->
    <div class="info-card hide-md">
      <AppIcon name="Clock" :size="19" />
      <div class="card-text">
        <strong>{{ timeText }}</strong>
        <span>{{ dateText }}</span>
      </div>
    </div>

    <!-- 农历 -->
    <div class="info-card hide-lg">
      <AppIcon name="Calendar" :size="19" />
      <div class="card-text">
        <strong>{{ lunarText }}</strong>
        <span>{{ todayBadge.text || t('clock.lunar') }}</span>
      </div>
    </div>

    <!-- 便签 -->
    <div class="hide-lg">
      <NotesPopover />
    </div>

    <!-- 天气 -->
    <button
      class="info-card weather hide-md"
      :class="{ 'needs-city': needsCity }"
      :title="needsCity ? t('weather.setCityHint') : t('weather.switchCity')"
      @click="emit('openSettings', 'weather')"
    >
      <WeatherIcon :group="weather.group" :size="30" />
      <div class="card-text">
        <strong>{{ weather.temp != null ? weather.temp + '°' : '--' }}</strong>
        <span>{{ weather.text || (geo.locating ? t('weather.locating') : t('weather.loading')) }}</span>
      </div>
      <div v-if="weather.temp != null" class="card-text sub">
        <strong>{{ weather.city }}</strong>
        <span>
          <em v-if="needsCity" class="geo-tag">
            <AppIcon name="MapPinOff" :size="10" :stroke="2.4" />{{ t('weather.notLocated') }}
          </em>
          {{ weather.low }}° ~ {{ weather.high }}°
        </span>
      </div>
    </button>

    <!-- 搜索入口 -->
    <button class="search-entry hide-sm" @click="emit('openSearch')">
      <AppIcon name="Search" :size="15" />
      <span>{{ t('search.short') }}</span>
    </button>

    <!-- 右侧按钮组 -->
    <div class="actions">
      <button class="icon-btn hide-sm" :title="t('settings.language')" @click="toggleLang">
        <span class="lang">{{ settings.language === 'zh' ? '中' : 'EN' }}</span>
      </button>

      <div class="accent-wrap hide-sm">
        <button class="icon-btn" :title="t('theme.accent')" @click="accentOpen = !accentOpen">
          <span class="dot" :style="{ background: `var(--accent)` }" />
        </button>
        <Transition name="pop">
          <div v-if="accentOpen" class="accent-pop glass">
            <button
              v-for="c in accentColors"
              :key="c.id"
              class="swatch"
              :class="{ active: settings.accent === c.id }"
              :style="{ background: c.hex }"
              :title="c.name"
              @click="pickAccent(c.id)"
            />
          </div>
        </Transition>
      </div>

      <button class="icon-btn" :title="t('theme.title')" @click="cycleThemeMode">
        <AppIcon :name="themeIcon" :size="18" />
      </button>

      <button class="icon-btn" :title="t('settings.title')" @click="emit('openSettings')">
        <AppIcon name="Settings" :size="18" />
      </button>

      <!-- 登录 / 用户 -->
      <div class="user-wrap">
        <button v-if="!isLoggedIn" class="btn-primary login-btn" @click="go('login')">
          <AppIcon name="LogIn" :size="15" />
          <span>{{ t('auth.login') }}</span>
        </button>
        <button v-else class="avatar-btn" @click="userOpen = !userOpen">
          <img v-if="state.session.avatar" :src="state.session.avatar" alt="" />
          <span v-else>{{ (state.session.nickname || 'J')[0].toUpperCase() }}</span>
        </button>
        <Transition name="pop">
          <div v-if="userOpen && isLoggedIn" class="user-pop glass">
            <div class="user-head">
              <strong>{{ state.session.nickname }}</strong>
              <span>{{ state.session.email }}</span>
            </div>
            <button class="pop-item" @click="go('login'); userOpen = false">
              <AppIcon name="User" :size="15" />{{ t('auth.profile') }}
            </button>
            <button v-if="state.session.isAdmin" class="pop-item" @click="go('admin'); userOpen = false">
              <AppIcon name="Shield" :size="15" />{{ t('nav.admin') }}
            </button>
            <button class="pop-item danger" @click="$emit('logout'); userOpen = false">
              <AppIcon name="LogOut" :size="15" />{{ t('auth.logout') }}
            </button>
          </div>
        </Transition>
      </div>

      <button class="icon-btn menu-btn" @click="mobileMenu = !mobileMenu">
        <AppIcon :name="mobileMenu ? 'X' : 'Menu'" :size="18" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  align-items: center;
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-top: none;
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  height: 62px;
  padding: 0 18px;
  position: sticky;
  top: 0;
  z-index: 200;
}

/* —— Logo —— */
.brand {
  align-items: center;
  cursor: pointer;
  display: flex;
  flex-shrink: 0;
  gap: 9px;
  margin-right: 6px;
}

.brand-mark {
  align-items: center;
  background: var(--accent);
  border-radius: 9px;
  color: var(--on-accent);
  display: flex;
  height: 32px;
  justify-content: center;
  transition: transform 0.3s ease;
  width: 32px;
}

.brand:hover .brand-mark {
  transform: rotate(-12deg) scale(1.06);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand-text strong {
  font-size: 14.5px;
  font-weight: 600;
}

.brand-text span {
  color: var(--muted_text_color);
  font-size: 10.5px;
}

/* —— 导航 —— */
.nav {
  display: flex;
  gap: 2px;
}

.nav-item {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  font-size: 13.5px;
  gap: 6px;
  padding: 7px 12px;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.nav-item:hover {
  background-color: var(--item_hover_color);
  color: var(--main_text_color);
}

.nav-item.active {
  background-color: var(--accent-soft);
  color: var(--accent-text);
  font-weight: 500;
}

.spacer {
  flex: 1;
}

/* —— 信息卡片 —— */
.info-card {
  align-items: center;
  border-radius: var(--radius);
  color: var(--main_text_color);
  display: flex;
  flex-shrink: 0;
  gap: 9px;
  padding: 6px 11px;
  transition: background-color 0.2s ease;
}

button.info-card:hover {
  background-color: var(--item_hover_color);
}

.info-card :deep(svg) {
  color: var(--accent-text);
}

.card-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  text-align: left;
}

.card-text strong {
  font-size: 13px;
  font-weight: 600;
}

.card-text span {
  color: var(--muted_text_color);
  font-size: 10.5px;
  white-space: nowrap;
}

.card-text.sub {
  border-left: 1px solid var(--border_color);
  padding-left: 10px;
}

/* —— 「未定位」标记 ——
   定位没拿到时天气落到了内置默认城市，这里必须说清楚，
   否则用户会把默认城市的天气当成本地天气。
   选择器写成 .card-text .geo-tag 是为了盖过上面 .card-text span 的灰色。 */
.info-card.weather.needs-city {
  background-color: rgba(245, 165, 36, 0.1);
}

.card-text .geo-tag {
  align-items: center;
  background-color: rgba(245, 165, 36, 0.2);
  border-radius: 999px;
  color: var(--warning_text);
  display: inline-flex;
  font-size: 9.5px;
  font-style: normal;
  font-weight: 500;
  gap: 2px;
  margin-right: 4px;
  padding: 1px 6px 1px 4px;
}

.card-text .geo-tag :deep(svg) {
  color: inherit;
}

/* —— 搜索入口 —— */
.search-entry {
  align-items: center;
  background-color: var(--input_bg_color);
  border: 1px solid var(--border_color);
  border-radius: var(--radius);
  color: var(--muted_text_color);
  display: flex;
  flex-shrink: 0;
  font-size: 13px;
  gap: 7px;
  padding: 7px 13px;
  transition: border-color 0.2s ease, color 0.2s ease;
}

.search-entry:hover {
  border-color: var(--accent);
  color: var(--main_text_color);
}

/* —— 右侧按钮 —— */
.actions {
  align-items: center;
  display: flex;
  flex-shrink: 0;
  gap: 3px;
  margin-left: 4px;
}

.lang {
  font-size: 12.5px;
  font-weight: 600;
}

.dot {
  border-radius: 50%;
  display: block;
  height: 15px;
  transition: transform 0.2s ease;
  width: 15px;
}

.icon-btn:hover .dot {
  transform: scale(1.15);
}

/* —— 主题色弹层 —— */
.accent-wrap,
.user-wrap {
  position: relative;
}

.accent-pop {
  border-radius: var(--radius);
  box-shadow: 0 14px 34px var(--shadow-hover);
  display: grid;
  gap: 7px;
  grid-template-columns: repeat(5, 1fr);
  padding: 11px;
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  width: 178px;
  z-index: 300;
}

.swatch {
  border: 2px solid transparent;
  border-radius: 7px;
  height: 22px;
  transition: transform 0.18s ease, border-color 0.18s ease;
  width: 22px;
}

.swatch:hover {
  transform: scale(1.12);
}

.swatch.active {
  border-color: var(--main_text_color);
}

/* —— 用户 —— */
.login-btn {
  font-size: 13px;
  margin-left: 4px;
  padding: 7px 14px;
}

.avatar-btn {
  align-items: center;
  background: var(--accent);
  border-radius: 50%;
  color: var(--on-accent);
  display: flex;
  font-size: 13px;
  font-weight: 600;
  height: 30px;
  justify-content: center;
  margin-left: 4px;
  overflow: hidden;
  transition: transform 0.2s ease;
  width: 30px;
}

.avatar-btn:hover {
  transform: scale(1.06);
}

.avatar-btn img {
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.user-pop {
  border-radius: var(--radius);
  box-shadow: 0 14px 34px var(--shadow-hover);
  min-width: 194px;
  overflow: hidden;
  padding: 6px;
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  z-index: 300;
}

.user-head {
  border-bottom: 1px solid var(--border_color);
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 5px;
  padding: 8px 10px 10px;
}

.user-head strong {
  font-size: 13px;
}

.user-head span {
  color: var(--muted_text_color);
  font-size: 11px;
}

.pop-item {
  align-items: center;
  border-radius: var(--radius-sm);
  display: flex;
  font-size: 13px;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
  transition: background-color 0.16s ease;
  width: 100%;
}

.pop-item:hover {
  background-color: var(--item_hover_color);
}

.pop-item.danger:hover {
  background-color: rgba(229, 72, 77, 0.14);
  color: var(--danger);
}

.menu-btn {
  display: none;
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
}

/* —— 响应式 —— */
@media (max-width: 1240px) {
  .hide-lg {
    display: none;
  }
}

@media (max-width: 1000px) {
  .hide-md {
    display: none;
  }
}

@media (max-width: 760px) {
  .topbar {
    gap: 4px;
    height: 56px;
    padding: 0 12px;
  }

  .hide-sm,
  .brand-text span {
    display: none;
  }

  .brand-text strong {
    font-size: 13.5px;
  }

  .nav {
    background-color: var(--item_hover_color);
    border-radius: var(--radius);
    box-shadow: 0 14px 34px var(--shadow-hover);
    display: none;
    flex-direction: column;
    left: 12px;
    padding: 6px;
    position: absolute;
    top: calc(100% + 6px);
    width: 168px;
  }

  .nav.open {
    display: flex;
  }

  .menu-btn {
    display: inline-flex;
  }

  .nav-item {
    justify-content: flex-start;
    width: 100%;
  }
}
</style>
