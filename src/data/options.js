/* =========================================================================
   设置项枚举
   -------------------------------------------------------------------------
   文案与选项对齐参考站 dh.huhage.fun 的设置面板。
   label / hint 走 i18n（见 src/data/i18n.js），这里只放结构与默认值。
   ========================================================================= */

/** 布局模式。一级分类超过 10 个时仅支持 drawer / minimal（与参考站一致）。 */
export const layoutModes = [
  { id: 'grid', nameKey: 'layout.grid', hintKey: 'layout.gridHint', icon: 'LayoutGrid' },
  { id: 'drawer', nameKey: 'layout.drawer', hintKey: 'layout.drawerHint', icon: 'PanelLeft' },
  { id: 'minimal', nameKey: 'layout.minimal', hintKey: 'layout.minimalHint', icon: 'List' },
]

/** 卡片风格。 */
export const cardStyles = [
  { id: 'default', nameKey: 'card.default', hintKey: 'card.defaultHint', icon: 'Square' },
  { id: 'neumorphic', nameKey: 'card.neumorphic', hintKey: 'card.neumorphicHint', icon: 'Layers' },
  { id: 'mac', nameKey: 'card.mac', hintKey: 'card.macHint', icon: 'Grid2x2' },
]

/**
 * 书签排列密度。
 * 与卡片风格是**两套独立设置**（参考站里分别是「卡片风格」和「书签排列」）：
 * 前者决定卡片长什么样，后者决定卡片里放多少信息。
 */
export const densityModes = [
  { id: 'normal', nameKey: 'density.normal', hintKey: 'density.normalHint', icon: 'Rows3' },
  { id: 'compact', nameKey: 'density.compact', hintKey: 'density.compactHint', icon: 'Rows2' },
  { id: 'icon', nameKey: 'density.icon', hintKey: 'density.iconHint', icon: 'Square' },
]

/** 主题模式。 */
export const themeModes = [
  { id: 'Light', nameKey: 'theme.light', icon: 'Sun' },
  { id: 'Dark', nameKey: 'theme.dark', icon: 'Moon' },
  { id: 'system', nameKey: 'theme.system', icon: 'MonitorSmartphone' },
]

/** 书签展示范围。 */
export const displayScopes = [
  { id: 'default', nameKey: 'scope.default', hintKey: 'scope.defaultHint' },
  { id: 'full', nameKey: 'scope.full', hintKey: 'scope.fullHint' },
]

/** 每行书签数量可选项。 */
export const perRowOptions = [3, 4, 5, 6, 7, 8]

/** 图标底色方案 / 渐变的默认值。 */
export const iconColorDefaults = {
  scheme: 'slate-mist',
  gradient: 'vivid',
}

/** 默认设置。localStorage 里缺字段时用这些补。 */
export const defaultSettings = {
  themeMode: 'system', // Light | Dark | system
  accent: 'teal',
  layout: 'grid', // grid | drawer | minimal
  cardStyle: 'default', // default | neumorphic | mac
  density: 'normal', // normal | compact | icon
  perRow: 5,
  displayScope: 'default', // default | full
  showFavoritesUnderSearch: true,
  showBookmarkTooltip: true,
  editMode: false,
  searchEngine: 'baidu',
  language: 'zh', // zh | en
  iconScheme: 'slate-mist',
  iconGradient: 'vivid',
  weatherAnimation: true,
  weatherCity: '北京',
  /** 是否允许用浏览器定位自动判断城市。关掉后只用手填的 weatherCity。 */
  useGeolocation: true,
}

/** 主题色 / 布局等存 localStorage 的键名前缀，与参考站保持同样的可读性。 */
export const STORAGE_PREFIX = 'jt'

export const storageKeys = {
  settings: `${STORAGE_PREFIX}:settings`,
  categories: `${STORAGE_PREFIX}:categories`,
  bookmarks: `${STORAGE_PREFIX}:bookmarks`,
  sites: `${STORAGE_PREFIX}:sites`,
  favorites: `${STORAGE_PREFIX}:favorites`,
  submissions: `${STORAGE_PREFIX}:submissions`,
  feedback: `${STORAGE_PREFIX}:feedback`,
  notes: `${STORAGE_PREFIX}:notes`,
  users: `${STORAGE_PREFIX}:users`,
  session: `${STORAGE_PREFIX}:session`,
  share: `${STORAGE_PREFIX}:share`,
  visits: `${STORAGE_PREFIX}:visits`,
}
