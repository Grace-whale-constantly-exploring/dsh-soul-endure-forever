name: Bug report
description: 报告插件问题
title: "[bug] "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        请先确认已阅读 README，并**不要**粘贴 Token、Cookie、真实对话或档案内容。
  - type: input
    id: dsh-version
    attributes:
      label: DSH 版本
      description: 例如 0.2.2-rc.5
    validations:
      required: true
  - type: input
    id: plugin-version
    attributes:
      label: dsh-soul 版本
      description: 例如 0.1.0
    validations:
      required: true
  - type: textarea
    id: what
    attributes:
      label: 发生了什么
      description: 期望行为 vs 实际行为
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: 复现步骤
      description: 尽量最小化
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: 相关日志（脱敏）
      description: 只保留错误行，去掉私人内容
    validations:
      required: false
