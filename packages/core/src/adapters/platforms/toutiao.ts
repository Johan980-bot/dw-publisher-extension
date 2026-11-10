/**
 * 头条号适配器
 * https://mp.toutiao.com
 */
import { CodeAdapter, ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Toutiao')

export class ToutiaoAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: 'toutiao',
    name: '头条号',
    icon: 'https://sf1-ttcdn-tos.pstatp.com/obj/ttfe/pgcfe/sz/mp_logo.png',
    homepage: 'https://mp.toutiao.com/profile_v3/graphic/publish',
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
        Referer: 'https://mp.toutiao.com/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  /**
   * 检查登录状态
   */
  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        `https://mp.toutiao.com/mp/agw/media/get_media_info?_=${Date.now()}`,
        { credentials: 'include' }
      )
      const data = (await response.json()) as {
        data?: {
          user?: {
            id: string | number
            screen_name: string
            https_avatar_url: string
          }
        }
        message?: string
      }

      if (!data.data?.user?.id) {
        return { isAuthenticated: false, error: '未登录' }
      }

      this.userId = String(data.data.user.id)

      return {
        isAuthenticated: true,
        userId: this.userId,
        username: data.data.user.screen_name || this.userId,
        avatar: data.data.user.https_avatar_url,
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 上传图片
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    const imageResponse = await this.runtime.fetch(url)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + url)
    }
    const blob = await imageResponse.blob()
    const filename = this.getFilenameFromUrl(url) || 'image.jpg'

    const formData = new FormData()
    formData.append('upfile', blob, filename)

    const response = await this.runtime.fetch(
      'https://mp.toutiao.com/mp/agw/article_material/photo/upload_picture?type=ueditor&pgc_watermark=1&action=uploadimage&encode=utf-8',
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = (await response.json()) as {
      state?: string
      url?: string
      message?: string
    }

    if (res.state !== 'SUCCESS' || !res.url) {
      throw new Error(res.message || '图片上传失败')
    }

    return { url: res.url }
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

      let content = article.html || ''
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['pstatp.com', 'toutiao.com', 'toutiaostatic.com', 'toutiaoimg.com'],
          onProgress: options?.onImageProgress,
        }
      )

      const response = await this.runtime.fetch(
        'https://mp.toutiao.com/mp/agw/article/publish?source=mp&type=article',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            title: article.title,
            content,
            save: '1', // 1=存草稿，不直接发布
            pgc_id: '0',
            article_type: '0',
            article_ad_type: '2',
            from_diagnosis: '0',
            origin_debut_check_pgc_normal: '0',
            tree_plan_article: '0',
            pgc_feed_covers: '[]',
          }),
        }
      )

      const res = (await response.json()) as {
        message?: string
        data?: { pgc_id?: string | number }
      }

      logger.debug('Save response:', res)

      if (!res.data?.pgc_id) {
        throw new Error(res.message || '保存草稿失败')
      }

      const postId = String(res.data.pgc_id)

      return this.createResult(true, {
        postId,
        postUrl: `https://mp.toutiao.com/profile_v3/graphic/publish?pgc_id=${postId}`,
        draftOnly: options?.draftOnly ?? true,
      })
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      })
    )
  }
}
