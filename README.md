# Solana Quick Trade - Chrome Extension

快捷 Solana 代币交易插件，一键买卖，无需确认。

## 功能特性

- **悬浮面板**: 可拖动的交易面板，不阻挡网页内容
- **一键交易**: 点击即执行，无需二次确认
- **买入预设**: 0.1 / 0.5 / 1 / 1.2 SOL
- **卖出预设**: 10% / 30% / 50% / 100%
- **Jupiter 集成**: 使用 Jupiter V6 API 获取最优路由
- **本地签名**: 私钥仅存储在本地，交易在本地签名

## 安装方法

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹

## 使用说明

### 1. 配置钱包
点击浏览器工具栏的插件图标，在弹出的设置页面中：
- 输入钱包私钥（Base58 格式）
- 选择 RPC 节点
- 设置默认滑点和优先费用
- 点击「保存设置」

### 2. 交易操作
- 在任意网页上会显示悬浮交易面板
- 输入代币合约地址（CA）
- 点击买入/卖出按钮即刻执行交易

### 3. 面板控制
- 拖动标题栏可移动面板位置
- 点击 `-` 按钮最小化面板
- 点击 `🔄` 刷新余额

## 安全提示

⚠️ **重要安全提醒**:
- 私钥仅存储在浏览器本地存储中
- 建议使用小额交易专用钱包
- 不要在不信任的设备上使用
- 定期检查授权和交易记录

## 技术栈

- Chrome Extension Manifest V3
- Jupiter V6 Swap API
- Solana Web3 RPC
- TweetNaCl (Ed25519 签名)

## 项目结构

```
├── manifest.json          # 扩展配置
├── popup/                 # 设置弹窗
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/              # 悬浮面板
│   ├── floating-panel.js
│   └── floating-panel.css
├── background/           # 后台服务
│   └── service-worker.js
├── lib/                  # 加密库
│   └── nacl.js
└── assets/               # 图标
```

## License

MIT
