# DailyReader

跨平台同步阅读器：**Windows / Linux / Android 通过浏览器或 PWA 使用**，书籍与阅读进度
同步存放在**你自己的 GitHub 私有仓库**，无需付费服务。

> 灵感来自 [koodo-reader](https://github.com/koodo-reader/koodo-reader)（AGPL-3.0）。
> 本项目为独立实现，仅参考其技术选型并使用同样的开源库（epub.js / pdf.js / mammoth /
> @web-ppt/core 等），不包含其源码。

## 功能

- **格式**：PDF · DOCX · DOC · PPT · PPTX · MD · TXT · HTML · EPUB
- **同步**：书架 / 书籍文件 / 阅读进度，多端 last-write-wins；EPUB 用 CFI 精确到位置，
  PDF 用页码，PPT 用幻灯片序号
- **离线**：PWA，书籍缓存到 IndexedDB，断网可读
- **TXT 编码**：chardet 自动检测 GBK / GB18030 / Big5 / Shift_JIS
- **零后端**：浏览器直连 GitHub API；未来可无缝切换到自建服务器（见 `server/README.md`）

## 快速开始

```bash
npm install
npm run fixtures   # 生成各格式测试样书到 fixtures/
npm run dev        # 本地开发
npm run build      # 构建（GitHub Pages 用）
npm test           # 同步层单元测试
```

## 部署（GitHub Pages，免费）

1. 在 GitHub 建仓库（默认名 `DailyReader`，与 `vite.config.ts` 的 base 一致）
2. 推送代码，仓库 Settings → Pages → Source 选 **GitHub Actions**（`.github/workflows/deploy.yml` 已就绪）
3. 打开 `https://<你的用户名>.github.io/DailyReader/`，手机浏览器菜单选「安装应用」即得 PWA

## 配置同步

1. 建 [fine-grained PAT](https://github.com/settings/personal-access-tokens/new)：
   - Repository access：Only select repositories → `reader-data`
   - 权限：Contents → Read and write（首次「创建数据仓库」需 Administration → Read and write）
2. 应用内 设置 → 填 Token / 用户名 / 仓库名 → 测试连接 → 创建数据仓库 → 立即全量同步
3. 其他设备打开同一网址，填同一 Token

数据仓库结构：

```
reader-data/
├── shelf.json           # 书架元数据
├── progress/<id>.json   # 各书阅读进度
└── books/<id>.<ext>     # 书籍文件（单文件 ≤ 100MB）
```

## 架构

```
src/
├── pages/       ShelfPage（书架）/ ReaderPage（统一阅读框架）/ SettingsPage
├── readers/     各格式 Reader（统一 ReaderProps 接口，懒加载分 chunk）
├── store/       zustand：useShelf / useSettings
├── storage/     localforage（IndexedDB）封装
└── sync/        SyncProvider 抽象 + GitHubSyncProvider + 同步编排
server/          Phase 4：Spring Boot 后端占位（买云服务器后启用）
```

| 格式 | 方案 | 进度 |
|---|---|---|
| EPUB | epub.js | CFI |
| PDF | pdfjs-dist | 页码 |
| DOCX | mammoth → HTML | 百分比 |
| DOC | OLE piece table 文本提取（尽力而为） | 百分比 |
| PPT/PPTX | @web-ppt/core → SVG | 幻灯片序号 |
| MD | markdown-it | 百分比 |
| TXT | chardet + TextDecoder | 百分比 |
| HTML | DOMPurify | 百分比 |

## Roadmap

- [x] Phase 0 脚手架 + Pages 部署链路
- [x] Phase 1 本地阅读核心（8 格式 + 书架 + 进度记忆）
- [x] Phase 2 GitHub 多端同步
- [ ] Phase 3 打磨：PWA 离线策略、大文件上传体验、阅读统计
- [ ] Phase 4 Spring Boot 后端：doc/ppt 无损转换、全文搜索、AI

## 已知限制

- 单文件 > 100MB 无法同步（GitHub 限制），导入时拦截
- `.doc` 旧格式仅提取文本（转 docx 体验完整）；Phase 4 服务端 LibreOffice 彻底解决
- PAT 保存在浏览器 localStorage——自用可接受，请勿在公用电脑配置
