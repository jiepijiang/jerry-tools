/* =========================================================================
   时钟 / 农历 / 天气
   -------------------------------------------------------------------------
   天气走 Open-Meteo（免费、无需 key）：
     按城市名  https://geocoding-api.open-meteo.com/v1/search  → 坐标
     按坐标    https://api.open-meteo.com/v1/forecast
   结果缓存 30 分钟，失败时回落到缓存值。

   定位（与参考站 dh.huhage.fun 一致的三级优先）：
     1. 用户手选过城市          → 直接用，不再弹定位
     2. 有上次定位的坐标缓存    → 先渲染，同时再请求一次定位刷新
     3. 请求浏览器定位          → 被拒 / 超时且无缓存时回落 settings.weatherCity
   坐标 → 城市名：BigDataCloud 优先，Nominatim 兜底，都挂了就给经纬度字符串。

   —— 关于「回落城市」——
   回落到的 settings.weatherCity 是个内置默认值（北京），它**不代表用户所在地**。
   以前这里静默回落，页面就理直气壮地显示「北京 21°~29°」，用户会当成本地天气。
   现在用 weather.source 把来源记下来（location / manual / default），
   default 时 UI 必须显式标出「未定位」，并给一条直达设置的入口。
   另外先查 navigator.permissions：已经明确被拒过就不再空跑一次 getCurrentPosition
   （那次请求注定立刻失败，只会刷一屏 console 报错）。
   ========================================================================= */

import { computed, onUnmounted, reactive, ref } from 'vue'
import { lunarFullString, lunarLabel } from '@/utils/lunar'
import { pickCityName, pickNominatimCity } from '@/utils/geo'
import { translate } from '@/composables/useI18n'
import { setSettings, settings } from '@/composables/useSettings'
import { defaultSettings } from '@/data/options'

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

