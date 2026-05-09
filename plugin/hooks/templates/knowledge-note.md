---
status: concluded
projects: []
tags: []
summary: ""
created: YYYY-MM-DDTHH:mm:ss+08:00
updated: YYYY-MM-DDTHH:mm:ss+08:00
sources: []
---

<!-- 用于 knowledge/ 笔记时默认 status: concluded；若复制为 thoughts/ 酝酿笔记，请改为 status: discussing，并按实际情况删除 sources。 -->

<!-- knowledge 笔记格式要求：
- status: discussing（酝酿中）| concluded（已验证）| archived（已过时）
- projects: 来源项目列表，至少一个（如 [paceflow-hooks]）
- tags: 分类标签（如 [error-handling, express]）
- summary: 不超过 80 字的一句话摘要，用于 SessionStart L0 注入匹配
- sources: 知识来源（如 [项目名/findings, 官方文档]）
-->

## 摘要

<!-- L1 层：300-500 tokens，关键结论列表。写给快速了解核心洞察的读者。
示例：
- Express 错误处理中间件必须有 4 个参数 (err, req, res, next)
- 同步错误自动捕获，异步错误必须手动 next(err)
- 错误中间件必须放在所有路由之后注册
-->

## 详情

<!-- L2 层：完整内容，不限长度。写给"3 个月后的自己"。
可包含多个 ### 子章节，如：
### 错误模式
（代码示例、对比表格）
### 正确实践
（推荐写法、注意事项）
### 调试技巧
（排查步骤、常见陷阱）
-->
