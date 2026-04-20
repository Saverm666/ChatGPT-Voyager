# ChatGPT-Voyager

ChatGPT-Voyager 是一个可直接本地加载的 Chrome 扩展，基于 Manifest V3 和原生 HTML / CSS / JavaScript 实现，面向 ChatGPT 与 Notion 提供一组轻量但高频的效率增强能力。

它的目标很直接：

- 在 ChatGPT 页面里更顺手地复制公式
- 在长对话里通过时间线快速定位和跳转消息
- 把常用提示词收纳起来，随时一键复用
- 调整输入行为，让 `Enter` / `Ctrl+Enter` 更符合写长内容时的习惯
- 在 Notion 页面离开、刷新或关闭前给出确认

整个项目无需构建工具、无需后端服务，下载后即可通过浏览器“加载已解压的扩展程序”直接使用。

## 适合谁

- 经常在 ChatGPT 中阅读或整理数学公式、技术公式的人
- 经常处理很长的 ChatGPT 对话，需要快速跳转到历史消息的人
- 需要反复复用固定提示词的人
- 希望把 ChatGPT 输入框行为调整成“`Enter` 换行、`Ctrl+Enter` 发送”的人
- 使用 Notion 时担心误关闭页面的人

## 核心能力

### ChatGPT 页面

- 公式点击复制
  - 支持识别页面中的 KaTeX / MathJax / MathML 等常见公式结构
  - 点击公式即可直接复制，不需要手动框选
- 多种公式复制格式
  - `LaTeX`：复制为 `$...$`
  - `UnicodeMath (Word)`：本地将 LaTeX 转换为 UnicodeMath
  - `LaTeX (纯文本，无 $ 符号)`：保留源码文本
- 公式复制历史
  - 自动保存最近复制的公式
  - 在 Popup、设置页和页内入口中可再次快速复制
  - 历史记录带有时间信息，并支持公式预览
- 页内快捷入口
  - 会在 ChatGPT 顶部操作区附近挂载 `ChatGPT-Voyager` 按钮
  - 打开后可直接查看提示词收藏与公式历史
  - 支持在页内新建、编辑、删除提示词
- 提示词收藏
  - 保存提示词名称与内容
  - 在 Popup、设置页和 ChatGPT 页内入口中一键复制
  - 页内入口支持左键复制、右键编辑
- `Enter / Ctrl+Enter` 输入增强
  - 单独 `Enter` 用于换行
  - `Ctrl+Enter` 用于发送
  - 适合长提示词、多段文本和代码输入场景
- GPT 会话时间线
  - 在 ChatGPT 对话右侧显示用户消息时间线
  - 点击节点即可跳转到对应轮次
  - 长按节点可对消息加星标，便于回看重点内容

### Notion 页面

- 离开确认
  - 当页面关闭、刷新或跳转时弹出确认提示
  - 适合编辑中、复制中或临时整理内容时防止误操作