export const timeText = computed(() => {
  const d = now.value
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

/**
 * 日期文案。
 *
 * ⚠️ 走**格式串**（`date.format`）而不是在代码里拼 —— 中英语序不同：
 *    中文 `{m}月{d}日 {w}` → 「10月2日 周五」
 *    英文 `{w} {m}/{d}`    → 「Fri 10/2」
 *    硬拼的话英文界面会变成「Fri 10月2日」。
 *
 * 这是个 `computed`，`translate()` 里读了 `settings.language`，
 * 所以**切语言会自己重算**（不用手动刷新）。
 */
export const dateText = computed(() => {
  const d = now.value
  return translate('date.format', {
    m: d.getMonth() + 1,
    d: d.getDate(),
    w: translate(`date.wd.${d.getDay()}`),
  })
})

export const lunarText = computed(() => lunarFullString(now.value))

/** 今天是不是节日 / 节气，是的话给个角标。 */
export const todayBadge = computed(() => lunarLabel(now.value))

/* ------------------------------------------------------------------ 天气 */

/**
 * WMO 天气代码的**封闭集合**。
 *
 * ⚠️ 必须和 `i18n.js` 里的 `weather.wmo.*` 一一对应 —— 少一个 key，
 *    界面就会显示 `weather.wmo.65` 这种字面量。
 *    2026-10-02 之前这里直接存中文，英文界面下顶栏会显示「大部晴朗」。
 */
const WMO_CODES = new Set([
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57,
  61, 63, 65, 66, 67, 71, 73, 75, 77,
  80, 81, 82, 85, 86, 95, 96, 99,
])

/** 天气代码 → 当前语言的描述。 */
const wmoText = (code) =>
  translate(WMO_CODES.has(code) ? `weather.wmo.${code}` : 'weather.wmo.unknown')

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
const CACHE_KEY = 'jt:weather-cache' // 按城市名缓存天气
const COORDS_KEY = 'jt:weather-coords' // { name, lat, lon } —— 上次定位到的位置
const MANUAL_KEY = 'jt:weather-city-manual' // 'true' = 用户手选过城市，不再自动定位
const GEO_NAME_PREFIX = 'jt:geo-name:' // 坐标 → 城市名 的反查缓存

export const weather = reactive({
  loading: false,
  failed: false,
  temp: null,
  code: 0,
  group: 'sun',
  city: '',
  high: null,
  low: null,
  humidity: null,
  wind: null,
  updatedAt: 0,
  /**
   * 这份天气是哪来的：
   *   'location' —— 浏览器定位
   *   'manual'   —— 用户手填 / 手选的城市
   *   'default'  —— 谁都没给，落到了内置默认城市（不代表用户所在地，UI 要标出来）
   */
  source: '',
})

/**
 * 天气描述文案（跟着语言走）。
 *
 * ⚠️ 必须是 `computed` —— 以前是在 `apply()` 里把中文字符串写进 `weather.text`，
 *    那样**切语言不会更新**，用户得刷新页面才看到英文。
 *    这里没做成 `weather` 上的字段，是因为 `reactive()` 里塞 computed 不会自动解包。
 *
 * ⚠️ `failed` 这一支不能漏：以前是 `failWeather()` 往 `weather.text` 里塞
 *    「无法获取天气」。把 `text` 字段删掉之后如果这里不接住，
 *    失败状态会一直显示「获取天气中」—— **看起来像还在加载，其实是失败了**。
 */
export const weatherText = computed(() => {
  if (weather.failed) return translate('weather.fail')
  return weather.updatedAt ? wmoText(weather.code) : ''
})

/**
 * 定位状态，给 UI 用。
 * error 存的是 i18n key（不是文案），渲染时再 t() 一次，切换语言能跟着变。
 */
export const geo = reactive({
  supported: typeof navigator !== 'undefined' && 'geolocation' in navigator,
  locating: false,
  error: '',
  /** 当前这份天气是不是来自定位（false = 来自手填城市） */
  fromLocation: false,
})

/* ------------------------------------------------------- 定位相关的小工具 */

function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
}

/** 用户是否手选过城市。手选过就不再自动定位。 */
export function hasManualCity() {
  try {
    return localStorage.getItem(MANUAL_KEY) === 'true'
  } catch {
    return false
  }
}

function setManualCity(flag) {
  try {
    if (flag) localStorage.setItem(MANUAL_KEY, 'true')
    else localStorage.removeItem(MANUAL_KEY)
  } catch {
    /* ignore */
  }
}

/** 上次定位到的坐标。 */
function readCoords() {
  const c = readJSON(COORDS_KEY)
  return c && typeof c.lat === 'number' && typeof c.lon === 'number' ? c : null
}

/**
 * 坐标 → 城市名。
 * BigDataCloud 快且免费，Nominatim 更权威但有限流，两个都挂就给经纬度字符串。
 */
async function reverseGeocode(lat, lon) {
  const lang = settings.language === 'en' ? 'en' : 'zh-CN'
  const cacheKey = `${GEO_NAME_PREFIX}${lang}:${lat.toFixed(4)}:${lon.toFixed(4)}`

  const hit = (() => {
    try {
      return localStorage.getItem(cacheKey)
    } catch {
      return null
    }
  })()
  if (hit) return hit

  const save = (name) => {
    try {
      localStorage.setItem(cacheKey, name)
    } catch {
      /* ignore */
    }
    return name
  }

  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=${lang}`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (res.ok) {
      const name = pickCityName(await res.json())
      if (name) return save(name)
    }
  } catch (e) {
    console.warn('[geo] BigDataCloud 反查失败：', e)
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=${lang}`,
      {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'JerryNavigator/1.0' },
      },
    )
    if (res.ok) {
      const name = pickNominatimCity(await res.json())
      if (name) return save(name)
    }
  } catch (e) {
    console.warn('[geo] Nominatim 反查失败：', e)
  }

  return save(`${lat.toFixed(2)}°, ${lon.toFixed(2)}°`)
}

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

