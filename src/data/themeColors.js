/* =========================================================================
   主题色 / 图标底色 / 图标渐变
   -------------------------------------------------------------------------
   数值取自参考站 dh.huhage.fun 的前端 bundle，保持 1:1。
   主题色的 HSL 三件套同时写在 src/styles/root.css 里（用属性选择器），
   这里只用于「设置面板里画色块」和「导出设置」。
   ========================================================================= */

/** 10 套主题色。hsl 是浅色下的分量，hslDark 是深色下的。 */
export const accentColors = [
  { id: 'teal', nameKey: 'theme.color.teal', hex: '#2a9d8f', hue: '174 60% 42%', hueDark: '174 60% 48%' },
  { id: 'blue', nameKey: 'theme.color.blue', hex: '#3b82f6', hue: '221 83% 53%', hueDark: '221 83% 58%' },
  { id: 'rose', nameKey: 'theme.color.rose', hex: '#e63462', hue: '346 77% 50%', hueDark: '346 77% 55%' },
  { id: 'amber', nameKey: 'theme.color.amber', hex: '#f59e0b', hue: '38 92% 50%', hueDark: '38 92% 55%' },
  { id: 'violet', nameKey: 'theme.color.violet', hex: '#8b5cf6', hue: '262 83% 58%', hueDark: '262 83% 63%' },
  { id: 'emerald', nameKey: 'theme.color.emerald', hex: '#10b981', hue: '160 84% 39%', hueDark: '160 84% 44%' },
  { id: 'slate', nameKey: 'theme.color.slate', hex: '#64748b', hue: '215 16% 47%', hueDark: '215 16% 55%' },
  { id: 'coral', nameKey: 'theme.color.coral', hex: '#f97316', hue: '25 95% 53%', hueDark: '25 95% 58%' },
  { id: 'pink', nameKey: 'theme.color.pink', hex: '#ec4899', hue: '330 81% 60%', hueDark: '330 81% 65%' },
  { id: 'cyan', nameKey: 'theme.color.cyan', hex: '#06b6d4', hue: '189 94% 43%', hueDark: '189 94% 48%' },
]

/**
 * 12 套图标底色方案。
 * 当书签没有自己的图标（或图标加载失败）时，用「首字母 + 这套底色」兜底。
 * 色值是 HSL 分量，用 hsl(...) 拼出来即可。
 */
export const iconSchemes = [
  { id: 'slate-mist', name: 'Slate Mist', background: '220 14% 95%', border: '220 10% 84%' },
  { id: 'graphite-cloud', name: 'Graphite Cloud', background: '220 9% 89%', border: '220 8% 76%' },
  { id: 'porcelain', name: 'Porcelain', background: '210 33% 98%', border: '210 14% 87%' },
  { id: 'stone-fog', name: 'Stone Fog', background: '32 11% 94%', border: '32 8% 83%' },
  { id: 'sandstone', name: 'Sandstone', background: '38 28% 93%', border: '38 16% 82%' },
  { id: 'peach-cream', name: 'Peach Cream', background: '22 38% 93%', border: '22 22% 82%' },
  { id: 'rose-cloud', name: 'Rose Cloud', background: '345 28% 94%', border: '345 16% 84%' },
  { id: 'lavender-dust', name: 'Lavender Dust', background: '266 28% 94%', border: '266 16% 84%' },
  { id: 'arctic-ice', name: 'Arctic Ice', background: '195 30% 94%', border: '195 16% 84%' },
  { id: 'mint-breeze', name: 'Mint Breeze', background: '156 24% 94%', border: '156 13% 84%' },
  { id: 'olive-smoke', name: 'Olive Smoke', background: '96 9% 94%', border: '96 7% 83%' },
  { id: 'teal-foam', name: 'Teal Foam', background: '176 23% 93%', border: '176 13% 83%' },
]

/**
 * 6 套图标渐变色板。
 * 兜底图标按名字哈希稳定取一组，同一个站点每次渲染颜色一致。
 */
export const gradientPresets = [
  {
    id: 'vivid',
    nameKey: 'theme.gradient.vivid',
    colors: [
      ['#56b6a5', '#3d9e8b'],
      ['#7b9fce', '#6889b8'],
      ['#d4a07a', '#c08e68'],
      ['#a78dc6', '#9278b0'],
      ['#e8917a', '#d47e68'],
    ],
  },
  {
    id: 'ocean',
    nameKey: 'theme.gradient.ocean',
    colors: [
      ['#4a90d9', '#3672b5'],
      ['#5bb8c4', '#449da8'],
      ['#7c8ec8', '#6474ad'],
      ['#45b5a5', '#339a8b'],
      ['#6ea8d6', '#5690bc'],
    ],
  },
  {
    id: 'sunset',
    nameKey: 'theme.gradient.sunset',
    colors: [
      ['#e8836a', '#d46e56'],
      ['#f0a868', '#dba05e'],
      ['#e67e9a', '#d06a86'],
      ['#c98a6e', '#b5785e'],
      ['#d4756e', '#c0625c'],
    ],
  },
  {
    id: 'candy',
    nameKey: 'theme.gradient.candy',
    colors: [
      ['#f472b6', '#e44d95'],
      ['#fb923c', '#e87d2a'],
      ['#a78bfa', '#8b6cf6'],
      ['#34d399', '#22b883'],
      ['#f87171', '#e54d4d'],
    ],
  },
  {
    id: 'lavender',
    nameKey: 'theme.gradient.lavender',
    colors: [
      ['#9b8ec4', '#8678ae'],
      ['#b08db8', '#9a78a2'],
      ['#8a9cc8', '#7486b2'],
      ['#c48eaa', '#ae7a96'],
      ['#a490c8', '#8e7ab2'],
    ],
  },
  {
    id: 'rainbow',
    nameKey: 'theme.gradient.rainbow',
    colors: [
      ['#f56565', '#e53e3e'],
      ['#ed8936', '#dd6b20'],
      ['#48bb78', '#38a169'],
      ['#4299e1', '#3182ce'],
      ['#9f7aea', '#805ad5'],
    ],
  },
]

/** 稳定的字符串哈希，用来给兜底图标挑颜色。 */
function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return h
}

/**
 * 取兜底图标的渐变色。
 * @param {string} key 用于哈希的字符串，通常传站点 url
 * @param {string} presetId 渐变方案 id，默认明快
 */
export function gradientFor(key, presetId = 'vivid') {
  const preset = gradientPresets.find((p) => p.id === presetId) || gradientPresets[0]
  const pair = preset.colors[hash(key) % preset.colors.length]
  return { from: pair[0], to: pair[1] }
}

/** 取兜底图标的底色。 */
export function schemeFor(key, schemeId = 'slate-mist') {
  const s = iconSchemes.find((x) => x.id === schemeId) || iconSchemes[0]
  return `hsl(${s.background})`
}
