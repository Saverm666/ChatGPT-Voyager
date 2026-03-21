# GPTLatexCopy

这是一个可直接本地加载的 Chrome 插件，基于 Manifest V3，使用原生 HTML / CSS / JavaScript，主要提供 ChatGPT 的公式复制能力，并额外提供 Notion 页面离开确认。

## 当前功能

- 公式点击复制：点击公式即可复制内容
- 公式复制格式可选：
  - `LaTeX`：自动包上 `$...$`
  - `MathML (Word)`：使用内置 Temml 将 LaTeX 本地转换为 MathML
  - `LaTeX (纯文本，无 $ 符号)`：保持源码纯文本
- Enter / Ctrl+Enter 增强：单独 Enter 只换行，Ctrl+Enter 才发送
- Notion 离开确认：关闭、刷新或离开 Notion 页面时弹出确认
- Popup 快速开关：随手启停这些功能
- Options 设置页：集中管理功能开关、公式复制格式与支持站点说明

## 支持站点

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://notion.so/*`
- `https://www.notion.so/*`
- `https://*.notion.so/*`
- `https://*.notion.site/*`

## 目录结构

```text
.
├── manifest.json
├── vendor/
│   └── temml/
│       ├── LICENSE
│       └── temml.min.js
├── background/
│   └── service-worker.js
├── content/
│   ├── content.css
│   └── content.js
├── options/
│   ├── options.css
│   ├── options.html
│   └── options.js
├── popup/
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
└── target.js
```

## 本地加载

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选中当前目录

## 后续改造入口

- 在 `content/content.js` 里继续细化 ChatGPT 的 DOM 适配逻辑
- 在 `popup/popup.js` 里增加更多快捷开关
- 在 `options/options.html` 和 `options/options.js` 里继续细化配置项

## 第三方依赖

- `Temml`：用于在本地把 LaTeX 转成 MathML，许可证见 `vendor/temml/LICENSE`