- LaTeX 公式批量转换
  - 在 Notion 页面按 `Ctrl+Alt+M`，可将页面中的 `$...$` 与 `$$...$$` 转成 Notion 原生公式
  - 此能力基于开源项目 [voidCounter/noeqtion](https://github.com/voidCounter/noeqtion) 的实现思路接入
  - 当你在 Notion 中粘贴的文本里包含 `$` 或 `$$` 时，扩展也会自动延迟触发一次转换，并尝试收起粘贴后的建议操作菜单
  - 对于较长的块级公式，扩展会等待公式输入框就绪后分段写入，以提高转换稳定性

## 支持站点

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://notion.so/*`
- `https://www.notion.so/*`
- `https://*.notion.so/*`
- `https://*.notion.site/*`

说明：

- ChatGPT 页面支持公式复制、GPT 会话时间线、提示词入口与 `Enter / Ctrl+Enter` 增强
- Notion 页面支持离开确认与 LaTeX 公式批量转换
- 其他站点默认不会注入这些功能

## 安装方式

### 本地加载

1. 下载或克隆本仓库到本地
2. 打开 Chrome，进入 `chrome://extensions/`
3. 打开右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择当前仓库根目录

加载完成后，浏览器工具栏中会出现 `ChatGPT-Voyager` 图标。

### 更新方式

项目是本地加载模式，没有打包流程。更新代码后通常只需要两步：

1. 在 `chrome://extensions/` 页面点击该扩展的“重新加载”
2. 回到目标网页刷新当前标签页

如果扩展刚被重载，已打开的页面偶尔会出现“扩展上下文已失效”的提示，此时刷新页面即可恢复。

## 如何使用

### 1. 在 ChatGPT 中复制公式

1. 打开任意包含数学公式的 ChatGPT 对话
2. 点击页面中的公式
3. 扩展会按当前设置的格式把内容复制到剪贴板
4. 最近复制过的公式会自动写入历史记录

### 2. 调整公式复制格式

可通过以下任一入口切换：

- 浏览器工具栏里的 Popup
- 完整设置页

可选格式：

- `LaTeX`
- `UnicodeMath (Word)`
- `LaTeX (纯文本，无 $ 符号)`

### 3. 使用 GPT 会话时间线

在 ChatGPT 对话页右侧会显示一条时间线。你可以：

- 点击节点跳转到对应用户消息
- 观察当前滚动位置对应的高亮节点
- 长按节点给当前消息加星或取消星标

### 4. 使用页内快捷入口

在 ChatGPT 页面顶部会出现 `ChatGPT-Voyager` 按钮。点击后可以：

- 查看提示词收藏
- 查看最近公式复制历史
- 直接复制提示词
- 新建、编辑、删除提示词
- 跳转到完整设置页

### 5. 使用 Popup 快速操作

点击扩展图标后可以直接完成这些操作：

- 查看当前页面是否属于支持站点
- 打开或关闭各功能模块
- 切换公式复制格式
- 从历史记录中再次复制公式
- 从收藏列表中复制提示词
- 打开完整设置页

### 6. 使用设置页做集中管理

设置页适合做较完整的配置维护，包括：

- 管理提示词收藏
- 查看和清空公式历史
- 保存全局功能开关
- 打开或关闭 GPT 会话时间线
- 调整默认公式复制格式

## 数据与权限说明

ChatGPT-Voyager 只申请了最小化的本地权限：

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存功能开关、公式复制历史、提示词收藏等本地数据 |
| `tabs` | 在 Popup 中读取当前活动标签页信息，并判断当前站点支持情况 |

另外还使用了 `web_accessible_resources` 暴露 KaTeX 字体文件，用于受支持页面中的公式预览渲染。

当前实现特点：

- 不依赖构建系统
- 不依赖自建后端
- 项目代码本身不要求登录额外账号
- 提示词、历史记录和设置数据保存在 `chrome.storage.local`
- GPT 时间线星标默认按对话存放在 ChatGPT 站点的 `localStorage`

## 项目结构

```text
.
├── README.md
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── content.css
│   ├── content.js
│   ├── timeline.css
│   └── timeline.js
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── options/
│   ├── options.css
│   ├── options.html
│   └── options.js
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── shared/
│   └── shared.js
├── references/
│   └── chatgpt-conversation-timeline/
└── vendor/
    ├── katex/
    └── tex-to-unicode/
```

## 代码模块说明

### `manifest.json`

- 定义扩展名称、版本、权限、图标和注入规则
- 目前基于 Manifest V3

### `background/service-worker.js`

- 初始化默认配置
- 处理打开设置页等运行时消息

### `content/content.js`

这是扩展的核心逻辑，主要包含四类能力：

- 公式点击复制
- ChatGPT 输入增强
- Notion 离开确认
- Notion LaTeX 公式批量转换
- ChatGPT 页内快捷入口与浮层面板

### `content/timeline.js`

- GPT 会话时间线逻辑
- 负责消息节点识别、滚动同步、跳转和星标持久化

### `content/timeline.css`

- GPT 会话时间线样式
- 包含节点、提示浮层和滚动滑块视觉定义

### `shared/shared.js`

- 放置全局常量、默认设置、数据规整逻辑和通用工具函数
- 供 `background`、`content`、`popup`、`options` 复用

### `popup/`

- 浏览器工具栏弹窗
- 负责站点状态展示、快速开关、历史记录和提示词快捷复制

### `options/`

- 完整配置页
- 适合集中维护设置、历史记录和提示词数据

### `vendor/`

- `katex/`：用于公式预览渲染
- `tex-to-unicode/`：用于把 LaTeX 转为 UnicodeMath

## 开发与调试

这个项目使用原生前端结构，没有打包步骤，开发流程很简单：

1. 修改本地文件
2. 到 `chrome://extensions/` 重新加载扩展
3. 刷新目标网页
4. 继续调试

常见调试入口：

- 扩展详情页里的 Service Worker 调试器
- 目标网页 DevTools 中的 Content Script 上下文
- Popup 与 Options 页面自身的 DevTools

如果后续继续扩展，通常可以从这些位置入手：

- `content/content.js`
  - 继续细化 ChatGPT DOM 适配逻辑
  - 扩展支持站点或增强页内入口
- `content/timeline.js`
  - 调整时间线节点识别、跳转和星标行为
- `popup/popup.js`
  - 增加更多快捷操作和状态展示
- `options/options.js`
  - 增加更多设置项、导入导出、批量管理等功能
- `shared/shared.js`
  - 把重复逻辑继续抽成共享工具

## 已知限制

- 公式识别和页内按钮挂载依赖目标站点当前 DOM 结构；如果 ChatGPT 页面结构变化，可能需要同步调整选择器或挂载策略
- GPT 时间线同样依赖 ChatGPT 当前对话 DOM 结构；若页面结构调整，可能需要同步更新节点选择器
- `UnicodeMath (Word)` 转换依赖内置转换器，并非所有 LaTeX 宏都能完整覆盖
- Notion 离开确认依赖浏览器 `beforeunload` 机制，体验会受浏览器策略限制
- 当前支持站点范围有明确边界，并不会自动注入所有 AI 聊天网站

## 第三方依赖

- `KaTeX`
  - 用于历史记录和面板中的公式预览
  - 相关文件位于 `vendor/katex/`
- `tex-to-unicode`
  - 用于本地 LaTeX -> UnicodeMath 转换
  - 相关文件位于 `vendor/tex-to-unicode/`
  - 许可证见 `vendor/tex-to-unicode/LICENSE`
- `chatgpt-conversation-timeline`
  - 用作 GPT 时间线功能的参考实现
  - 参考仓库位于 `references/chatgpt-conversation-timeline/`
- `noeqtion`
  - 用作 Notion LaTeX 公式批量转换的实现参考
  - 参考仓库为 [voidCounter/noeqtion](https://github.com/voidCounter/noeqtion)

## 后续可扩展方向

- 增加更多站点适配
- 支持提示词分组、搜索和排序
- 支持历史记录导出与清理策略
- 增加更多公式复制格式
- 为页内入口加入更细的交互与状态提示

如果你想把它继续做成一个更完整的个人效率插件，这个仓库已经具备一个比较清晰的原生扩展基础。
