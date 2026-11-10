/**
 * 网易号适配器
 * https://mp.163.com
 */
import { CodeAdapter, ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Netease')

export class NeteaseAdapter extends CodeAdapter {
  meta: PlatformMeta = {
    id: 'netease',
    name: '网易号',
    icon: 'https://mp.163.com/favicon.ico',
    homepage: 'https://mp.163.com/index.html#/article/publish',
    capabilities: ['article', 'draft', 'image_upload'],
  }

  /** 预处理配置: 网易号编辑器使用 HTML 格式 */
  readonly preprocessConfig = {
    outputFormat: 'html' as const,
  }

  private wemediaId: string | null = null

  /** 网易号 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://mp.163.com/*',
      headers: {
        Origin: 'https://mp.163.com',
        Referer: 'https://mp.163.com/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
    {
      urlFilter: '*://upload.ws.126.net/*',
      headers: {
        Origin: 'https://mp.163.com',
        Referer: 'https://mp.163.com/',
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
        `https://mp.163.com/wemedia/navinfo.do?_=${Date.now()}`,
        { credentials: 'include' }
      )
      const resText = await response.text()
      let data: {
        code?: number
        data?: {
          wemediaId: string | number
          tname: string
          icon: string
        }
      }
      try {
        data = JSON.parse(resText)
      } catch {
        // 未登录时接口可能直接吐 HTML 登录页
        return { isAuthenticated: false, error: '未登录' }
      }

      if (data.code !== 1 || !data.data?.wemediaId) {
        return { isAuthenticated: false, error: '未登录' }
      }

      this.wemediaId = String(data.data.wemediaId)

      return {
        isAuthenticated: true,
        userId: this.wemediaId,
        username: data.data.tname || this.wemediaId,
        avatar: data.data.icon,
      }
    } catch (error) {
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  /**
   * 上传图片
   */
  async uploadImageByUrl(url: string): Promise<ImageUploadResult> {
    if (!this.wemediaId) {
      await this.checkAuth()
    }

    const imageResponse = await this.runtime.fetch(url)
    if (!imageResponse.ok) {
      throw new Error('图片下载失败: ' + url)
    }
    const blob = await imageResponse.blob()

    const formData = new FormData()
    formData.append('file', blob, 'image.jpg')
    formData.append('from', 'neteasecode_mp')

    const response = await this.runtime.fetch(
      `https://upload.ws.126.net/picupload?_=${Date.now()}&wemediaId=${this.wemediaId}`,
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const resText = await response.text()
    let res: {
      code?: number
      data?: { url?: string }
      msg?: string
    }
    try {
      res = JSON.parse(resText)
    } catch {
      throw new Error('图片上传失败：接口返回非 JSON（' + resText.slice(0, 120) + '）')
    }

    const imageUrl = res.data?.url
    if (!imageUrl) {
      throw new Error(res.msg || '图片上传失败')
    }

    return { url: imageUrl }
  }

  /**
   * 发布文章（保存草稿）
   * 发文接口与参数来自网易号现行前端（publishV2.do，operation=saveDraft 只存草稿）
   */
  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {


    return this.withHeaderRules(this.HEADER_RULES, async () => {
      if (!this.wemediaId) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录网易号')
        }
      }

      let content = article.html || ''
      content = await this.processImages(
        content,
        (src) => this.uploadImageByUrl(src),
        {
          skipPatterns: ['163.com', '126.net', 'netease.com'],
          onProgress: options?.onImageProgress,
        }
      )

      const response = await this.runtime.fetch(
        'https://mp.163.com/article/status/api/publishV2.do',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            Accept: 'application/json, text/javascript, */*; q=0.01',
          },
          body: new URLSearchParams({
            title: article.title,
            content,
            cover: '',
            picUrl: '',
            operation: 'saveDraft', // 只存草稿，不直接发布
            docid: '-1',
            wemediaId: this.wemediaId || '',
          }),
        }
      )

      const resText = await response.text()
      let res: {
        code?: number
        msg?: string
        data?: string // 存草稿成功时形如 "docId=xxx&pkId=null"
      }
      try {
        res = JSON.parse(resText)
      } catch {
        throw new Error('保存草稿失败：接口返回非 JSON（' + resText.slice(0, 120) + '）')
      }

      logger.debug('Save response:', res)

      if (res.code !== 1) {
        throw new Error(res.msg || '保存草稿失败')
      }

      let postId = ''
      if (res.data) {
        postId = new URLSearchParams('?' + res.data).get('docId') || ''
      }

      return this.createResult(true, {
        postId,
        postUrl: 'https://mp.163.com/index.html#/draft-manage',
        draftOnly: options?.draftOnly ?? true,
      })
    }).catch((error) =>
      this.createResult(false, {
        error: (error as Error).message,
      })
    )
  }
}
