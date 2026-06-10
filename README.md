# Time Architect

目标导向的个人时间规划驾驶舱：周历 + AI 排程对话 + 草案确认工作流。

- 7×24 周历：拖拽创建、拖动移动、底部拖拽调整时长、重叠日程自动并排
- AI 对话排程：流式回复 + 工具调用，所有修改先生成**草案预览**，确认后才写入
- Fast Path：简单请求（`明天 14:00 写周报 60min`）本地正则秒建，零 token
- 自定义 Agent + `@all` 多 Agent 会诊（依次发言、合并草案）
- 目标合约（Goal Contract）：工作量估计、可行性检查，AI 可创建/修改/删除目标
- 云账号跨设备同步（端到端加密），也支持纯本地使用
- PWA 可安装 + Android APK（与 Web 共用同一账号系统）

## 本地运行

```bash
npm install
npm start          # http://localhost:4175
```

`npm start` 是一个纯 Node 开发服务器（不需要 python / vercel CLI），同时挂载了
`/api/time-architect`、`/api/accounts`、`/api/settings` 三个 serverless 函数 ——
本地就是完整产品。`.env.local` 中的环境变量（如 `BLOB_READ_WRITE_TOKEN`）会自动加载，
有 Blob token 时云账号注册/登录/同步在本地完全可用。

终端会打印局域网地址（`http://192.168.x.x:4175`），同一 Wi-Fi 的手机可以直接访问。

## 测试

```bash
npm test           # 语法检查 + API 单测 (26) + 前端冒烟/回归 (38，含流式与会诊 E2E)
npm run test:api   # api/ 纯逻辑单测：上下文构建、空闲时段、消息组装、工具校验
npm run test:ui    # 前端 vm 沙箱：fast path、重叠布局、草案统计、假 SSE 端到端
npm run test:chat  # （可选）对真实部署发 20 组对话场景，TA_TEST_URL 可指定环境
```

## 模型 API（BYOK）

聊天回复全部来自在线模型 API；没有任何"本地假装的 AI 回复"（Fast Path 是显式标注
`Fast · local` 的本地快建，不是假模型）。在「Settings」页粘贴你自己的 API Key
（OpenAI 兼容或 Anthropic 接口均可）。Key 只存在浏览器 localStorage，
仅在请求时经 `/api/time-architect` 代理转发。

服务器侧环境变量（全部可选，公网部署建议只用 BYOK）：

```text
TIME_ARCHITECT_ALLOW_SERVER_KEY   # 设为 true 才允许使用服务器 key
TIME_ARCHITECT_API_KEY / OPENAI_API_KEY
TIME_ARCHITECT_SERVER_CONFIGS     # JSON 数组，多配置
TIME_ARCHITECT_BASE_URL / TIME_ARCHITECT_MODEL / TIME_ARCHITECT_API_MODE
BLOB_READ_WRITE_TOKEN             # 云账号与同步所需
```

不要提交真实 key。

## 账号与同步

- **云账号**：`/api/accounts` 存用户名 + 盐 + 密码派生校验值（私有 Vercel Blob）。
  日历用密码派生的 AES-GCM 密钥在浏览器端加密后再上传（`/api/settings`），
  云端只保存密文信封。密码不对时禁止覆盖云端计划。
- **本地模式**：不注册也能用，数据存本机；三个测试账号（演示/考试/碎片日程）
  数据相互隔离，重置按钮一键还原。
- Web、PWA、Android APK 用的是同一套 API → 同一个账号在任何端登录都是同一份日历。

## 聊天行为

### Fast Path（本地，无 LLM）

Fast 开关亮起且消息没有 `@` 时，先尝试本地解析：
`今天/明天/后天/下周三/next monday/5月24号/2026-06-03` + `14:00/2pm/下午两点半/10-11点` +
`60min/1h/半小时`。置信度 ≥0.8 时直接生成 `create_event` 草案，气泡标注 `Fast · local`。

### 流式工具调用

其余消息发往 `/api/time-architect`（SSE）。模型用自然语言流式回复；
工具调用经服务端校验后聚合成草案。可用工具：

`create_event / update_event / delete_event / move_event / resize_event /
create_goal / update_goal / delete_goal / update_profile`

服务端附带的上下文：`[Profile]`（含跨午夜睡眠标注）、`[Today]`（**用户本地时间**，
由前端 `clientNow` 提供）、`[Blocks]`（按相关性筛选）、`[Goals]`、
`[Free slots next 7 days]`（展开重复日程后计算）。

### @agent 与 @all 会诊

- 在「Flow」页创建 Agent：名称 + 绑定 API 配置 + 专属 prompt。
- `@某个agent` 把这一轮路由给它（全局 prompt + 该 agent prompt）。
- `@all`（或 `/council`、`@全体`）发起**会诊**：所有 Agent 依次发言，
  每位都能看到前面发言（带 `[名字]` 前缀），全部工具调用合并成一份草案。
  停止按钮可中断当前及后续 Agent。

### 草案 / 确认契约

- 所有日历修改都是草案，UI 显示 `应用并存档` / `丢弃`；预览中日历只读。
- 删除已有日程：模型必须先文字列出目标、等用户确认才调用 `delete_event`。
- `repeat.frequency` 默认 `none`：用户没说"每天/每周/每月"时，服务端
  `applyRecurrenceGuard`（`api/_shared/validation.js`）会强制把模型擅自设置的
  重复改回 `none` —— 这是运行时硬校验，不只靠 prompt。

## 日历操作（鼠标/键盘）

| 操作 | 方式 |
|---|---|
| 创建 | 空白处拖拽划选 → 填表创建（Enter 确认 / Esc 或点外面取消） |
| 移动 | 按住块拖动（跨天放下自动改日期，5 分钟吸附） |
| 调整时长 | 拖动块底部手柄 |
| 编辑 | 单击块打开就地编辑表单 |
| 删除 | 选中后 Delete 键 / Ribbon Delete / 表单删除（均有确认，重复系列会提示） |
| 重复日程 | 显示 ↻ 角标；只能通过表单编辑（不可拖动，避免歧义） |

块字段（Outlook 风格）：`date / day / start / end / category / kind / repeat / title / note`，
`start/end` 为午夜起分钟数，最小 5 分钟。重叠的块自动并排分列显示。

## PWA / 手机

部署到 HTTPS（或本机 localhost）后，Chrome/Edge 地址栏会出现安装图标，
安卓 Chrome 菜单「添加到主屏幕」即可作为独立 App 运行（含离线壳缓存，
`/api` 永远走网络）。图标由 `npm run icons` 生成（零依赖 PNG 编码器）。

## Android APK

```bash
npm run android:apk        # → TimeArchitect-debug.apk
```

详见 [docs/android-app.md](docs/android-app.md)。要点：

- APK 内置全部前端资源；API 默认指向云端部署 → **与 Web 版账号互通**
- 本地模式（测试账号、本机日历）不依赖任何后端
- APK 的云功能要求后端部署包含 CORS 的版本（本仓库已就绪，部署一次即生效）

## 部署到 Vercel

[一键导入](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhenryzhou9527-ship-it%2Ftime-architect&project-name=time-architect&repository-name=time-architect)，
需配置 `BLOB_READ_WRITE_TOKEN`。静态托管（GitHub Pages）不执行 `/api`，只能当纯本地版用。
