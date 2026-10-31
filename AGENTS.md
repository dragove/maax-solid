# AGENTS.md — Maax

Maax 是一个 Electron 桌面应用，核心组合为 **Electron 45 + Solid 2 RC + Effect 4**。

**默认工作原则：Effect-first。** 业务逻辑、异步流程、错误处理、跨进程边界与资源生命周期优先使用 Effect；高性能热路径与即时值保持普通 TypeScript / Solid，不为了形式统一而增加 Effect 开销。

## 开工前

- **任何 Solid / TSX 工作前，完整阅读 [`.agents/skills/solid2/SKILL.md`](.agents/skills/solid2/SKILL.md)。** API 细节查同一目录的 `references/`；不要按 Solid 1.x 或 React 推断。
- 修改响应式 UI、Effect Service/Layer、IPC 契约、native 宿主/回调、日志分级或打包前，先读 [`.agents/skills/maax-maintenance/SKILL.md`](.agents/skills/maax-maintenance/SKILL.md)。它记录了本仓库的通用维护边界与验证矩阵。
- 按 Effect 4 与 `@effect/tsgo` 的诊断编码，沿用现有写法：
  - [src/renderer/src/effect/desktop.ts](src/renderer/src/effect/desktop.ts) — bridge 的 Effect Service
  - [src/renderer/src/effect/solid-effect.ts](src/renderer/src/effect/solid-effect.ts) — Solid 2 × Effect 适配
  - [src/shared/schemas.ts](src/shared/schemas.ts) — Effect Schema 运行时契约
  - [src/main/runtime.ts](src/main/runtime.ts) — 主进程 Effect IPC 逻辑
- 依赖变更后由 `prepare` 执行 `effect-tsgo patch`：先 patch Oxlint（Oxlint / oxlint-tsgolint 版本不被 `@effect/tsgo` 支持时直接失败），再用 `--tsrs --skip-missing` patch tsrs（没有对应平台的替换包时跳过该集成，不中断安装）。升级 tsrs / Oxlint / oxlint-tsgolint 前先确认 `@effect/tsgo` 的兼容版本（当前 0.63.0 支持 tsrs `0.20.1-ts7.1.0-beta`、Oxlint 1.88–1.90、oxlint-tsgolint 7.0.2004/7.0.2005；新 tsrs 版本需先有对应的 `@effect/tsgo` 才可升级）。`pnpm typecheck` 始终直接运行 tsrs。
- 核心宿主按平台加载 `MaaCore.dll`（Windows）或 `libMaaCore.so`（Linux）；Windows 使用 `win-x64` / `win-arm64` 的 `.zip` 发布包，ADB 路径留空时按 Android SDK、MuMu/LDPlayer/Nox/BlueStacks 自带 adb、`PATH` 的顺序解析。不要写死 Linux 库名或只处理 `.tar.gz`。

- pnpm 12 默认对依赖设 24 小时 `minimumReleaseAge` 保护期。升级到刚发布的版本（tsrs / `@effect/tsgo` / Solid 的 rc 之类）时，把**精确版本**逐个加进 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（该字段只接受精确版本，不接受范围或通配符）；临时绕过用 `pnpm install --config.minimumReleaseAge=0`，不要为此改全局策略。

## 技术栈与约束

- Electron 45 + 宿主 Node.js 26；Electron 内置的 Node.js 版本较旧，宿主 Node 26 的 API 不能直接在 Electron 内使用，需要原生 addon 或 sidecar。
- Solid 2 RC + `@solidjs/web`；样式不使用 Tailwind 或 UI 组件库：单一全局 `styles.css` + CSS 自定义属性 token + data 属性选择器，弹窗、Toast、分段控件等均为本地组件。
- Effect 4 + Effect Schema，tsrs（TypeScript 7 的 Rust 移植）+ `@effect/tsgo`，Vite 8 + electron-vite，Oxlint / Oxfmt，pnpm 12，electron-builder。精确版本见 `package.json` / `pnpm-lock.yaml`。
- Wayland 下 Electron 45 默认使用 native Wayland；不要给启动脚本或主进程添加强制 X11 / `--ozone-platform` 参数。

