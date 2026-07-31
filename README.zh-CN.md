<div align="center">

# Plume

**一个清爽、轻量的 PostgreSQL 桌面工作台。**

[English](README.md) · [简体中文](README.zh-CN.md)

![项目状态](https://img.shields.io/badge/status-预发布-D97706)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![许可证](https://img.shields.io/badge/license-MIT-2F6D52)

</div>

Plume 是一款本地优先的 PostgreSQL 管理工具，面向希望摆脱大型通用数据库客户端复杂性的开发者。桌面应用直接连接 PostgreSQL；你与数据库之间没有 Plume 账号、云端中转或远程应用服务。

> [!IMPORTANT]
> Plume 仍是预发布软件。1.0 功能范围已经实现并进入发布验证，但尚未发布已签名的稳定安装包。

## 为什么选择 Plume

- **原生理解 PostgreSQL：** 按服务器、数据库、角色、表空间、数据库级对象、Schema 与 Schema 对象建模，而不是将所有内容压成通用数据库树。
- **从架构上保持轻量：** Tauri 与 Rust 负责系统权限和数据库工作，React 专注于界面呈现。
- **本地优先：** 数据库流量从桌面进程直接发送到 PostgreSQL。
- **按需加载：** 只有展开树节点时才读取元数据，其他数据库的客户端也只在需要时建立。
- **安全边界明确：** 连接建立后密码不会返回 React，也不会写入普通配置文件。
- **双语基础：** 当前界面支持英文与简体中文。

## 当前可用能力

- 可保存的 PostgreSQL 连接配置；密码进入 Keychain/Credential Manager，并支持 SSL、SSH Tunnel、跳板机与分类连接错误。
- PostgreSQL 14、16、18 集成测试覆盖连接、元数据、查询、取消、TLS、SSH 与事务编辑。
- 内存服务器会话，同一服务器中的每个数据库都按需建立独立客户端，并提供 pgAdmin 风格的服务器导航：

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

- SQL 编辑器支持语句定位、异步补全、草稿、执行反馈、取消、诊断、历史与危险操作确认。
- 虚拟化类型化结果支持返回限制、复制、可取消 CSV/JSON 导出与原子文件写入。
- 表数据支持稳定分页、排序、参数化筛选，以及暂存新增/修改/删除、变更预览、事务提交、回滚与离开保护。
- 本地设置、历史、草稿和会话快照均版本化，支持保留策略、安全恢复和选择性清理。
- 英文与简体中文 UI、键盘工作流，以及浅色/深色主题。

## 路线图

| 能力 | 状态 |
|---|---|
| 1.0 核心数据库工作流 | 已实现，正在发布验证 |
| macOS 与 Windows 签名安装包 | 已配置，需要外部签名凭据 |
| `EXPLAIN` 可视化 | 1.0 后候选 |
| 云 IAM、自动更新与 Linux 发布 | 后续候选 |

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

React 不直接连接 PostgreSQL。Rust 负责数据库会话、TLS/SSH、元数据与数据查询、查询取消、事务写入、凭据访问、本地存储和导出文件能力。两侧通过稳定且可序列化的命令错误进行通信。

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
npm run check:all
```

`npm install` 会配置仅作用于当前仓库的 Git hook，并在每次提交前运行同一套检查。若仓库克隆于该配置加入之前，请执行一次 `npm run hooks:install`。

通过一次性本地环境运行 PostgreSQL 集成测试：

```bash
npm run postgres:up
npm run test:postgres
npm run postgres:down
```

Compose 环境默认监听本机 `55432` 端口，并创建 `plume` 和 `plume_secondary` 两个测试数据库。可通过 `PLUME_POSTGRES_VERSION` 和 `PLUME_POSTGRES_PORT` 调整镜像版本和本地端口；CI 使用同一套用例验证 PostgreSQL 14、16 和 18。

构建桌面安装包：

```bash
npm run tauri build
```

完整源码构建与测试说明见[构建指南](BUILDING.md)；[macOS](docs/macos-release.md) 与 [Windows](docs/windows-release.md) 发布指南记录了签名构建、所需仓库 Secret 与产物验证流程。

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
├── adr/                  架构决策记录
├── architecture.md       英文架构文档
├── architecture.zh-CN.md 简体中文架构文档
├── 产品需求文档.md         产品需求
└── 开发任务分解.md         按优先级拆分的开发任务

tests/postgres/            可重复运行的 PostgreSQL 集成测试数据
```

## 隐私与安全

- 不需要账号或远程 Plume 服务。
- 密码不会写入普通配置文件。
- 默认不采集 SQL、查询结果、连接地址或数据库元数据。
- 日志和界面错误不得包含密码、私钥或带凭据的连接 URL。
- 连接配置、草稿、历史、设置与会话布局保存在本地，秘密值仍由操作系统凭据设施保存；活动数据库会话和结果集只存在于内存中。

支持版本与私密漏洞报告方式见[安全政策](SECURITY.md)。请勿在公开 Issue 中报告漏洞。

## 参与贡献

创建 Issue 或 Pull Request 前请阅读[贡献指南](CONTRIBUTING.md)；所有参与者均须遵守[行为准则](CODE_OF_CONDUCT.md)。

## 许可证

Plume 使用 [MIT License](LICENSE)。
依赖清单与发布时的许可证报告规则见[第三方软件声明](THIRD_PARTY_NOTICES.md)。
