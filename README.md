# Raindrop Privacy Sync

一个隐私优先的 Chrome 到 Raindrop 书签自动备份器。



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
4. 选择Raindrop_Syn所在目录
5. 打开扩展 Options 页面，复制页面里的 Redirect URI
6. 在 Raindrop 开发者应用里配置这个 Redirect URI
7. 在 Options 页面填入 OAuth Client ID 和 Client Secret
8. 点击“连接 Raindrop”
9. 点击“读取授权 Collections”
10. 新增规则，把一个 Chrome 工作文件夹映射到一个 Raindrop collection


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