## 高频回归红线

- **`<For>` 默认按对象引用 key**。位置型列表若原地编辑，用 `keyed={false}`；该模式给 item accessor 和普通 number 索引，不要写 `index()`。否则更新会重建行并丢失输入焦点。整批替换的实体列表（IPC 快照、扫描批次）要按实体自身 id key（`keyed={(row) => row.id}`），否则每批更新都会重挂载所有行并重放入场动画。
- **`<Errored>` 的 `fallback` 收到的是 error accessor**：写 `error()`，不要直接把 `error` 插进 JSX（会渲染函数源码）；面向用户的错误文案统一用 `effect/desktop.ts` 的 `describeError`。
- **组件体只运行一次**。不要把 `props.value` 缓存进普通常量；多选状态、当前选项等必须经 accessor/memo 读取，否则数据已保存但视觉状态不更新。
- **动态原生 `<select>`** 不要只绑定静态 `value`；用响应式 current 比较 `<option selected={...}>`，避免选项挂载前设置 value 导致显示错误。
- **Solid dev 诊断即缺陷**。`pnpm dev` 控制台不允许残留 `STRICT_READ_UNTRACKED` / `PENDING_ASYNC_*`：组件体和 `createEffect` 的 apply 段都不是追踪作用域，一次性快照写 `untrack(() => props.x)`，其余读值移入 JSX / memo / compute。诊断报出的名字可能是 props getter 穿透到的父信号，不一定是当前 prop。
- **改 `styles.css` 后核对类名**。组件用到的每个类都要在样式表里有定义：整块样式被删不会编译报错，只会表现为控件错位或菜单变内联块。
- **Effect 4** 使用 `Effect.catch`，不是 v3 的 `catchAll`；Service 方法内部提供依赖，对外保持 `R = never`。
- **原生库宿主**必须放在 utilityProcess/worker，不能在 Electron 主进程加载；callback 只入队，禁止生命周期调用、阻塞 FFI 或跨线程回调内同步工作。
- **动画走 motion token**。按动作选曲线：进入用 `--ease-out`，真正离开屏幕的退出用 `--ease-in`，原地改变尺寸/透明度的动效（展开收起的两个方向、页面交叉淡入、滑块）用 `--ease-out` / `--ease-standard`——尺寸变化用 `--ease-in` 会先停住再猛收；时长按元素大小取 `--duration-*`；`<Show>` 分支默认只有进入动画，退出动画只能由组件自己多挂载一个节拍（Modal / Toaster），并且必须被 `prefers-reduced-motion` 兜底关闭；页面切换走 View Transition（`.content` 命名组）、展开收起用 `Collapse`、工具栏状态切换用 `SwapStack` 保持宽度稳定；日志、进度等高频内容不做动画。
- **全局 `busy` 只属于会立即改变运行/设备状态的命令**。内核下载/导入是增量操作，设备连接可能要等 ADB/MaaCore 数十秒：它们都不占用全局 `busy`，分别用 `coreBusy`、`connectBusy` 只禁相关按钮，任务与计划在等待期间保持可用；只有任务处于 preparing/running 时才禁止切换内核。
- **回调消息 ID 不等于日志级别**。在统一 formatter 中按 payload 语义分级：预期分支退出用 debug/info，可操作失败才用 error，并优先显示 `first`/`subtask`/`taskchain`，不要输出 `unknown`。
- **工具识别只走既有回调**。OperBox/Depot 的结果来自 `SubTaskExtraInfo`（msg 20003）的 `OperBoxInfo` / `DepotInfo`；在 `src/shared/tools.ts` 解析、按设备保存最新快照，不要为此新增 native API。公开招募计算器只读活动核心的 `recruitment.json` 与 `battle_data.json`。
- **终止态运行只写一次历史**。完成回调、停止、宿主崩溃与启动失败都经 `recordRun`；不要在渲染进程或事件处理器里重复记录。定时任务只在应用运行时检查，使用本地时间与两小时补跑窗口，失败/跳过也要写入 `lastStatus`。
- **托盘关闭行为要可回来**。`closeToTray` 与 `locale` 通过 `src/main/app-behavior.ts` 镜像给窗口关闭处理器与托盘：托盘图标只在开关开启时存在，菜单与关闭提示跟随设置里的语言（不是系统语言），设置变更由主进程 `setShellSync` 同步；托盘不可用时正常关闭窗口，`window-all-closed` 在托盘模式下不得退出。诊断包只写本地目录，不自动上传。

