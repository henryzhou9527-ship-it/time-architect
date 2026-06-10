# Time Architect Android App

Capacitor 8 把整个 Web 前端原样打进 APK（`android/` 工程已入库），功能与 Web 完全一致：周历、拖拽、AI 对话、会诊、草案确认、PWA 同款图标。

## 构建

```bash
npm run android:apk
# → 项目根目录 TimeArchitect-debug.apk
```

前置条件（本机已满足）：Android SDK（`android/local.properties` 或 `ANDROID_HOME`）、JDK 21（自动探测 Android Studio 自带的 `jbr`）。

流程 = `build:www`（拷贝 index/css/js/icons 到 `www/` 并改写 `js/app-config.js` 注入 API 地址）→ `cap sync android` → `gradlew assembleDebug` → 拷出 APK。

安装：把 APK 发到手机直接装，或 `adb install -r TimeArchitect-debug.apk`。

## 账号互通（与 Web 共用一套账号）

APK 默认把 `window.TIME_ARCHITECT_API_BASE` 指向 `https://time-architect-phi.vercel.app`，
即 Web 版同一个后端：

- 同一用户名密码在手机/电脑/网页登录，看到同一份（端到端加密的）日历；
- 聊天同样经云端 `/api/time-architect` 代理（BYOK key 仍只存手机本地）。

换后端：构建时 `TA_API_BASE=https://你的部署 npm run android:apk`，
或运行中在 WebView 控制台 `localStorage.setItem('ta_api_base_v1', 'https://…')`。

**注意**：APK 的 origin 是 `https://localhost`，跨域访问后端依赖本仓库已加的
CORS 响应头（含 OPTIONS 预检）。云端部署更新到当前代码后，登录/同步/聊天即全部可用；
在那之前 APK 仍可完整使用本地模式。

## 纯本地使用（不互通也无所谓）

不登录云账号时一切都在手机本地：

- 三个测试账号（演示压力型 / 考试冲刺型 / 碎片日程型）一键进入、互相隔离、可重置；
- 「清除本机缓存」只动本机，不碰云端；
- 手动日历的全部功能（创建/拖动/调整/重复/归档）不需要任何网络。

## 工程说明

- `capacitor.config.json`：appId `com.henryzhou.timearchitect`，`androidScheme: "https"`
  （安全上下文，保证 WebCrypto/AES-GCM 登录加密可用）。
- 启动图标：`npm run icons` 同时生成 `android/app/src/main/res/mipmap-*`
  自适应图标（前景点花 + #FFFDF8 背景）。
- 升级 Web 代码后重新出包：`npm run android:apk` 一条命令即可（会重新打 www 并同步）。
- 正式签名发布：`cd android && ./gradlew assembleRelease`，按标准 Android 流程配置签名。
