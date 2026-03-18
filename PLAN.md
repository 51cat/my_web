# 生物信息小工具箱网站 - 项目实现计划及当前状态

## 1. 整体架构与开发状态 (Status)
**状态：已完成核心的所有功能构建，完全达到了生产级别的雏形。**

本项目构建了一个本地/服务器同构运行的生物学 Web 应用。以 Node.js + Express 作为后端核心编排出租车式的任务调度，通过 Docker 实施安全、隔离的命令行生信工具调用。前端无需 Vue/React 等现代框架，直接利用 Vanilla JS 并配合 JSON 数据实现了自动化且高颜值的 Web 渲染。

网站已实现了三个核心选项卡体系：
1. **生信工具操作区**：数据上传与 Docker 分析的核心沙盒体系。
2. **生信文档知识库**：基于本地 Markdown 扫描机制的带全局搜索的文档大阅读器。
3. **自定义内容面板**：预留高自由度空板区。

## 2. 后端设计策略 (Node.js) - ✅ 已全部实现
- [x] API路由层构建 (`/api/tools`, `/api/run`, `/api/logs/:id`, `/api/download/:id`, `/api/articles`)。
- [x] 基于 JSON 的动态插件（Plug & Play）注册机制，在 `tools/` 中增加 JSON 便能自动增添前端界面工具入口。
- [x] 基于 UUID 的安全隔离调度：每个分析提交即分配独立 UUID，拥有专属的隔离临时文件目录(`uploads/<UUID>` 和 `outputs/<UUID>`) 避免高并发串流。
- [x] 智能的 Cmd Template（指令模板）重组机制，支持动态插值（`{input_name}`, `{param_value}` 自动化剥离组合成合法 bash / docker 参数）。
- [x] SSE 日志实时流推送引擎，将 `child_process.spawn` 输出长连接地喂给视图。
- [x] 本地 Demo 演示智能 fallback（即无 Docker 环境报错后回退成模拟的定时器 log 流出，容灾能力拉满）。 
- [x] `archiver` 完成的 zip 文件封箱自动打包机制。

## 3. 前端界面设计 (HTML/CSS) - ✅ 已全部实现
- [x] 现代化玻璃质感/素雅风 UI（对标 Apple 及 Vercel 设计直觉）。
- [x] 数据表单响应式装载：File、Number、String、Select 等 Type 字典化渲染识别并应用特化 CSS 制式。
- [x] 拖拽上传动画级联（drag-n-drop）感知。
- [x] 具有跑马灯效果（indetermine bar）的执行进度模块。
- [x] 伪终端（Pseudo-Terminal）大屏设计，包含基于正则表达式的 `cmd/stderr/success` 日志染色高亮识别系统。
- [x] `marked.js` 无缝继承的 GitHub Flavored Markdown 模块展示系统。

## 4. 后续规划及选代建议 (To-Do)
未来，当扩展应用时，能够考虑如下技术路径：
- [x] **初步 UI 登录逻辑**：已实现模拟手机号登录弹窗及状态切换（Fake Login UI）。
- **账户/权限系统**：通过 JWT + SQLite 引入真实的账户体系，支持手机号验证码/密码登录。
- **历史记录存储**：通过引入 SQLite 记录成功打好包的 `jobId` 供不同页面生命周期唤回。
- **任务并发管理**：针对极大量提交考虑引入类似 BullHQ 的 Redis 队列以排队消化过劳的物理机。
- **第三页大屏图表**：利用现有的 自定义 Tab 结合 Echarts 为工具运行输出后的结果提供热图直接可视化视图展示。
- **Git 版本管理**：项目已初始化并准备推送到 GitHub 进行多人协作。
