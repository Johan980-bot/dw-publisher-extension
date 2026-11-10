import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Globe, PenSquare, MessageSquare, ExternalLink } from 'lucide-react'

export function AboutPage() {
  const navigate = useNavigate()
  const version = chrome.runtime.getManifest().version

  return (
    <div className="flex flex-col h-[500px]">
      {/* Header */}
      <header className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold">关于</h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6 overflow-y-auto">
        {/* Logo & Title */}
        <img src="/assets/icon-128.png" alt="Logo" className="w-16 h-16 mb-3" />
        <h2 className="text-lg font-semibold">DreamWorks 分发助手</h2>
        <p className="text-sm text-muted-foreground mt-1">v{version}</p>

        {/* Description */}
        <p className="text-sm text-muted-foreground text-center mt-4 leading-relaxed">
          Dream Works 官方分发工具：把 GEO 文章工作台改写好的文章，一键填进 17 个平台的草稿箱。
          只进草稿不代发，账号密码不留存，数据不离开你的浏览器。
        </p>

        {/* Links */}
        <div className="flex flex-col gap-2 mt-6 w-full max-w-[240px]">
          <a
            href="https://dream-works.zrt-zkry.com/writing/studio"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm"
          >
            <PenSquare className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">GEO 文章工作台</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
          <a
            href="https://dream-works.zrt-zkry.com/extension"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm"
          >
            <Globe className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">官网与使用教程</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
          <a
            href="https://dream-works.zrt-zkry.com/about"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border hover:bg-muted transition-colors text-sm"
          >
            <MessageSquare className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">联系我们 / 问题反馈</span>
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          </a>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground mt-6 text-center leading-relaxed">
          北京码上云工网络科技有限公司
          <br />
          基于开源项目 Wechatsync（GPL-3.0）二次开发
        </p>
      </div>
    </div>
  )
}
