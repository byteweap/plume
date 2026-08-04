# Plume 1.0.0-rc.1 发布候选验收

本文记录 P0-J10 的可重复发布流程与当前证据边界。源码候选版版本统一为 `1.0.0-rc.1`，预期标签为 `v1.0.0-rc.1`。该标签会触发 macOS 与 Windows 无签名安装包构建、基础产物验证、Windows 静默安装/卸载测试，并在全部通过后创建 GitHub 预发布版本。

## 当前状态

| 门禁 | 状态 | 证据或阻塞项 |
|---|---|---|
| 源码、单元、AC-01 至 AC-10、构建与 Rust 门禁 | 已通过 | `npm run check:all` |
| 版本、标签、发布说明和工作流一致性 | 已通过 | `npm run check:release:candidate` |
| 中英文资源与桌面布局 | 已通过 | 374 个双语键、自动化测试和 1280x720 浏览器视觉检查 |
| macOS 无签名 App/DMG 生成 | 待候选 CI 确认 | 标签 workflow 会构建 universal App/DMG 并运行版本、架构与 `hdiutil verify` 检查 |
| Windows 无签名 MSI/NSIS 生成与安装/卸载 | 待候选 CI 确认 | 标签 workflow 会构建 MSI/NSIS，校验产物数量，并执行静默安装/卸载 |
| macOS Developer ID 签名、公证 | 可选，未启用 | 需要 Apple Developer 证书、Apple ID 专用密码和 Team ID；不阻塞当前无签名 RC |
| Windows Authenticode 签名与时间戳 | 可选，未启用 | 需要 Windows PFX 证书；不阻塞当前无签名 RC |
| PostgreSQL 14、16、18 集成矩阵 | 待候选 CI 确认 | 标签发布前确认默认分支 CI 全绿 |
| Dependency Review、Dependabot 与在线漏洞状态 | 待候选 CI 确认 | GitHub 在线门禁，不以本地检查替代 |
| 目标设备冷启动与稳定 RSS | 待目标设备记录 | 必须满足 `docs/性能回归基线.md` 的发布边界 |

仓库内没有已知阻塞级缺陷。表中任一“待候选 CI 确认”或目标设备验收未完成时，都不得把候选版提升为稳定版。当前候选安装包是无签名产物，发布页和验收记录必须明确这一点。

## 发布步骤

1. 确认默认分支 CI、PostgreSQL 14/16/18 集成矩阵、Dependency Review 和 Dependabot 没有阻塞结果。
2. 在干净工作区运行 `npm ci`、`npm run check:all` 和 `npm run benchmark:regression`。
3. 创建并推送与源码版本完全一致的带说明标签 `v1.0.0-rc.1`。
4. 等待 `Plume 1.0 Release Candidate` 工作流完成。它会构建无签名 macOS DMG、Windows MSI 与 NSIS 安装包，并且只在两者成功后发布 GitHub 预发布版本。
5. 在发布页确认标题、说明或资产名称明确标识 unsigned，避免用户误以为安装包已经代码签名。
6. 下载发布页中的 DMG、MSI、NSIS 和 `SHA256SUMS`，在独立目标设备校验哈希。
7. 分别执行干净安装、从上一候选版升级、核心 AC-01 至 AC-10 冒烟、正常卸载，并确认用户数据处理符合预期。
8. 记录 macOS 与 Windows 的完整桌面冷启动时间和稳定 RSS；任何超出发布预算的结果都阻止提升为 1.0。

## 失败与回滚

- 任一构建、产物校验、哈希生成、Windows 安装或卸载检查失败时，工作流不会创建 GitHub 预发布版本。
- 无签名安装包可能触发 macOS Gatekeeper、Windows SmartScreen 或杀毒软件警告；这是当前候选版的已知分发限制，不等同于功能缺陷。
- 已发布候选版出现阻塞缺陷时，将其标记为非最新预发布并在修复后递增 `rc.N`；不要移动或复用已有标签。
- 安装包版本必须递增，Windows MSI UpgradeCode 保持不变，禁止通过允许降级规避升级问题。
- 候选版不能覆盖稳定 `1.0.0` 标签；稳定发布必须重新执行全部门禁与双平台验证。
