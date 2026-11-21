# Contributing

欢迎提交 Issue 和 Pull Request。

## 开发

- 纯 JavaScript（ESM），无构建步骤。
- 改代码后运行语法检查：

```sh
node --check index.js
```

- 本地安装测试：在 DSH profile 里 `dsh plugin add ./dsh-soul`。

## 不要提交

- 任何真实的灵魂档案、`_sync/`、`_anchors/`、`full/`、日志；
- 任何网页端 Token、Cookie、凭据；
- 个人对话内容。

`.gitignore` 已覆盖这些路径，提交前请再确认一次。

## PR

- 保持改动聚焦，说明「解决了什么」；
- 涉及行为变化时更新 `README.md` 和 `CHANGELOG.md`；
- 不要引入新的第三方运行时依赖，除非确有必要。
