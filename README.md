# Raindrop Privacy Sync

一个隐私优先的 Chrome 到 Raindrop 书签自动备份器。

你继续在 Chrome 管理工作书签，插件只按你授权的规则同步到 Raindrop；私人 Raindrop 内容默认不可见、不可拉取、不可反向同步。

## 当前状态

这是一个可直接加载的 Chrome MV3 扩展原型，聚焦 P0 MVP：

- Chrome -> Raindrop 单向同步
- 高级规则可选择 Raindrop -> Chrome 或双向同步
- Chrome 文件夹到 Raindrop collection 的多规则映射
- 默认不展示、不搜索、不同步未授权 collection
- 敏感关键词、域名、路径过滤
- 删除默认归档，不做硬删除
- Office Mode 下 popup 与日志脱敏
- OAuth2 授权连接、access token 自动刷新
- 后台定时同步、书签变更触发同步、手动同步
- 暂停/恢复同步
- 独立 Raindrop collection 级 URL 查重与重复项归档

## 双向同步边界

双向同步属于高级规则能力，默认仍保持关闭。开启后也只会读取用户在规则中明确选择的 Raindrop collection，并写入规则指定的 Chrome 文件夹。

当前安全策略：

- 默认规则仍是 `Chrome -> Raindrop`
- `Raindrop -> Chrome` 不会读取未授权 collection
- 双向冲突可选 Chrome 优先、Raindrop 优先或保守跳过
- Chrome 删除仍默认归档 Raindrop，不做硬删除
- Raindrop 侧删除默认保留 Chrome 书签

## 加载方式

1. 打开 `chrome://extensions`
2. 开启 Developer mode
3. 选择 Load unpacked
4. 选择本项目目录：`D:\Documents\Syn_Raindrop`
5. 打开扩展 Options 页面，复制页面里的 Redirect URI
6. 在 Raindrop 开发者应用里配置这个 Redirect URI
7. 在 Options 页面填入 OAuth Client ID 和 Client Secret
8. 点击“连接 Raindrop”
9. 点击“读取授权 Collections”
10. 新增规则，把一个 Chrome 工作文件夹映射到一个 Raindrop collection

## Raindrop OAuth

当前实现按 Raindrop 官方 Token 文档接入 authorization code 流：

- 授权地址：`https://raindrop.io/oauth/authorize`
- 换 token：`https://raindrop.io/oauth/access_token`
- 刷新 token：`grant_type=refresh_token`
- Chrome 扩展回调：`chrome.identity.getRedirectURL("raindrop")`

注意：Raindrop token exchange 需要 `client_secret`。如果这是个人自用或内部加载扩展，可以把 secret 存在 Chrome 本地存储里使用；如果要发布给多用户，建议增加一个后端 token broker，不要把同一个生产 client secret 打包进公开扩展。

## 设计边界

默认行为是保守的：

- 不把 Raindrop 私人内容同步到 Chrome
- 不浏览、展示、搜索未授权的 Raindrop collection
- 不因为 Chrome 删除而永久删除 Raindrop 备份
- 默认以 Chrome 为源，以 Raindrop 为备份目的地
- Raindrop collection 去重是独立维护操作，不参与规则级同步、不反向写入 Chrome

## 目录

```text
manifest.json
src/
  background/        Chrome MV3 service worker
  core/              同步内核、规则、隐私、存储、API、OAuth
  options/           配置页
  popup/             低暴露状态页
  shared/            共享 UI 样式
docs/
  product-prd.md
  mvp-roadmap.md
  technical-design.md
```

## 后续建议

下一阶段优先补测试、恢复区列表、批量变更保护和更细的同步冲突处理。
