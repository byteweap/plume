<div align="center">

# Plume

**一个清爽、轻量的 PostgreSQL 桌面工作台。**

[English](README.md) · [简体中文](README.zh-CN.md)

![项目状态](https://img.shields.io/badge/status-早期开发-D97706)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![许可证](https://img.shields.io/badge/license-MIT-2F6D52)

</div>

Plume 是一款本地优先的 PostgreSQL 管理工具，面向希望摆脱大型通用数据库客户端复杂性的开发者。桌面应用直接连接 PostgreSQL；你与数据库之间没有 Plume 账号、云端中转或远程应用服务。

> [!IMPORTANT]
> Plume 仍处于早期开发阶段。连接管理和 PostgreSQL 对象导航目前已经可用；SQL 编辑器、数据浏览与数据编辑流程仍在开发中。

## 为什么选择 Plume

- **原生理解 PostgreSQL：** 按服务器、数据库、角色、表空间、数据库级对象、Schema 与 Schema 对象建模，而不是将所有内容压成通用数据库树。
- **从架构上保持轻量：** Tauri 与 Rust 负责系统权限和数据库工作，React 专注于界面呈现。
- **本地优先：** 数据库流量从桌面进程直接发送到 PostgreSQL。
- **按需加载：** 只有展开树节点时才读取元数据，其他数据库的客户端也只在需要时建立。
- **安全边界明确：** 连接建立后密码不会返回 React，也不会写入普通配置文件。
- **双语基础：** 当前界面支持英文与简体中文。

## 当前可用能力

- 带有字段校验和分类错误提示的 PostgreSQL 连接表单。
- 支持 PostgreSQL 14 及以上版本；开发期间已使用 PostgreSQL 18 验证。
- SSL 模式：`disable`、`prefer`、`require`、`verify-ca`、`verify-full`。
- 内存服务器会话，同一服务器中的每个数据库都可按需建立独立客户端。
- pgAdmin 风格的服务器导航：

```text
服务器
├── Databases
│   └── Database
│       ├── Casts
│       ├── Catalogs
│       ├── Event Triggers
│       ├── Extensions
│       ├── Foreign Data Wrappers
│       ├── Languages
│       ├── Publications
│       ├── Schemas
│       │   └── Schema
│       │       ├── Tables / Foreign Tables
│       │       ├── Views / Materialized Views
│       │       ├── Sequences
│       │       ├── Functions / Procedures
│       │       └── Types
│       └── Subscriptions
├── Login/Group Roles
└── Tablespaces
```

- 对象树具备加载中、空状态、错误、重试与对象数量状态。
- 英文与简体中文 UI 词条。
- 浅色、深色外观基础。

## 路线图

| 能力 | 状态 |
|---|---|
| 数据库直连与 SSL | 已可用 |
| 多数据库对象导航 | 已可用 |
| 系统安全凭据存储 | MVP 计划 |
| SSH Tunnel | MVP 计划 |
| SQL 编辑、执行与取消 | MVP 计划 |
| 查询结果与导出 | MVP 计划 |
| 表数据浏览与安全编辑 | MVP 计划 |
| `EXPLAIN` 可视化 | 核心流程完成后开发 |
| 云 IAM 认证与 Linux 发布 | 后续候选 |

详细产品范围记录在[产品需求文档](docs/产品需求文档.md)和[开发任务分解](docs/开发任务分解.md)中。

## 架构

```text
React UI
  → 功能 API
  → 类型化 Tauri 适配层
  → Rust 命令边界
  → PostgreSQL 服务与会话注册表
  → PostgreSQL
```

React 不直接连接 PostgreSQL。Rust 负责数据库会话、TLS、元数据查询，以及未来的查询取消、凭据访问和文件系统能力。两侧通过稳定且可序列化的命令错误进行通信。

模块边界、会话生命周期、SSL 语义与测试策略详见[中文架构文档](docs/architecture.zh-CN.md)，同时提供[英文版本](docs/architecture.md)。

## 开始开发

### 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- 当前稳定版 Rust 工具链
- 对应操作系统的 [Tauri 2 环境依赖](https://v2.tauri.app/start/prerequisites/)
- 进行数据库集成开发时，需要一个可访问的 PostgreSQL 14+ 实例

Plume 当前以 macOS 和 Windows 为首发目标，Linux 打包不在首个版本范围内。

### 启动桌面应用

```bash
git clone https://github.com/byteweap/plume.git
cd plume
npm install
npm run tauri dev
```

只开发界面时，可以单独启动 Vite 前端：

```bash
npm run dev
```

浏览器版本适合布局开发，但数据库特权命令会明确返回 `desktop_required`。数据库行为必须通过 Tauri 验证；Plume 不会在浏览器模式伪造成功的数据库操作。

### 质量检查

```bash
npm run check
npm run build
```

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

构建桌面安装包：

```bash
npm run tauri build
```

## 仓库结构

```text
src/
├── app/                  应用壳与全局组合
├── features/             按产品领域组织的功能模块
├── i18n/                 类型化语言目录与上下文
├── platform/             Tauri 与操作系统适配层
├── shared/               小型通用 UI 原语
└── styles/               全局样式与设计基础

src-tauri/src/
├── commands/             稳定的 IPC 命令边界
├── database/             PostgreSQL 连接、会话与元数据
└── error.rs              返回 UI 的安全结构化错误

docs/
├── architecture.md       英文架构文档
├── architecture.zh-CN.md 简体中文架构文档
├── 产品需求文档.md         产品需求
└── 开发任务分解.md         按优先级拆分的开发任务
```

## 隐私与安全

- 不需要账号或远程 Plume 服务。
- 密码不会写入普通配置文件。
- 默认不采集 SQL、查询结果、连接地址或数据库元数据。
- 日志和界面错误不得包含密码、私钥或带凭据的连接 URL。
- 连接配置和活动会话目前只保存在内存中，退出 Plume 后即消失。

安全问题请通过 [GitHub Security Advisories](https://github.com/byteweap/plume/security/advisories/new) 提交，不要创建公开 Issue。

## 参与贡献

Plume 仍处于架构形成阶段，小而聚焦的修改比大范围重写更容易审查。提交 Pull Request 前请：

1. 查看[开发任务分解](docs/开发任务分解.md)与现有 [Issues](https://github.com/byteweap/plume/issues)。
2. 遵守 React、Tauri 命令和 PostgreSQL 服务之间的模块边界。
3. 为行为变化新增或更新测试。
4. 运行上方列出的前端与 Rust 质量检查。
5. 保持英文与简体中文用户文案同步。

## 许可证

Plume 使用 [MIT License](LICENSE)。
