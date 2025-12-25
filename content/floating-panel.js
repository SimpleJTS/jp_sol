// Solana Quick Trade - 悬浮面板 Content Script

(function() {
  'use strict';

  // 防止重复注入
  if (window.__sqtInjected) return;
  window.__sqtInjected = true;

  // 状态
  let panelState = {
    isMinimized: false,
    position: { x: null, y: null },
    currentCA: '',
    solBalance: 0,
    tokenBalance: 0,
    tokenInfo: null,
    isWalletConfigured: false
  };

  // 买入预设 (SOL)
  const BUY_PRESETS = [0.1, 0.5, 1, 1.2];
  // 卖出预设 (百分比)
  const SELL_PRESETS = [10, 30, 50, 100];

  // 创建面板
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'sqt-floating-panel';

    panel.innerHTML = `
      <div class="sqt-header">
        <div class="sqt-header-title">⚡ Quick Trade</div>
        <span class="sqt-mini-icon">⚡</span>
        <div class="sqt-header-btns">
          <button class="sqt-header-btn sqt-minimize" title="最小化">−</button>
          <button class="sqt-header-btn sqt-refresh" title="刷新余额">🔄</button>
        </div>
      </div>
      <div class="sqt-content">
        <div class="sqt-main-content">
          <!-- 余额显示 -->
          <div class="sqt-balance">
            <div class="sqt-balance-item">
              <div class="sqt-balance-label">SOL 余额</div>
              <div class="sqt-balance-value sol" id="sqt-sol-balance">0.00</div>
            </div>
            <div class="sqt-balance-item">
              <div class="sqt-balance-label">Token 余额</div>
              <div class="sqt-balance-value token" id="sqt-token-balance">-</div>
            </div>
          </div>

          <!-- CA 输入 -->
          <div class="sqt-ca-input">
            <input type="text" id="sqt-ca" placeholder="输入代币合约地址 (CA)">
            <button class="sqt-paste-btn" id="sqt-paste" title="粘贴">📋</button>
          </div>

          <!-- Token 信息 -->
          <div class="sqt-token-info" id="sqt-token-info">
            <div class="sqt-token-name" id="sqt-token-name">-</div>
            <div class="sqt-token-price" id="sqt-token-price">-</div>
          </div>

          <!-- 买入区域 -->
          <div class="sqt-buy-section">
            <div class="sqt-section-title">🟢 买入 (SOL)</div>
            <div class="sqt-btn-group" id="sqt-buy-btns">
              ${BUY_PRESETS.map(amount => `
                <button class="sqt-trade-btn buy" data-amount="${amount}">${amount}</button>
              `).join('')}
            </div>
            <div class="sqt-custom-buy">
              <input type="number" id="sqt-custom-amount" placeholder="自定义" min="0.01" step="0.01">
              <button class="sqt-trade-btn buy" id="sqt-custom-buy-btn">买入</button>
            </div>
          </div>

          <!-- 卖出区域 -->
          <div class="sqt-sell-section">
            <div class="sqt-section-title">🔴 卖出 (%)</div>
            <div class="sqt-btn-group" id="sqt-sell-btns">
              ${SELL_PRESETS.map(pct => `
                <button class="sqt-trade-btn sell" data-percent="${pct}">${pct}%</button>
              `).join('')}
            </div>
          </div>

          <!-- 状态消息 -->
          <div class="sqt-status" id="sqt-status"></div>
        </div>

        <!-- 未配置钱包提示 -->
        <div class="sqt-no-wallet" id="sqt-no-wallet" style="display:none;">
          <p>⚠️ 请先配置钱包</p>
          <button class="sqt-open-settings" id="sqt-open-settings">打开设置</button>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    return panel;
  }

  // 初始化拖动
  function initDrag(panel) {
    const header = panel.querySelector('.sqt-header');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.sqt-header-btn')) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = panel.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      e.preventDefault();
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newX = initialX + deltaX;
      let newY = initialY + deltaY;

      // 边界限制
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      panel.style.left = newX + 'px';
      panel.style.top = newY + 'px';
      panel.style.right = 'auto';

      panelState.position = { x: newX, y: newY };
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = 'all 0.3s ease';
        // 保存位置
        savePosition();
      }
    });
  }

  // 保存位置到 storage
  function savePosition() {
    chrome.storage.local.get('solanaQuickTrade', (result) => {
      const settings = result.solanaQuickTrade || {};
      settings.panelPosition = panelState.position;
      chrome.storage.local.set({ solanaQuickTrade: settings });
    });
  }

  // 加载位置
  function loadPosition(panel) {
    chrome.storage.local.get('solanaQuickTrade', (result) => {
      const settings = result.solanaQuickTrade || {};
      if (settings.panelPosition && settings.panelPosition.x !== null) {
        panel.style.left = settings.panelPosition.x + 'px';
        panel.style.top = settings.panelPosition.y + 'px';
        panel.style.right = 'auto';
        panelState.position = settings.panelPosition;
      }
    });
  }

  // 初始化事件
  function initEvents(panel) {
    // 最小化
    panel.querySelector('.sqt-minimize').addEventListener('click', () => {
      panelState.isMinimized = !panelState.isMinimized;
      panel.classList.toggle('minimized', panelState.isMinimized);
    });

    // 点击最小化的面板展开
    panel.addEventListener('click', (e) => {
      if (panelState.isMinimized && !e.target.closest('.sqt-header-btn')) {
        panelState.isMinimized = false;
        panel.classList.remove('minimized');
      }
    });

    // 刷新余额
    panel.querySelector('.sqt-refresh').addEventListener('click', refreshBalances);

    // 粘贴按钮
    panel.querySelector('#sqt-paste').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const caInput = panel.querySelector('#sqt-ca');
        caInput.value = text.trim();
        handleCAChange(text.trim());
      } catch (err) {
        showStatus('无法读取剪贴板', 'error');
      }
    });

    // CA 输入变化
    const caInput = panel.querySelector('#sqt-ca');
    let caTimeout;
    caInput.addEventListener('input', (e) => {
      clearTimeout(caTimeout);
      caTimeout = setTimeout(() => {
        handleCAChange(e.target.value.trim());
      }, 500);
    });

    // 买入按钮
    panel.querySelectorAll('#sqt-buy-btns .sqt-trade-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const amount = parseFloat(btn.dataset.amount);
        await executeTrade('buy', amount);
      });
    });

    // 自定义买入
    const customBuyBtn = panel.querySelector('#sqt-custom-buy-btn');
    const customAmountInput = panel.querySelector('#sqt-custom-amount');

    customBuyBtn.addEventListener('click', async () => {
      const amount = parseFloat(customAmountInput.value);
      if (!amount || amount <= 0) {
        showStatus('请输入有效金额', 'error');
        return;
      }
      await executeTrade('buy', amount, customBuyBtn);
    });

    // 回车键触发买入
    customAmountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        customBuyBtn.click();
      }
    });

    // 卖出按钮
    panel.querySelectorAll('#sqt-sell-btns .sqt-trade-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const percent = parseInt(btn.dataset.percent);
        await executeTrade('sell', percent);
      });
    });

    // 打开设置
    panel.querySelector('#sqt-open-settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });
  }

  // 处理 CA 变化
  async function handleCAChange(ca) {
    panelState.currentCA = ca;

    if (!ca || ca.length < 32) {
      document.getElementById('sqt-token-info').classList.remove('visible');
      document.getElementById('sqt-token-balance').textContent = '-';
      return;
    }

    showStatus('正在获取代币信息...', 'info');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TOKEN_INFO',
        tokenCA: ca
      });

      if (response.success) {
        panelState.tokenInfo = response.tokenInfo;
        panelState.tokenBalance = response.balance || 0;

        const tokenInfoDiv = document.getElementById('sqt-token-info');
        tokenInfoDiv.classList.add('visible');
        document.getElementById('sqt-token-name').textContent = response.tokenInfo.symbol || 'Unknown';
        document.getElementById('sqt-token-price').textContent = response.tokenInfo.price ?
          `$${response.tokenInfo.price.toFixed(8)}` : '价格未知';
        document.getElementById('sqt-token-balance').textContent = formatNumber(response.balance);

        hideStatus();
      } else {
        showStatus(response.error || '获取代币信息失败', 'error');
      }
    } catch (err) {
      showStatus('获取代币信息失败: ' + err.message, 'error');
    }
  }

  // 执行交易
  async function executeTrade(type, value, customBtn = null) {
    if (!panelState.currentCA) {
      showStatus('请先输入代币合约地址', 'error');
      return;
    }

    if (!panelState.isWalletConfigured) {
      showStatus('请先配置钱包', 'error');
      return;
    }

    // 找到对应按钮并显示loading
    let btn = customBtn;
    if (!btn) {
      const btnSelector = type === 'buy' ?
        `#sqt-buy-btns .sqt-trade-btn[data-amount="${value}"]` :
        `#sqt-sell-btns .sqt-trade-btn[data-percent="${value}"]`;
      btn = document.querySelector(btnSelector);
    }

    if (btn) {
      btn.classList.add('loading');
      btn.disabled = true;
    }

    const actionText = type === 'buy' ? `买入 ${value} SOL` : `卖出 ${value}%`;
    showStatus(`正在${actionText}...`, 'info');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXECUTE_TRADE',
        tradeType: type,
        tokenCA: panelState.currentCA,
        amount: value
      });

      if (response.success) {
        const txLink = `https://solscan.io/tx/${response.signature}`;
        showStatus(`交易成功! <a href="${txLink}" target="_blank">查看</a>`, 'success');
        // 刷新余额
        setTimeout(refreshBalances, 2000);
      } else {
        showStatus(response.error || '交易失败', 'error');
      }
    } catch (err) {
      showStatus('交易失败: ' + err.message, 'error');
    } finally {
      if (btn) {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    }
  }

  // 刷新余额
  async function refreshBalances() {
    const refreshBtn = document.querySelector('.sqt-refresh');
    if (refreshBtn) {
      refreshBtn.classList.add('spinning');
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_BALANCES',
        tokenCA: panelState.currentCA
      });

      if (response.success) {
        panelState.solBalance = response.solBalance;
        panelState.tokenBalance = response.tokenBalance || 0;

        document.getElementById('sqt-sol-balance').textContent = response.solBalance.toFixed(4);
        if (panelState.currentCA) {
          document.getElementById('sqt-token-balance').textContent = formatNumber(response.tokenBalance);
        }
      }
    } catch (err) {
      console.error('刷新余额失败:', err);
    } finally {
      if (refreshBtn) {
        refreshBtn.classList.remove('spinning');
      }
    }
  }

  // 显示状态
  function showStatus(message, type) {
    const statusDiv = document.getElementById('sqt-status');
    statusDiv.innerHTML = message;
    statusDiv.className = 'sqt-status visible ' + type;
  }

  // 隐藏状态
  function hideStatus() {
    const statusDiv = document.getElementById('sqt-status');
    statusDiv.className = 'sqt-status';
  }

  // 格式化数字
  function formatNumber(num) {
    if (!num || num === 0) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toFixed(4);
  }

  // 检查钱包配置
  async function checkWalletConfig() {
    try {
      const result = await chrome.storage.local.get('solanaQuickTrade');
      const settings = result.solanaQuickTrade;

      if (settings && settings.privateKey) {
        panelState.isWalletConfigured = true;
        document.getElementById('sqt-no-wallet').style.display = 'none';
        document.querySelector('.sqt-main-content').style.display = 'block';
        // 获取初始余额
        refreshBalances();
      } else {
        panelState.isWalletConfigured = false;
        document.getElementById('sqt-no-wallet').style.display = 'block';
        document.querySelector('.sqt-main-content').style.display = 'none';
      }
    } catch (err) {
      console.error('检查钱包配置失败:', err);
    }
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SETTINGS_UPDATED') {
      checkWalletConfig();
    } else if (message.type === 'TOGGLE_PANEL') {
      const panel = document.getElementById('sqt-floating-panel');
      if (panel) {
        panel.style.display = message.show ? 'block' : 'none';
      }
    }
    return true;
  });

  // 初始化
  function init() {
    const panel = createPanel();
    initDrag(panel);
    initEvents(panel);
    loadPosition(panel);
    checkWalletConfig();
  }

  // 等待 DOM 准备就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
