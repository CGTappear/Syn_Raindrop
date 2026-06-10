# Product PRD

## 定位

Raindrop Privacy Sync 是面向重度收藏用户的隐私优先书签同步自动化工具。

Chrome 是办公环境下的主操作界面。Raindrop 是备份、归档、跨设备和长期收藏库。插件不是把 Raindrop 全部接进 Chrome，而是只接入用户授权的 Sync Space。

## 核心问题

用户需要 Raindrop 的云端能力，但不希望办公电脑暴露 Raindrop 的私人内容。

关键矛盾不是“能不能同步”，而是“哪些内容允许被办公环境看见、搜索、同步和反向影响”。

## 产品原则

- 分区：Work Space、Private Space、Sync Space 明确分开
- 规则：所有同步都由显式规则驱动
- 最小可见：默认只展示必要状态和数量
- 单向优先：默认 Chrome -> Raindrop only
- 可审计：每次同步都有脱敏日志
- 可暂停：用户可以一键暂停所有自动化

## 默认承诺

- 默认不会把 Raindrop 私人内容同步到 Chrome
- 默认不会浏览、展示、搜索未授权的 Raindrop collection
- 默认不会因为 Chrome 删除而永久删除 Raindrop 备份
- 默认以 Chrome 为源，以 Raindrop 为备份目的地

## MVP 功能

### P0

- Chrome -> Raindrop 单向同步
- 多映射规则
- Chrome 文件夹完整子树同步
- 子文件夹/书签新增、修改、移动、重命名、删除处理
- 隐私白名单 collection
- 排除路径
- 删除归档而非硬删除
- 脱敏同步状态
- 后台自动同步队列

### P1

- 域名/关键词过滤
- 规则模板
- 批量变更保护
- 日志详情
- Office Mode 锁定

### P2

- 时间窗口同步
- 网络环境条件同步
- 标签自动化
- 高级冲突策略
- Raindrop 只读查询能力

### P3

- 双向同步
- 私人/工作多身份空间
- AI 自动分类
- 跨浏览器支持

## 非目标

- 默认不做 Raindrop -> Chrome
- 默认不做双向同步
- 默认不展示 Raindrop 全量 collection
- 默认不做永久删除
- 默认不使用远端 AI 分类私人内容