function apply(data, source) {
  weather.temp = Math.round(data.temp)
  weather.code = data.code
  weather.group = weatherGroup(data.code)
  weather.high = Math.round(data.high)
  weather.low = Math.round(data.low)
  weather.humidity = data.humidity
  weather.wind = data.wind
  weather.city = data.city
  weather.updatedAt = data.updatedAt
  weather.failed = false
  if (source) weather.source = source
}

/** 从 Open-Meteo 的响应里挑出我们要的字段。 */
function toPayload(data, city, lat, lon) {
  return {
    city,
    temp: data.current.temperature_2m,
    code: data.current.weather_code,
    humidity: data.current.relative_humidity_2m,
    wind: Math.round(data.current.wind_speed_10m),
    high: data.daily.temperature_2m_max[0],
    low: data.daily.temperature_2m_min[0],
    lat: lat ?? null,
    lon: lon ?? null,
    updatedAt: Date.now(),
  }
}

const FORECAST_QUERY =
  '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m' +
  '&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1'

function failWeather(e) {
  console.warn('[weather] 获取失败：', e)
  weather.failed = true
  // 文案由 `weatherText` 那个 computed 出（读 `weather.failed`），
  // 这里**不要**再往 weather 上写字符串 —— 那样切语言不会更新。
  return false
}

/**
 * 按城市名拉天气。手填城市走这条。
 * @param {string} city 城市名，中文
 * @param {'manual'|'default'} [source] 这次结果算「手填」还是「内置默认」
 */
export async function fetchWeather(city = settings.weatherCity, source = 'manual') {
  const name = String(city || defaultSettings.weatherCity).trim()
  const cached = readCache(name)
  if (cached) {
    apply(cached, source)
    return true
  }

  weather.loading = true
  weather.failed = false
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`,
    )
    const geoData = await geoRes.json()
    const hit = geoData?.results?.[0]
    if (!hit) throw new Error('city not found')

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}${FORECAST_QUERY}`,
    )
    const data = await res.json()

    const payload = toPayload(data, name, hit.latitude, hit.longitude)
    writeCache(name, payload)
    apply(payload, source)
    return true
  } catch (e) {
    return failWeather(e)
  } finally {
    weather.loading = false
  }
}

/**
 * 按坐标拉天气。定位走这条。
 * @param {number} lat
 * @param {number} lon
 * @param {string} [name] 已知城市名就传，省一次反查
 */
