# Plume 架构

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

本文记录 Plume 当前的架构边界，描述的是已经实现的行为，而不是完整目标产品。计划内容与约束性决策请参阅[产品需求文档](产品需求文档.md)、[开发任务分解](开发任务分解.md)和[架构决策记录](adr/README.md)。

## 设计目标

Plume 优先保证：

- 较小的桌面资源占用与快速交互。
- 优先保证 PostgreSQL 行为准确，而不是追求广泛的数据库兼容性。
- 对凭据和数据修改操作建立明确的安全边界。
- 在增加查询、结果和编辑能力时，各模块仍可独立演进。
- 面对包含大量数据库和对象的服务器时，界面保持响应。

## 系统边界

```text
┌────────────────────────── 桌面应用 ──────────────────────────┐
│                                                            │
│  React UI → 功能 API → Tauri 适配层 → Rust 命令边界         │
│                                         ↓                  │
│                              PostgreSQL 服务与会话          │
│                                         ↓                  │
└────────────────────────────────── PostgreSQL 网络协议 ──────┘
                                          ↓
                                  PostgreSQL 服务器
```

Plume 没有远程应用服务端。桌面进程直接连接 PostgreSQL。

## 依赖方向

```text
React 组件
  → 功能 API
  → 类型化平台适配层
  → Tauri 命令
  → 数据库服务
  → PostgreSQL 驱动
```

依赖指向功能与领域契约。React 组件不直接导入 Tauri API；Tauri 命令处理 IPC 契约转换，但不承载 PostgreSQL 查询逻辑。

## 前端边界

```text
src/
├── app/          全局组合与桌面工作区
├── features/     包含类型、API、UI 和测试的领域功能
├── i18n/         类型化英文与简体中文语言目录
├── platform/     特权运行时适配层
├── shared/       与业务领域无关的小型 UI 原语
└── styles/       全局视觉基础
```

规则：

- 功能模块通过自身 API 调用特权能力。
- 只有 `platform/` 可以导入 `@tauri-apps/api`。
- 可翻译的界面文字来自类型化语言目录。
- 状态默认保留在局部，直到多个独立使用方共享同一生命周期。
- 只有连接会话、标签页和后台任务证明存在需求后，才引入全局状态库。

## Rust 边界

```text
src-tauri/src/
├── commands/      Tauri 命令与响应整形
├── credentials.rs 操作系统凭据适配器
├── database/
│   ├── connection.rs  PostgreSQL 与 TLS 连接建立
│   ├── session.rs     服务器会话与各数据库客户端
│   └── metadata.rs    PostgreSQL 系统目录只读查询
├── error.rs       可安全返回 UI 的稳定错误
├── profiles.rs    版本化连接配置仓库
└── lib.rs         应用组合与命令注册
```

命令边界将内部错误转换为 `authentication_failed`、`session_not_found`、`metadata_error` 等稳定代码。驱动错误只作为技术详情，不是主要 UI 契约。

## 连接与会话生命周期

1. React 校验连接表单；Rust 将非敏感配置保存到 SQLite，将密码保存到操作系统凭据设施。
2. `test_connection_profile` 测试尚未保存的表单修改；编辑表单未填写新密码时，从系统凭据读取原密码。
3. `connect_saved_database` 在 Rust 中解析密码、打开初始客户端并注册服务器会话。
4. React 只接收不透明会话 ID，并管理已断开、连接中、已连接、忙碌、重连中、正在断开和异常状态。应用启动只恢复配置，不恢复会话。
5. 展开其他数据库时，注册表提供对应客户端；已有客户端会复用，否则使用内存中的服务器会话配置新建。
6. `check_database_session` 执行真实健康查询；显式断开会移除该会话拥有的所有数据库客户端。
7. 安全重连会先建立并注册替代会话，再移除旧会话，且不会重放触发断线的操作。

连接配置可跨应用启动保留，PostgreSQL 会话则不会。查询所有权和取消能力仍应继续扩展注册表边界，而不是在命令模块中增加可变会话状态。

## 元数据按需导航

元数据按层级加载：

1. 展开服务器时加载数据库、登录/组角色和表空间。
2. 展开数据库时按需建立客户端并加载对象分类数量。
3. 展开数据库对象分类时加载具体对象。
4. 展开 Schema 时加载常用 Schema 对象。

每个节点独立管理 `idle`、`loading`、`success`、`error` 状态。组件存在期间会缓存已加载数据。这样既不会在连接时读取整个服务器目录，也能形成明确的错误重试边界。

## SSL 语义

| Plume 模式 | PostgreSQL 协商 | 证书校验 | 主机名校验 |
|---|---|---|---|
| `disable` | 只使用明文 | 否 | 否 |
| `prefer` | 优先 TLS，允许回退明文 | 否 | 否 |
| `require` | 必须使用 TLS | 否 | 否 |
| `verify-ca` | 必须使用 TLS | 是 | 否 |
| `verify-full` | 必须使用 TLS | 是 | 是 |

`verify-ca` 和 `verify-full` 要求提供 PEM 根证书路径。React 校验 Schema 与 Rust 连接服务会分别进行校验。

## 安全与隐私不变量

- UI 不直接建立 PostgreSQL Socket。
- 日志中不得出现密码、私钥内容或带凭据的连接 URL。
- 前端只接收不透明会话 ID，不接收长期凭据。
- 涉及用户输入标识符的元数据查询必须参数化。
- 纯浏览器开发环境必须明确拒绝特权操作，不能伪造数据库操作成功。
- 保存的密码使用 macOS Keychain 或 Windows Credential Manager，不进入 SQLite 或序列化配置响应。

## 测试策略

- **类型与静态检查：** TypeScript 严格模式、ESLint、rustfmt，以及拒绝警告的 Clippy。
- **现有自动化测试：** 前端校验、转换、分组与对象树交互测试，以及 Rust 错误、连接、元数据和会话单元测试。
- **PostgreSQL 集成测试：** 使用一次性的 `plume` 与 `plume_secondary` 数据库验证真实连接、跨数据库会话和系统目录查询，Schema 测试数据会自行清理。
- **计划中的端到端测试：** 覆盖产品需求中的十个验收场景。

标准本地门禁：

```bash
npm run check
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

仓库级 `npm run check:all` 会运行完整本地门禁。隔离数据库测试依次使用 `npm run postgres:up`、`npm run test:postgres` 和 `npm run postgres:down`；CI 还会构建未签名的 macOS/Windows 安装包，并在 PostgreSQL 14、16 和 18 上运行测试矩阵。

## 当前限制

- PostgreSQL 会话只保存在内存中，重连始终由用户明确触发。
- 尚未实现 SSH Tunnel。
- 尚未实现查询执行、取消、结果流与事务所有权。
- 尚未实现数据浏览、编辑、导出和对象操作。
- Linux 打包不在首个版本目标内。

这些限制属于产品待办事项，不能成为绕过上述架构边界的理由。
