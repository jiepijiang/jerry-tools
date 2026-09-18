/* =========================================================================
   时钟 / 农历 / 天气
   -------------------------------------------------------------------------
   天气走 Open-Meteo（免费、无需 key）：
     地理编码  https://geocoding-api.open-meteo.com/v1/search
     实况预报  https://api.open-meteo.com/v1/forecast
   结果缓存 30 分钟，失败时回落到缓存值。
   ========================================================================= */

import { computed, onUnmounted, reactive, ref } from 'vue'
import { lunarFullString, lunarLabel } from '@/utils/lunar'
import { settings } from '@/composables/useSettings'

/* ------------------------------------------------------------------ 时钟 */

export const now = ref(new Date())

let timer = null

/** 启动每秒走一次的时钟。组件里 onMounted 调一次即可。 */
export function startClock() {
  if (timer) return
  now.value = new Date()
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
}

export function stopClock() {
  if (timer) clearInterval(timer)
  timer = null
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const timeText = computed(() => {
  const d = now.value
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

export const dateText = computed(() => {
  const d = now.value
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
})

export const lunarText = computed(() => lunarFullString(now.value))

/** 今天是不是节日 / 节气，是的话给个角标。 */
export const todayBadge = computed(() => lunarLabel(now.value))

/* ------------------------------------------------------------------ 天气 */

/** WMO 天气代码 → 中文描述。 */
const WMO = {
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '密集毛毛雨',
  56: '冻毛毛雨',
  57: '密集冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '小冻雨',
  67: '大冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '大阵雪',
  95: '雷暴',
  96: '雷暴伴冰雹',
  99: '强雷暴伴冰雹',
}

/** 天气代码 → 动效分组（给 WeatherIcon 用）。 */
export function weatherGroup(code) {
  if (code === 0 || code === 1) return 'sun'
  if (code === 2) return 'cloud-sun'
  if (code === 3 || code === 45 || code === 48) return 'cloud'
  if (code >= 51 && code <= 67) return 'rain'
  if (code >= 71 && code <= 77) return 'snow'
  if (code >= 80 && code <= 82) return 'rain'
  if (code >= 85 && code <= 86) return 'snow'
  if (code >= 95) return 'storm'
  return 'cloud'
}

const WEATHER_TTL = 30 * 60 * 1000
const CACHE_KEY = 'jt:weather-cache'

export const weather = reactive({
  loading: false,
  failed: false,
  temp: null,
  code: 0,
  text: '',
  group: 'sun',
  city: '',
  high: null,
  low: null,
  humidity: null,
  wind: null,
  updatedAt: 0,
})

function readCache(city) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    const hit = raw[city]
    if (hit && Date.now() - hit.updatedAt < WEATHER_TTL) return hit
  } catch {
    /* ignore */
  }
  return null
}

function writeCache(city, data) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    raw[city] = data
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw))
  } catch {
    /* ignore */
  }
}

function apply(data) {
  weather.temp = Math.round(data.temp)
  weather.code = data.code
  weather.text = WMO[data.code] || '未知'
  weather.group = weatherGroup(data.code)
  weather.high = Math.round(data.high)
  weather.low = Math.round(data.low)
  weather.humidity = data.humidity
  weather.wind = data.wind
  weather.city = data.city
  weather.updatedAt = data.updatedAt
  weather.failed = false
}

/**
 * 拉取天气。
 * @param {string} city 城市名，中文
 */
export async function fetchWeather(city = settings.weatherCity) {
  const name = String(city || '北京').trim()
  const cached = readCache(name)
  if (cached) {
    apply(cached)
    return true
  }

  weather.loading = true
  weather.failed = false
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`,
    )
    const geo = await geoRes.json()
    const hit = geo?.results?.[0]
    if (!hit) throw new Error('city not found')

    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'
    const res = await fetch(url)
    const data = await res.json()

    const payload = {
      city: name,
      temp: data.current.temperature_2m,
      code: data.current.weather_code,
      humidity: data.current.relative_humidity_2m,
      wind: Math.round(data.current.wind_speed_10m),
      high: data.daily.temperature_2m_max[0],
      low: data.daily.temperature_2m_min[0],
      updatedAt: Date.now(),
    }
    writeCache(name, payload)
    apply(payload)
    return true
  } catch (e) {
    console.warn('[weather] 获取失败：', e)
    weather.failed = true
    weather.text = '无法获取天气'
    return false
  } finally {
    weather.loading = false
  }
}

/** 换城市。 */
export async function setWeatherCity(city) {
  const name = String(city || '').trim()
  if (!name) return false
  settings.weatherCity = name
  return fetchWeather(name)
}

/** 组件里用这个，自动起停时钟。 */
export function useClock() {
  startClock()
  onUnmounted(() => {
    /* 时钟是全局单例，页面切换不一定要停；这里留空以免误停 */
  })
  return { now, timeText, dateText, lunarText, todayBadge, weather }
}