export async function fetchWeatherByCoords(lat, lon, name) {
  weather.loading = true
  weather.failed = false
  try {
    const cityName = name || (await reverseGeocode(lat, lon))

    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}${FORECAST_QUERY}`,
    )
    const data = await res.json()

    const payload = toPayload(data, cityName, lat, lon)
    writeCache(cityName, payload)
    writeJSON(COORDS_KEY, { name: cityName, lat, lon })
    apply(payload, 'location')
    return true
  } catch (e) {
    return failWeather(e)
  } finally {
    weather.loading = false
  }
}

/**
 * 请求浏览器定位并按结果取天气。
 * 失败时把 error.code 映射成 i18n key 存到 geo.error，由 UI 决定怎么展示。
 */
export function locateWeather() {
  return new Promise((resolve) => {
    if (!geo.supported) {
      geo.error = 'weather.geoUnsupported'
      resolve(false)
      return
    }

    geo.locating = true
    geo.error = ''

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geo.fromLocation = true
        geo.locating = false
        resolve(fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude))
      },
      (err) => {
        geo.locating = false
        geo.fromLocation = false
        if (err.code === err.PERMISSION_DENIED) geo.error = 'weather.geoDenied'
        else if (err.code === err.POSITION_UNAVAILABLE) geo.error = 'weather.geoUnavailable'
        else if (err.code === err.TIMEOUT) geo.error = 'weather.geoTimeout'
        else geo.error = 'weather.geoFail'
        resolve(false)
      },
      // 与参考站一致：10s 超时、不要求高精度、5 分钟内复用上次定位
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 5 * 60 * 1000 },
    )
  })
}

/**
 * 先问一下浏览器这个站点的定位权限处于什么状态。
 *   'granted' —— 已经授权过，请求不会再弹窗
 *   'prompt'  —— 还没决定，请求会弹窗
 *   'denied'  —— 已被拒绝，再请求也是立刻失败，不如直接走回落
 *   'unknown' —— 浏览器不支持 Permissions API（老 Safari），当作 prompt 处理
 * @returns {Promise<'granted'|'prompt'|'denied'|'unknown'>}
 */
async function geolocationPermission() {
  try {
    if (!navigator.permissions?.query) return 'unknown'
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch {
    return 'unknown'
  }
}

/**
 * 应用启动时调一次。三级优先：
 *   1. 用户手选过城市          → 直接用，不弹定位
 *   2. 有定位缓存              → 先渲染缓存，同时再请求一次定位刷新
 *   3. 请求定位                → 失败且无缓存时回落 settings.weatherCity
 * 回落时把 weather.source 标成 'default'，让 UI 能说明「这不是你的位置」。
 * @returns {Promise<boolean>} 最终有没有拿到天气
 */
export async function initWeather() {
  const cached = readCoords()

  // 1. 手选城市优先，完全不碰定位
  if (hasManualCity()) {
    geo.fromLocation = false
    return fetchWeather(settings.weatherCity, 'manual')
  }

  // 2. 有定位缓存：先出结果，别让用户盯着「获取天气中」
  if (cached) {
    geo.fromLocation = true
    fetchWeatherByCoords(cached.lat, cached.lon, cached.name)
  }

  // 用户关掉了自动定位 / 浏览器不支持 → 停在缓存或手填城市上
  if (!settings.useGeolocation || !geo.supported) {
    if (!cached) return fetchWeather(settings.weatherCity, 'default')
    return true
  }

  // 3. 权限已被明确拒绝过就别再发请求了：那次调用注定立刻失败，
  //    只会往 console 里刷一条报错，状态并不会变好。
  if ((await geolocationPermission()) === 'denied') {
    geo.error = 'weather.geoDenied'
    if (!cached) return fetchWeather(settings.weatherCity, 'default')
    return false
  }

  // 4. 真正去要定位授权
  const ok = await locateWeather()
  if (!ok && !cached) return fetchWeather(settings.weatherCity, 'default')
  return ok
}

/**
 * 手动换城市。会打上「手选过」的标记，并把设置切到「手动指定」，
 * 之后不再自动定位 —— 否则会出现「滑块显示自动定位、实际却在用手填城市」的错位。
 */
export async function setWeatherCity(city) {
  const name = String(city || '').trim()
  if (!name) return false
  setManualCity(true)
  geo.fromLocation = false
  geo.error = ''
  await setSettings({ weatherCity: name, useGeolocation: false })
  return fetchWeather(name)
}

/** 设置面板里点「使用我的位置」：清掉手选标记，重新定位。 */
export async function useMyLocation() {
  setManualCity(false)
  return locateWeather()
}

/** 清掉反查缓存 + 天气缓存后重取，对应参考站的「刷新定位」。 */
export async function refreshWeather() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(GEO_NAME_PREFIX))
      .forEach((k) => localStorage.removeItem(k))
    localStorage.removeItem(CACHE_KEY)
  } catch {
    /* ignore */
  }
  if (hasManualCity()) return fetchWeather(settings.weatherCity, 'manual')
  if (!settings.useGeolocation) return fetchWeather(settings.weatherCity, 'default')
  const ok = await locateWeather()
  // 定位没成，但页面上还什么都没有 → 别停在「获取天气中」，先给个默认城市
  if (!ok && weather.temp == null) return fetchWeather(settings.weatherCity, 'default')
  return ok
}

/** 组件里用这个，自动起停时钟。 */
export function useClock() {
  startClock()
  onUnmounted(() => {
    /* 时钟是全局单例，页面切换不一定要停；这里留空以免误停 */
  })
  return { now, timeText, dateText, lunarText, todayBadge, weather, geo }
}
