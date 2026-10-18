# AGENTS.md — Maax

Maax 是一个 Electron 桌面应用，核心组合为 **Electron 44 + Solid 2 RC + Effect 4**。

**默认工作原则：Effect-first。** 业务逻辑、异步流程、错误处理、跨进程边界与资源生命周期优先使用 Effect；高性能热路径与即时值保持普通 TypeScript / Solid，不为了形式统一而增加 Effect 开销。

## 开工前

- **任何 Solid / TSX 工作前，完整阅读 [`.agents/skills/solid2/SKILL.md`](.agents/skills/solid2/SKILL.md)。** API 细节查同一目录的 `references/`；不要按 Solid 1.x 或 React 推断。
- 修改任务表单/字段、Effect Service 或 Layer、IPC Schema、MaaCore 宿主/回调、运行日志、截图、理智作战关卡/代理倍率或打包前，先读 [`.agents/skills/maax-maintenance/SKILL.md`](.agents/skills/maax-maintenance/SKILL.md)。它记录了本仓库已经踩过的具体回归与验证矩阵。
- 按 Effect 4 与 `@effect/tsgo` 的诊断编码，沿用现有写法：
  - [src/renderer/src/effect/desktop.ts](src/renderer/src/effect/desktop.ts) — bridge 的 Effect Service
  - [src/renderer/src/effect/solid-effect.ts](src/renderer/src/effect/solid-effect.ts) — Solid 2 × Effect 适配
  - [src/shared/schemas.ts](src/shared/schemas.ts) — Effect Schema 运行时契约
  - [src/main/runtime.ts](src/main/runtime.ts) — 主进程 Effect IPC 逻辑
- 依赖变更后由 `prepare` 执行 `effect-tsgo patch --oxlint`；升级 TypeScript / Oxlint / oxlint-tsgolint 前先确认 `@effect/tsgo` 的兼容版本。

## 技术栈与约束

- Electron 44 + 宿主 Node.js 26；Electron 内置 Node.js 24.22，宿主 Node 26 的 API 不能直接在 Electron 内使用，需要原生 addon 或 sidecar。
- Solid 2 RC + `@solidjs/web`；样式不使用 Tailwind，使用原生 CSS Modules 与 attribute 构建。
- Effect 4 + Effect Schema，TypeScript 7 + `@effect/tsgo`，Vite 8 + electron-vite，Oxlint / Oxfmt，pnpm 12，electron-builder。精确版本见 `package.json` / `pnpm-lock.yaml`。
- Wayland 下 Electron 44 默认使用 native Wayland；不要给启动脚本或主进程添加强制 X11 / `--ozone-platform` 参数。

## 高频回归红线

- **可编辑任务列表**必须使用 `<For keyed={false}>`，并在回调内用 accessor；此模式下的索引是普通 number。默认 `<For>` 按对象引用 key，编辑参数会重建行，输入框会在每次按键后丢焦点。
- **组件体里不要用普通常量缓存 `props.value`**。多选 chip、下拉框等必须通过 accessor/memo 读取；否则数据已保存但选中态不更新。
- **动态 `<select>`** 不要只绑定静态 `value`；用响应式 `current()` 比较 `<option selected={...}>`，避免选项挂载前设置 value 导致显示错误。
- **Effect 4** 使用 `Effect.catch`，不是 v3 的 `catchAll`；Service 方法内部 `provideService(FileSystem, fs)`，对外保持 `R = never`。
- **MaaCore 只在 utilityProcess**；callback 只入队，禁止在 callback 内 `AsstDestroy`、FFI 查询或阻塞操作。
- **`SubTaskError` 的 `ProcessTask`** 多为普通识别分支未命中，按 debug 处理；只把 `AutoRecruitTask`、`RecognizeDrops`、`StartGameTask`/`StopGameTask`、仓库模板错误等已知真实错误报为 error。

## Effect boundary

**放入 Effect：** IPC、网络、文件系统、数据库、SDK 等异步 I/O；需要类型化错误、重试、超时、并发或取消的流程；资源与服务的生命周期；跨进程编排；外部库接入层。

**保持普通代码：** 纯函数、即时值、JSX 与信号读取、局部 UI 状态、简单事件处理，以及逐帧 / 每元素 / 每像素等高性能热路径。热路径整体作为 plain core，只在最外层入口包装一次效应边界；不要用 `Effect.sync` 包裹平凡表达式。

具体约定：

- 外部依赖包装为 `Context.Service` + `Layer`，以带类型的 Effect 暴露。UI 不直接调用 `window.maax`；新增 IPC 时依次更新 shared schema/channel、preload、`DesktopBridge`、主进程 Effect handler。
- 跨边界数据全部走 [src/shared/schemas.ts](src/shared/schemas.ts)：Schema 推断类型、主进程与 renderer 两侧解码、错误使用 `Schema.TaggedError`。不要手写平行 interface。
- Renderer 异步读取沿用 `createMemo<T>(() => runEffect(effect))` + `<Loading>` / `<Errored>`；`Effect.runPromise` / `runtime.runPromise` 只出现在 IPC handler、UI 事件处理器和测试等边界。
- Solid 只负责视图与本地同步状态，Effect 负责异步与服务编排。不要把本地同步值或渲染计算搬进 Effect。
- Solid 与 Effect 由 Vite 打包进 `out/`，当前位于 `devDependencies`；迁移到 `dependencies` 前必须同步检查 electron-vite externalization 与 electron-builder 产物。

## 质量与完成

- 类型检查由 Oxlint 的 `typeAware` / `typeCheck` 完成；**没有 `tsc` / `typecheck` 脚本**。Oxlint 与 Oxfmt 是唯一 lint / format 工具。
- 完成前运行 `pnpm check`、`pnpm test` 与 `pnpm build`。涉及运行时行为时实际启动 Electron 验证；涉及打包时运行 `pnpm package` 并启动产物。
- 视觉或启动流程有变化时更新 `docs/` 截图，检查深色/浅色主题。
- 维持现有安全边界：sandbox / contextIsolation、最小 preload 白名单、IPC Schema 校验，不新增绕过这些边界的通道。

更完整的人类说明与命令见 [README.md](README.md)。
