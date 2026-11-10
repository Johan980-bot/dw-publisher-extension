/**
 * DreamWorks 主站握手桥（dw-bridge）。
 * 协议（与主站 utils/articleStudio/extensionBridge.ts 对应）：
 *   页面 → 扩展: window.postMessage({ source: 'dw-site', type: 'dw-ext-ping' }, origin)
 *   扩展 → 页面: window.postMessage({ source: 'dw-ext', type: 'dw-ext-pong', version, driversVersion, platforms }, origin)
 * content script 与页面共享 window 事件总线；只在主站域名注入（见 manifest matches）。
 *
 * 弹窗取稿（EXTRACT_ARTICLE 中转）：
 *   弹窗 → 本脚本: chrome.tabs.sendMessage({ type: 'EXTRACT_ARTICLE' })
 *   本脚本 → 页面: { source: 'dw-ext', type: 'dw-ext-article-request' }
 *   页面 → 本脚本: { source: 'dw-site', type: 'dw-ext-article', article: { title, markdown, html, summary, cover, platformContents } }
 *   本脚本 → 弹窗: sendResponse({ article })（2 秒无响应返回 null）
 *
 * driver 热更新：被 ping 时顺带拉取主站 /api/v1/extension/drivers（10 分钟本地缓存），
 * 远程 driversVersion 随 pong 上报；覆盖配置写入 chrome.storage.local['dwRemoteDrivers']，
 * 供后续 driver 执行层消费（driver 覆盖执行是后续迭代，当前只打通下发通道）。
 */

/** 当前内置 driver 支持的主站平台编码（与主站 aid_platform_profile.platform 一致）。
 * 头条/小红书/网易号/腾讯云/阿里云 driver 在上游私有仓库，本 fork 暂缺。 */
const DW_SUPPORTED_PLATFORMS = [
  'zhihu',
  'baijiahao',
  'weibo',
  'juejin',
  'csdn',
  'bilibili',
  'sohu',
  'cnblogs',
  '51cto',
  'segmentfault',
  'oschina',
  'douban',
  'eastmoney',
  'imooc',
  'woshipm',
  'xueqiu',
  'yuque'
]

const DW_BUILTIN_DRIVERS_VERSION = '2026.11.08'
const DRIVERS_API = '/api/v1/extension/drivers'
const DRIVERS_CACHE_KEY = 'dwRemoteDrivers'
const DRIVERS_CACHE_TTL = 10 * 60 * 1000

interface DriversCache {
  fetchedAt: number
  version: string
  drivers: Record<string, unknown>
}

function currentVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return 'unknown'
  }
}

/** 读缓存；过期则回源拉取。任何失败都静默降级为内置版本——握手不能因为配置接口抖动而失败 */
async function resolveDriversVersion(): Promise<string> {
  try {
    const stored = (await chrome.storage.local.get(DRIVERS_CACHE_KEY))[DRIVERS_CACHE_KEY] as DriversCache | undefined
    if (stored && Date.now() - stored.fetchedAt < DRIVERS_CACHE_TTL) {
      return stored.version || DW_BUILTIN_DRIVERS_VERSION
    }
    const resp = await fetch(`${window.location.origin}${DRIVERS_API}`, { credentials: 'include' })
    if (!resp.ok) return stored?.version || DW_BUILTIN_DRIVERS_VERSION
    const data = (await resp.json()) as { version?: string; drivers?: Record<string, unknown> }
    const cache: DriversCache = {
      fetchedAt: Date.now(),
      version: typeof data.version === 'string' && data.version ? data.version : DW_BUILTIN_DRIVERS_VERSION,
      drivers: data.drivers && typeof data.drivers === 'object' ? data.drivers : {}
    }
    await chrome.storage.local.set({ [DRIVERS_CACHE_KEY]: cache })
    return cache.version
  } catch {
    return DW_BUILTIN_DRIVERS_VERSION
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return
  const data = event.data
  if (!data || data.source !== 'dw-site') return
  if (data.type === 'dw-ext-ping') {
    void resolveDriversVersion().then((driversVersion) => {
      window.postMessage(
        {
          source: 'dw-ext',
          type: 'dw-ext-pong',
          version: currentVersion(),
          driversVersion,
          platforms: DW_SUPPORTED_PLATFORMS
        },
        window.location.origin
      )
    })
    return
  }
  if (data.type === 'dw-ext-dispatch') {
    void handleDispatch(data)
  }
})

