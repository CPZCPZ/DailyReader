# server/ — Phase 4：Spring Boot 云服务器后端（占位）

当前阶段**不需要后端**：前端直连 GitHub API（浏览器端 CORS 官方支持，PAT 鉴权），
数据全部存放在你的私有仓库 `reader-data` 中。

## 什么时候启用这里

买了云服务器之后。届时后端能解锁纯前端做不到的能力：

| 能力 | 说明 |
|---|---|
| LibreOffice headless 转换 | `.doc`/`.ppt` 上传时无损转 `.docx`/`.pptx`，旧格式彻底解决 |
| 大文件 | 突破 GitHub 单文件 100MB 限制，存本地磁盘/对象存储 |
| 全文搜索 | 书籍内容建索引（SQLite/ES） |
| AI 能能 | 翻译、摘要、生词本（可接 LLM API） |
| 账号体系 | 正式注册登录，分享给家人朋友使用 |

## 前端如何切换

前端同步层已抽象为 `SyncProvider` 接口（`src/sync/SyncProvider.ts`）：

- 现阶段：`GitHubSyncProvider`（直连 GitHub REST API）
- Phase 4：实现 `ServerSyncProvider`（对接本目录的 Spring Boot 服务），
  在 `src/sync/index.ts` 的工厂里切换即可，UI 与阅读器零改动。

## 建议的 Spring Boot 模块划分（Phase 4 时实现）

```
server/
├── src/main/java/.../
│   ├── controller/   # BookController, SyncController
│   ├── service/      # StorageService(本地磁盘/S3), ConvertService(LibreOffice)
│   ├── repo/         # JPA: BookMeta, Progress
│   └── config/       # Security(Token/JWT), WebConfig(CORS)
└── src/main/resources/application.yml
```

数据迁移：写一个一次性脚本把 `reader-data` 仓库 `books/` 目录平移到服务器存储，
进度 JSON 导入数据库。
