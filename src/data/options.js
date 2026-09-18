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
  { id: 'compact', nameKey: 'card.compact', hintKey: 'card.compactHint', icon: 'Grid2x2' },
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
  cardStyle: 'default', // default | neumorphic | compact
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
