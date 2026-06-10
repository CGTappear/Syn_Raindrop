# MVP Roadmap

## 已实现

- MV3 扩展骨架
- 后台 service worker
- Chrome bookmark 读取
- Raindrop REST API 客户端
- Raindrop OAuth2 authorization code 授权
- access token 自动刷新
- 本地配置、状态、日志存储
- Chrome -> Raindrop 单向同步引擎
- 敏感关键词、域名、路径过滤
- 删除归档策略
- popup 状态页
- options 配置页

## 近期开发

1. 公开发布认证形态
   - 当前 OAuth 可用于个人自用或内部加载扩展。
   - 如果要公开发布，应增加后端 token broker，避免把生产 client secret 放进扩展前端。

2. 同步状态表增强
   - 记录内容 hash，避免每次都 PUT 更新。
   - 记录 ruleId、collectionId、lastSyncedAt、lastError。

3. 恢复区
   - 展示因 Chrome 删除而归档的 Raindrop 项。
   - 支持恢复映射或确认清理。

4. 批量保护
   - 单次删除/移动超过阈值时自动暂停。
   - 用户确认后继续归档。

5. 规则模板
   - 工作备份模板
   - 项目资料模板
   - 域名归档模板
   - 隐私保护模板
   - 办公网安全模板

## 验收标准

- 点击“连接 Raindrop”后可完成 OAuth 授权并保存 token
- access token 过期前可通过 refresh token 自动续期
- 新增 Chrome 工作文件夹书签后，能同步到目标 Raindrop collection
- 修改 Chrome 标题后，Raindrop 对应项更新
- 删除 Chrome 书签后，Raindrop 对应项被归档，不被硬删除
- 命中敏感关键词、域名或路径时，书签不被同步
- Office Mode 下 popup 不展示具体标题或 URL
- 未配置规则或 token 时不会发起危险操作
