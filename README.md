# Maax

Maax 是一个本地优先的 Electron 桌面应用基线，使用 **Electron 44 + Solid 2 RC + Effect 4**。业务逻辑按 Effect-first 组织，界面使用 Solid 2 的细粒度运行时。

![Maax 界面预览](docs/preview-dark.png)

<details>
<summary>查看浅色主题</summary>

![Maax 浅色主题](docs/preview-light.png)

</details>

## 技术栈

| 范围    | 版本                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Runtime | Electron `44.9.0` · Node.js `26.12.0`（宿主）· pnpm `12.14.0`                                              |
| UI      | Solid `2.0.0-rc.15` · @solidjs/web `2.0.0-rc.15` · 原生 CSS（无 Tailwind）                                 |
| Effect  | effect `4.0.5` + Effect Schema                                                                             |
| Build   | Vite `8.3.4` · @solidjs/vite-plugin `3.0.0-next.50` · electron-vite `6.0.0` · electron-builder `26.15.3`   |
| Quality | TypeScript `7.0.2` · @effect/tsgo `0.53.4` · Oxlint `1.88.0` · oxlint-tsgolint `7.0.2004` · Oxfmt `0.73.0` |

所有版本精确锁定在 `package.json` 与 `pnpm-lock.yaml`。

## 架构

- **主进程**：Electron 生命周期与安全检查；IPC 业务是 [Effect 程序](src/main/runtime.ts)，返回值经 Effect Schema 校验。
- **Preload**：最小 `contextBridge` 白名单，仅暴露 `getRuntimeInfo()` 与 `ping()`。
- **Renderer**：sandboxed，无 Node；通过 [DesktopBridge](src/renderer/src/effect/desktop.ts) Effect Service 访问 IPC，异步读取经 [runEffect](src/renderer/src/effect/solid-effect.ts) 交给 `<Loading>` / `<Errored>`。
- **共享层**：[schemas.ts](src/shared/schemas.ts) 定义 IPC 数据与错误 Schema，主进程返回前和 renderer 解码时都会校验。
- **安全**：`sandbox`、`contextIsolation`、最小 preload、CSP、权限拒绝与导航锁定默认开启。

Effect wrapper 与高性能/即时值例外的完整约定见 [AGENTS.md](AGENTS.md)。

## 开发

需要 Node.js 26 和 pnpm 12。

```bash
pnpm install
pnpm dev
```

类型检查由 `pnpm lint` 中的 Oxlint type-aware / type-check 完成，不依赖 `tsc --noEmit`。`prepare` 会在安装后自动 patch `@effect/tsgo`；格式化使用 Oxfmt。

| 命令           | 说明                                       |
| -------------- | ------------------------------------------ |
| `pnpm dev`     | 启动 Electron + Vite HMR                   |
| `pnpm lint`    | Effect 规则 + type-aware + TypeScript 诊断 |
| `pnpm format`  | Oxfmt 格式化                               |
| `pnpm check`   | lint + format check                        |
| `pnpm build`   | lint 后构建到 `out/`                       |
| `pnpm package` | 生成免安装目录 `dist/`                     |
| `pnpm dist`    | 生成安装包 / AppImage / DMG / NSIS         |

## 运行时说明

- Electron 44.9.0 内置 Node.js 24.22.0，宿主 Node 26 只用于开发、构建与打包；Node 26 专属 API 不能直接放进 Electron 进程。
- Electron 44 在 Wayland 下默认使用 native Wayland；如需排查兼容性，显式使用 `--ozone-platform=x11` 回退 XWayland。

## License

MIT
