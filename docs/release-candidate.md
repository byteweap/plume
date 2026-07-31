# Plume 1.0.0-rc.1 发布候选验收

本文记录 P0-J10 的可重复发布流程与当前证据边界。源码候选版版本统一为 `1.0.0-rc.1`，预期标签为 `v1.0.0-rc.1`。只有该标签触发的 macOS、Windows 签名任务全部通过后，工作流才会创建 GitHub 预发布版本。

## 当前状态

| 门禁 | 状态 | 证据或阻塞项 |
|---|---|---|
| 源码、单元、AC-01 至 AC-10、构建与 Rust 门禁 | 已通过 | `npm run check:all` |
| 版本、标签、发布说明和工作流一致性 | 已通过 | `npm run check:release:candidate` |
| 中英文资源与桌面布局 | 已通过 | 374 个双语键、自动化测试和 1280x720 浏览器视觉检查 |
| macOS 未签名 App/DMG 生成 | 已通过 | 1.0.0-rc.1 本地构建、版本元数据检查与 `hdiutil verify` |
| macOS Developer ID 签名、公证与安装/升级/卸载 | 待外部验证 | 需要 Apple 证书、Apple ID 专用密码和 Team ID |
| Windows Authenticode、MSI/NSIS 安装/升级/卸载 | 待外部验证 | 需要 Windows PFX 证书及 Windows 10/11 运行器 |
| PostgreSQL 14、16、18 集成矩阵 | 待候选 CI 确认 | 标签发布前确认默认分支 CI 全绿 |
| Dependency Review、Dependabot 与在线漏洞状态 | 待候选 CI 确认 | GitHub 在线门禁，不以本地检查替代 |
| 目标设备冷启动与稳定 RSS | 待目标设备记录 | 必须满足 `docs/性能回归基线.md` 的发布边界 |

仓库内没有已知阻塞级缺陷。表中任一“待外部验证”或“待候选 CI 确认”未完成时，都不得把候选版标记为已发布或提升为稳定版。

## 发布步骤

1. 在 GitHub 仓库配置 `docs/macos-release.md` 与 `docs/windows-release.md` 列出的签名 Secret。
2. 确认默认分支 CI、PostgreSQL 14/16/18 集成矩阵、Dependency Review 和 Dependabot 没有阻塞结果。
3. 在干净工作区运行 `npm ci`、`npm run check:all` 和 `npm run benchmark:regression`。
4. 创建并推送与源码版本完全一致的带说明标签 `v1.0.0-rc.1`。
5. 等待 `Plume 1.0 Release Candidate` 工作流完成。它会复用两个平台的签名流程，并且只在两者成功后发布预发布版本。
6. 下载发布页中的 DMG、MSI、NSIS 和 `SHA256SUMS`，在独立目标设备校验哈希。
7. 分别执行干净安装、从上一候选版升级、核心 AC-01 至 AC-10 冒烟、正常卸载，并确认用户数据处理符合预期。
8. 记录 macOS 与 Windows 的完整桌面冷启动时间和稳定 RSS；任何超出发布预算的结果都阻止提升为 1.0。

## 失败与回滚

- 任一签名、时间戳、公证、Gatekeeper、安装或卸载检查失败时，工作流不会创建 GitHub 预发布版本。
- 已发布候选版出现阻塞缺陷时，将其标记为非最新预发布并在修复后递增 `rc.N`；不要移动或复用已有标签。
- 安装包版本必须递增，Windows MSI UpgradeCode 保持不变，禁止通过允许降级规避升级问题。
- 候选版不能覆盖稳定 `1.0.0` 标签；稳定发布必须重新执行全部门禁与双平台验证。
