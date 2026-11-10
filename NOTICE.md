# NOTICE

## DreamWorks 分发助手 (dw-publisher-extension)

本扩展是 [Wechatsync](https://github.com/wechatsync/Wechatsync) 的二次开发版本（fork）。

- 上游项目：Wechatsync（文章同步助手）
- 上游协议：GNU General Public License v3.0
- 本仓库同样以 **GPL-3.0** 发布，完整协议见 [LICENSE](./LICENSE)

依照 GPL-3.0 的要求：

1. 上游全部版权声明与 LICENSE 原样保留；
2. 本仓库的全部修改与新增代码同样以 GPL-3.0 授权；
3. 主要修改点（相对上游 2.0.10）：
   - 品牌改造为「DreamWorks 分发助手」；
   - 新增 `src/content/dw-bridge.ts`：与 DreamWorks 主站（dream-works.zrt-zkry.com）的 `dw-ext-ping/pong` 握手协议，
     以及 `dw-ext-dispatch` 一键分发中转（主站文章工作台 → background `SYNC_ARTICLE` → 结果回传）；
   - `src/adapters/index.ts`：`platformContents` 条目新增可选 `title`/`summary` 覆盖字段（支持一平台一稿）；
   - manifest 内容脚本注入范围增加主站域名。

## 安全边界承诺

- 扩展只在用户已登录的标签页内操作编辑器，把内容填入**草稿箱**，不代替用户点击发布；
- 不读取、不传输、不存储任何平台的 Cookie 与账号密码。

## v0.2.0（2026-11-08）
- dw-bridge.ts 支持平台白名单扩充 11 → 17：新增 douban / eastmoney / imooc / woshipm / xueqiu / yuque（均为上游开源 adapter，id 已核对一致）