## Effect boundary

**放入 Effect：** IPC、网络、文件系统、数据库、SDK 等异步 I/O；需要类型化错误、重试、超时、并发或取消的流程；资源与服务的生命周期；跨进程编排；外部库接入层。

**保持普通代码：** 纯函数、即时值、JSX 与信号读取、局部 UI 状态、简单事件处理，以及逐帧 / 每元素 / 每像素等高性能热路径。热路径整体作为 plain core，只在最外层入口包装一次效应边界；不要用 `Effect.sync` 包裹平凡表达式。

具体约定：

- 外部依赖包装为 `Context.Service` + `Layer`，以带类型的 Effect 暴露。UI 不直接调用 `window.maax`；新增 IPC 时依次更新 shared schema/channel、preload、`DesktopBridge`、主进程 Effect handler。
- 跨边界数据全部走 [src/shared/schemas.ts](src/shared/schemas.ts)：Schema 推断类型、主进程与 renderer 两侧解码、错误使用 `Schema.TaggedError`。不要手写平行 interface。
- Renderer 异步读取沿用 `createMemo<T>(() => runEffect(effect))` + `<Loading>` / `<Errored>`；`Effect.runPromise` / `runtime.runPromise` 只出现在 IPC handler、UI 事件处理器和测试等边界。
- Solid 只负责视图与本地同步状态，Effect 负责异步与服务编排。不要把本地同步值或渲染计算搬进 Effect。
- Solid 与 Effect 由 Vite 打包进 `out/`，当前位于 `devDependencies`；迁移到 `dependencies` 前必须同步检查 electron-vite externalization 与 electron-builder 产物。

## 分支与发布

`dev` 是默认开发分支，功能改动先合入 `dev`；`master` 只接收 `dev` 的合并。
`master` push 会运行 `.github/workflows/release.yml`：按已有 `v*` tag 自动递增 patch
（首次使用 `package.json` 的 `0.1.0`），构建 Linux AppImage 与 `.tar.zst`
并创建 GitHub Release。需要指定新版本时，在 `dev` 上直接修改 `package.json` 的
`version`。

## 质量与完成

- 类型检查由 Oxlint 的 `typeAware` / `typeCheck` 完成，纯类型检查用 `pnpm typecheck`（tsrs 按 project 分别 `--noEmit`）；**没有 `tsc` 脚本，仓库内不安装 `typescript`**，编辑器/工具链都不再依赖它。Oxlint 与 Oxfmt 是唯一 lint / format 工具。
- 完成前运行 `pnpm check`、`pnpm test` 与 `pnpm build`。涉及运行时行为时实际启动 Electron 验证；涉及打包时运行 `pnpm package` 并启动产物。
- 视觉或启动流程有变化时检查深色/浅色主题；`docs/` 的预览图只在整体界面明显改版时重新生成（先压缩再提交），日常小改动不要替换截图，避免仓库体积膨胀。
- 仓库文档、skill 与 `AGENTS.md` 不写入本机绝对路径、用户名、设备地址或下载位置；使用仓库相对路径与 `app.getPath("userData")` 这类通用位置。
- 维持现有安全边界：sandbox / contextIsolation、最小 preload 白名单、IPC Schema 校验，不新增绕过这些边界的通道。

更完整的人类说明与命令见 [README.md](README.md)。