/**
 * 一键分发中转：页面 → background SYNC_ARTICLE → 结果回页面。
 * 入参（主站组装）：
 * { taskId, article: { title, markdown, html, summary, cover }, platforms: string[],
 *   platformContents?: { [platform]: { html, markdown, title?, summary? } } }
 * 进度帧（background 会推给发送方标签页）：SYNC_DETAIL_PROGRESS → dw-ext-dispatch-progress
 */
interface DispatchPayload {
  taskId?: string
  article?: Record<string, unknown>
  platforms?: string[]
  platformContents?: Record<string, { html: string; markdown: string; title?: string; summary?: string }>
  /** 主站登录 token（工作台页面注入），扩展只用它调主站 whoami 鉴权 */
  authToken?: string
}

/** taskId → 是否还在等结果（进度帧只转发未完结的任务） */
const pendingDispatches = new Set<string>()

async function handleDispatch(payload: DispatchPayload): Promise<void> {
  const taskId = typeof payload.taskId === 'string' && payload.taskId ? payload.taskId : `dw_${Date.now()}`
  const reply = (results: unknown[], error?: string) => {
    pendingDispatches.delete(taskId)
    window.postMessage(
      { source: 'dw-ext', type: 'dw-ext-dispatch-result', taskId, results, ...(error ? { error } : {}) },
      window.location.origin
    )
  }

  const article = payload.article
  const platforms = Array.isArray(payload.platforms) ? payload.platforms.filter((p) => typeof p === 'string') : []
  if (!article || typeof article.markdown !== 'string' || platforms.length === 0) {
    reply([], '分发参数不完整（缺少 article.markdown 或 platforms）')
    return
  }

  const syncId = `dw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  pendingDispatches.add(taskId)
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SYNC_ARTICLE',
      payload: {
        article: { ...article, platformContents: payload.platformContents },
        platforms,
        source: 'dw-site',
        syncId,
        authToken: typeof payload.authToken === 'string' ? payload.authToken : '',
        siteOrigin: window.location.origin
      }
    })
    reply(Array.isArray(response?.results) ? response.results : [])
  } catch (e) {
    reply([], e instanceof Error ? e.message : String(e))
  }
}

/** background 推送的进度帧转给页面（syncId 形如 dw_ 开头的才是本站发起的分发） */
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'SYNC_DETAIL_PROGRESS' || typeof message?.syncId !== 'string') return
  if (!message.syncId.startsWith('dw_')) return
  const progress = message.payload
  window.postMessage(
    { source: 'dw-ext', type: 'dw-ext-dispatch-progress', progress },
    window.location.origin
  )
})

/**
 * 弹窗取稿中转：弹窗 EXTRACT_ARTICLE → 页面 dw-ext-article-request → 页面回 dw-ext-article。
 * 工作台页面返回母版 + 全部平台版本（platformContents），扩展按平台版本分发；
 * 页面 2 秒未响应（非工作台页或旧版页面）则返回空，弹窗提示未检测到文章。
 * 注意：extractor.ts 在主站域名上已让出 EXTRACT_ARTICLE，避免两个 content script 抢答。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_ARTICLE') return false
  const timer = window.setTimeout(() => {
    window.removeEventListener('message', onPageMessage)
    sendResponse({ article: null })
  }, 2000)
  function onPageMessage(event: MessageEvent) {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.source !== 'dw-site' || data.type !== 'dw-ext-article') return
    window.clearTimeout(timer)
    window.removeEventListener('message', onPageMessage)
    sendResponse({ article: data.article ?? null })
  }
  window.addEventListener('message', onPageMessage)
  window.postMessage({ source: 'dw-ext', type: 'dw-ext-article-request' }, window.location.origin)
  return true
})
