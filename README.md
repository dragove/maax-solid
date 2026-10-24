# Maax

Maax 是一个面向 **MaaAssistantArknights / MaaCore** 的现代桌面客户端，使用
**Electron 44 + Solid 2 RC + Effect 4** 构建。它重新实现了已停止维护的 MaaX
的设备上下文、任务队列与核心管理体验，并把内核隔离、多版本回退和类型化错误
作为一等设计。

![Maax 界面](docs/preview-dark.jpg)

<details>
<summary>浅色主题</summary>

![Maax 浅色主题](docs/preview-light.jpg)

</details>

![关卡推荐与自动代理倍率](docs/preview-stage-picker.jpg)

> **截图说明**：这些预览图是随仓库提交的固定快照，只有整体界面明显改版时才重新生成。日常小改动请在本地启动应用确认，不要替换这些图片，避免仓库体积膨胀。

## 当前能力

- 本地导入 MaaCore；官方稳定版下载（原生确认框、分阶段安装、可回滚的多版本
  登记），以及托管核心的修复与目录迁移。
- 设备档案、ADB 连接/断开、实时截图与分辨率信息。
- 每个设备一套任务计划：开始唤醒、理智作战、自动公招、基建换班、信用商店、
  领取奖励、集成战略、生息演算、关闭游戏；另有保全/悖论作业、仓库/干员识别、
  自定义任务、单步作战与视频识别；支持拖动排序、启停和自动保存。
- 理智作战支持代理倍率「自动 / 不切换 / 1–10」，并提供可搜索的关卡推荐列表：
  当前活动（来自 StageActivityV2）、常驻推荐、资源本、芯片本与剿灭；也可直接输入任意关卡代码。
- 运行/停止队列，实时任务链与子任务日志，任务状态投影；同一核心版本的多台
  设备共享一个宿主进程，但各自拥有独立的会话与运行状态。
- 工具箱：根据当前核心数据计算公开招募标签组合，识别干员仓库与仓库物品；
  识别结果按设备保存在本地。
- 每日定时运行（应用运行时生效，两小时补跑窗口）、运行历史与按天/按任务的
  统计。
- 托盘模式与关闭到托盘、任务完成通知；可导出运行日志或包含配置、历史与设备
  信息的诊断包。
- MaaCore 运行在独立 utility process 中，一个核心版本一个宿主；UI 不会因内核
  回调阻塞或 native crash 一起退出。
- 中文 / English，深色 / 浅色 / 跟随系统。
- Linux 打包产物已包含 koffi 的 native prebuild，并验证过打包后的核心宿主。

## 技术栈

| 范围    | 组成                                             |
| ------- | ------------------------------------------------ |
| Runtime | Electron · 内置 Node.js · koffi                  |
| UI      | Solid · `@solidjs/web` · 原生 CSS，无 UI 组件库  |
| Effect  | effect · Effect Schema · `@effect/platform-node` |
| Build   | Vite · electron-vite · electron-builder · pnpm   |
| Quality | TypeScript · `@effect/tsgo` · Oxlint / Oxfmt     |

精确版本以 `package.json` / `pnpm-lock.yaml` 为准，这里只记录技术选型。

## 开发

需要 Node.js 26 与 pnpm 12；Electron 内置的 Node.js 与宿主版本不同，不要在 Electron 内使用宿主 Node 26 才有的 API。

```bash
pnpm install
pnpm dev
```

在开发环境中可以通过环境变量直接登记一个本地核心，跳过首次导入：

```bash
MAAX_DEV_CORE=/path/to/MAA-vX.Y.Z-linux-x86_64 pnpm dev
```

`pnpm dev` 打开远程调试端口 `9229`，便于在 Wayland/niri 下做本地 UI 调试；
生产包不开启该端口。

| 命令                 | 说明                                           |
| -------------------- | ---------------------------------------------- |
| `pnpm dev`           | Electron + Vite HMR                            |
| `pnpm test`          | Vitest 单元测试                                |
| `pnpm lint`          | Effect 规则、type-aware 检查与 TypeScript 诊断 |
| `pnpm format`        | Oxfmt                                          |
| `pnpm check`         | lint + format check                            |
| `pnpm build`         | lint 后构建到 `out/`                           |
| `pnpm package`       | 生成免安装目录 `dist/linux-unpacked`           |
| `pnpm dist`          | 生成 AppImage / tar.gz / deb                   |
| `pnpm bench:startup` | 对比三种启动方式的耗时与内存（见下文）         |

`pnpm bench:startup` 使用同一份 app.asar，分别启动 `linux-unpacked`、
AppImage 和本地 Electron + app.asar，测量到工作台首帧的耗时与稳定后的 PSS/RSS。
准备步骤、指标定义和限制见 [docs/startup-benchmark.md](docs/startup-benchmark.md)。

## 分支与发布

`dev` 是默认开发分支，功能改动先合入 `dev`；`master` 只接收 `dev` 的合并。
`dev` 合并到 `master` 后，`master` 的 push 会触发
[`.github/workflows/release.yml`](.github/workflows/release.yml)，构建 Linux AppImage
与 `.tar.gz` 并创建 GitHub Release。版本号按已有 `v*` tag 自动递增 patch，首次发布
为 `0.1.0`；需要指定 minor / major 版本时，在 `dev` 上直接修改 `package.json` 的
`version` 再合并。发布流程不会把递增后的版本写回仓库。产物命名为
`Maax-<version>-linux-x86_64.AppImage` 与 `Maax-<version>-linux-x64.tar.gz`。

## 架构

```text
Renderer (Solid, sandboxed)
  │ typed IPC: one command channel + one event channel
Main (Effect: settings, cores, devices, runs)
  │ MessagePort protocol
MaaCore utility process (koffi → libMaaCore.so)
```

MaaCore 会安装进程级信号处理器，且 koffi 回调会阻塞其消息线程；因此它绝不进入
主进程。详细决策见 [docs/architecture.md](docs/architecture.md)，路线图见
[docs/roadmap.md](docs/roadmap.md)。

## 许可

Maax 以 **AGPL-3.0-or-later** 发布。MaaCore / MaaAssistantArknights 是独立的
AGPL-3.0 项目，不随安装包分发；用户在自己选择的目录中安装或导入。第三方组件
与许可说明见 [NOTICE](NOTICE)。
