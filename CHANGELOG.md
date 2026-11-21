# Changelog

All notable changes to this project are documented here.

## [0.1.0] - 2026-11-22

### Added

- 人格注入：按外号匹配 Markdown 灵魂档案，注入 system prompt。
- 关键词唤醒：新会话第一句喊外号即可，无需先改标题。
- 自动提炼：打开无档案的导入会话时，自动拉网页端同名对话并用 LLM 生成档案（第一句可能等待）。
- 网页同步：通过 `@xueray/dsh-web-bridge` 增量拉取网页端最新对话。
- 三层记忆：关系层 / 风格层 / 事件层（21 天 TTL，最近 20 条）/ 事实层。
- 永久锚点：`soul_remember` 工具写入 `_anchors/`，不过期。
- 自动归档：每 20 轮或上下文压力 80% 时归档。
- 全文可回查：每轮原文按轮次落盘。
- 内置官方导入插件 `@deepseek-ai/dsh-deepseek-chat-import`。
