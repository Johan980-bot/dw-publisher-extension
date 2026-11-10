/**
 * 头条号适配器
 * https://mp.toutiao.com
 * 协议字段参考现行创作者中心（2026）：save=0 存草稿 / save=1 发布；图片走 /spice/image
 */
import { CodeAdapter, ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Toutiao')

const AID = '1231'
const UPLOAD_SOURCE = '20020003'

/** 头条协议错误码 → 可读提示（来自现行创作者中心约定） */
const CODE_MESSAGES: Record<number, string> = {
  2222: '头条要求可信浏览器校验，请在头条号后台手动发一次文后再试',
  3001: '头条要求文本验证码，请在头条号后台手动操作一次后再试',
  3002: '头条要求滑块验证码，请在头条号后台手动操作一次后再试',
  3022: '该头条号尚未完成创作者注册/账号信息未完善，请先在头条号后台完善后再分发',
}

export class ToutiaoAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: 'toutiao',
    name: '头条号',
    icon: 'https://sf1-ttcdn-tos.pstatp.com/obj/ttfe/pgcfe/sz/mp_logo.png',
    homepage: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  /** 预处理配置: 头条号编辑器使用 HTML 格式 */
  readonly preprocessConfig = {
    outputFormat: 'html' as const,
  }

  private userId: string | null = null

  /** 头条号 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://mp.toutiao.com/*',
      headers: {
        Origin: 'https://mp.toutiao.com',
        Referer: 'https://mp.toutiao.com/profile_v4/graphic/publish',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  /** 从 cookie 取 CSRF token 放进请求头（头条协议要求） */
  private async csrfHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    const pairs: [string, string][] = [
      ['passport_csrf_token', 'x-tt-passport-csrf-token'],
      ['tt_csrf_token', 'x-tt-csrf-token'],
    ]
    for (const [cookieName, headerName] of pairs) {
      try {
        const value = this.runtime.getCookie
          ? await this.runtime.getCookie('.toutiao.com', cookieName)
          : (await this.runtime.cookies.get('.toutiao.com')).find(c => c.name === cookieName)?.value
        if (value) headers[headerName] = value
      } catch {
        // 取不到就让请求自己去试，平台会回明确错误码
      }
    }
    return headers
  }

  private async parseJson(res: Response, what: string): Promise<any> {
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${what}：接口返回非 JSON（${text.slice(0, 120)}）`)
    }
  }

  private raiseIfProtocolError(payload: any, what: string): void {
    const code = Number(payload?.code ?? 0)
    if (!code) return
    const msg = payload?.reason || payload?.message || `协议错误 ${code}`
    throw new Error(CODE_MESSAGES[code] ? `${CODE_MESSAGES[code]}（${msg}）` : `${what}：${msg}`)
  }

  /**
   * 检查登录状态
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        'https://mp.toutiao.com/mp/agw/media/user_login_status_api',
        { credentials: 'include' }
      )
      const data = await this.parseJson(response, '登录检查')
      if (!data?.data?.is_login) {
        return { isAuthenticated: false, error: '未登录' }
      }

      // 登录有效，再取账号资料
      const infoResp = await this.runtime.fetch(
        'https://mp.toutiao.com/mp/agw/media/get_media_info',
        { credentials: 'include' }
      )
      const info = await this.parseJson(infoResp, '账号资料')
      const user = info?.data?.user
      this.userId = String(user?.id || data.data.user_id || '')

      return {
        isAuthenticated: true,
        userId: this.userId,
        username: user?.screen_name || this.userId,
        avatar: user?.https_avatar_url,
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /** 上传结果（头条协议字段） */
  private async uploadToutiaoImage(
    url: string,
    forCover = false
  ): Promise<{ url: string; uri: string; width: number; height: number; mime: string }> {
    const imageResponse = await this.runtime.fetch(url)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + url)
    }
    const blob = await imageResponse.blob()
    const filename = this.getFilenameFromUrl(url) || 'image.jpg'

    const params = new URLSearchParams({
      // 正文图 20020002，封面 20020003（不一样，混用会被判 uri 非法）
      upload_source: forCover ? UPLOAD_SOURCE : '20020002',
      aid: AID,
      device_platform: 'web',
    })
    if (forCover) params.set('need_cover_url', '1')

    const formData = new FormData()
    formData.append('image', blob, filename)

    const response = await this.runtime.fetch(
      `https://mp.toutiao.com/spice/image?${params.toString()}`,
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = await this.parseJson(response, '图片上传')
    this.raiseIfProtocolError(res, '图片上传失败')
    const data = res?.data || {}
    const imageUrl = data.image_url || data.origin_image_url || data.url
    const imageUri = data.image_uri || data.origin_image_uri || ''
    if (!imageUrl || !imageUri) {
      throw new Error('图片上传失败：响应缺少 image_url/image_uri')
    }

    return {
      url: imageUrl,
      uri: imageUri,
      width: Number(data.image_width) || 0,
      height: Number(data.image_height) || 0,
      mime: data.image_mime_type || 'image/jpeg',
    }
  }

  /**
   * 上传正文图片。头条要求正文 img 带 web_uri/img_width/img_height（缺一个就报 7115 图片uri非法）
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    const img = await this.uploadToutiaoImage(url, false)
    return {
      url: img.url,
      attrs: {
        class: '',
        'ic-uri': '',
        image_type: img.mime,
        mime_type: '',
        web_uri: img.uri,
        img_width: img.width,
        img_height: img.height,
      },
    }
  }

  private getFilenameFromUrl(url: string): string | null {
    try {
      const pathname = new URL(url).pathname
      const name = pathname.split('/').pop()
      return name && name.trim() ? name : null
    } catch {
      return null
    }
  }

  /**
   * 发布文章（保存草稿）
   */
  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      if (!this.userId) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录头条号')
        }
      }

      // 取发文默认值（article_ad_type / media_id），顺便校验会话与注册状态
      const newResp = await this.runtime.fetch(
        'https://mp.toutiao.com/mp/agw/article/new?article_type=0&format=json&compat=1&column_no=',
        { credentials: 'include' }
      )
      const newData = await this.parseJson(newResp, '发文初始化')
      this.raiseIfProtocolError(newData, '发文初始化失败')
      const articleAdType = Number(newData?.data?.article_ad_type) || 3
      const mediaId = String(newData?.data?.media_id || newData?.data?.media?.id || '')

      let content = article.html || ''
      // 不做 skipPatterns：正文里任何外链图都会被头条判 7115，必须全部转存拿到 web_uri
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          onProgress: options?.onImageProgress,
        }
      )

      // 封面：走封面上传通道，字段按现行编辑器草稿格式补全（宽高不能为 0）
      let cover: Record<string, string | number> | null = null
      if (article.cover) {
        try {
          const img = await this.uploadToutiaoImage(article.cover, true)
          cover = {
            url: img.url,
            uri: img.uri,
            web_uri: img.uri,
            ic_uri: '',
            width: img.width,
            height: img.height,
            thumb_width: img.width,
            thumb_height: img.height,
            id: 0,
            pos: 0,
          }
        } catch (e) {
          logger.warn('封面上传失败，继续不带封面存草稿:', (e as Error).message)
        }
      }

      const plainLength = content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim().length
      const extra = {
        content_source: 100000000402,
        content_word_cnt: plainLength,
        is_multi_title: 0,
        sub_titles: [],
        gd_ext: {
          entrance: '',
          from_page: 'publisher_mp',
          enter_from: 'PC',
          device_platform: 'mp',
          is_message: 0,
        },
        tuwen_wtt_transfer_switch: '1',
      }
      const searchInfo = {
        searchTopOne: 0,
        abstract: article.summary || '',
        clue_id: '',
      }

      const form: Record<string, string> = {
        source: '29',
        extra: JSON.stringify(extra),
        title: article.title,
        content,
        title_id: mediaId ? `${Date.now()}_${mediaId}` : '',
        search_creation_info: JSON.stringify(searchInfo),
        mp_editor_stat: '{}',
        is_refute_rumor: '0',
        save: '0', // 0=存草稿，1=直接发布（现行协议）
        entrance: '',
        timer_status: '0',
        timer_time: '',
        article_type: '0',
        pgc_id: '0',
        educluecard: '',
        draft_form_data: JSON.stringify({ coverType: 2 }),
        pgc_feed_covers: JSON.stringify(cover ? [cover] : []),
        article_ad_type: String(articleAdType),
        is_fans_article: '0',
        govern_forward: '0',
        praise: '0',
        disable_praise: '0',
        tree_plan_article: '0',
        star_order_id: '',
        star_order_name: '',
        customer_nick_name: '',
        activity_tag: '0',
        trends_writing_tag: '0',
        claim_exclusive: '0',
      }

      const csrf = await this.csrfHeaders()
      const response = await this.runtime.fetch(
        `https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article&aid=${AID}&mp_publish_ab_val=0`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            Accept: 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            ...csrf,
          },
          body: new URLSearchParams(form),
        }
      )

      const res = await this.parseJson(response, '保存草稿失败')
      logger.debug('Save response:', res)
      this.raiseIfProtocolError(res, '保存草稿失败')

      const data = res?.data || {}
      const postId = String(data.pgcId || data.pgc_id || '')

      return this.createResult(true, {
        postId,
        // 新版后台草稿列表（带 pgc_id 的直达链接已失效）
        postUrl: 'https://mp.toutiao.com/profile_v4/manage/draft',
        draftOnly: options?.draftOnly ?? true,
      })
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      })
    )
  }
}
