# dsh-quick-fork

简体中文 | [English](README.en.md)

在对话中划选文字，点「复创」，在右侧栏打开一个**临时侧边对话**。

> 版本 `0.3.0`。侧聊使用原生右栏 tab，但面板是新实现的精简侧聊；
> 不是主对话组件的直接复用。

## 为什么

读代码或评审方案时，经常想对某一句话追问，但不希望打断主线。`dsh-quick-fork`
把这一步变成：

1. 选中主对话里的一段文字
2. 点击浮出的「复创」
3. 右侧栏出现临时对话，选中文本作为引用
4. 第一次发送时，引用会作为上下文自动带入；之后不会重复携带
5. 关掉标签或退出应用后，它从视图中消失

## 当前实现

- `shell.overlay` 里监听选区，在选区上方显示「复创」按钮
- 点击后通过 `sessions.create({ cwd })` 创建空白子会话（不复制父会话历史）
- 注册原生右侧栏 tab 类型，打开一个 `quick-fork` tab
- tab 面板显示：选中引用、Markdown 消息列表、输入框、发送/停止
- 第一条消息自动把选中引用作为 Markdown 引用块带入
- 打开面板后自动聚焦输入框
- 子会话在 tab 打开期间保持活跃；`dsh-sidebar-sections` 会把它从侧边栏隐藏
- 关闭 tab 时 archive 并清理本地 meta
- 应用重启后，恢复的 tab 没有当前运行标记，会直接关闭，不会再次 fork
- 选中区域位于侧聊面板内时不再显示「复创」，避免递归创建

## 数据与边界

- 临时会话仍是真实 DSH Session，会写入宿主会话存储，但被侧边栏过滤隐藏
- 关闭时只 archive，不是物理删除；可在归档中恢复
- 选中文字只保存在 tab 的导航参数/本地 meta，不进入主会话
- 面板不实现附件、审批、模型选择等完整主对话能力（后续迭代）

## 安装

```text
plugin_manager(action="install_bundle", target="<monorepo>/packages/dsh-quick-fork")
```

或使用主仓库安装脚本：

```powershell
node scripts/install-all.mjs
```

安装后完全退出 DSH 再启动。

## 已知限制

- 0.1.0 是精简侧聊，不是主对话的完整复刻
- 依赖 DSH 右栏 tab 类型、Session create API 和 dsh-sidebar-sections 的临时会话过滤；DSH 升级后需要跟随适配
- 应用关闭时打开的临时 tab 会在下次启动时自动关闭；子会话保留为归档
- 不继承父会话历史；侧聊的上下文只有选中引用和后续追问
- 不递归：侧聊面板内不显示「复创」

## 开发与测试

```sh
node scripts/check.mjs
```

零依赖测试覆盖清单、bundle patch、locale、icon、参数解析、消息映射、tab 定义、
选择门控和引用上下文，共 12 项检查。

## 许可证

[MIT](LICENSE)
