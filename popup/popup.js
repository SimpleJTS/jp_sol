// Popup 设置页面逻辑

// DOM 元素
const privateKeyInput = document.getElementById('privateKey');
const toggleKeyBtn = document.getElementById('toggleKey');
const jupiterApiKeyInput = document.getElementById('jupiterApiKey');
const rpcSelect = document.getElementById('rpcEndpoint');
const heliusApiKeyInput = document.getElementById('heliusApiKey');
const customRpcInput = document.getElementById('customRpc');
const slippageBtns = document.querySelectorAll('.slip-btn');
const customSlippage = document.getElementById('customSlippage');
const priorityFeeSelect = document.getElementById('priorityFee');
const jitoTipSelect = document.getElementById('jitoTip');
const buyAmountInputs = [
  document.getElementById('buyAmount1'),
  document.getElementById('buyAmount2'),
  document.getElementById('buyAmount3'),
  document.getElementById('buyAmount4')
];
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const showPanelToggle = document.getElementById('showPanel');
const walletInfo = document.getElementById('walletInfo');
const walletAddress = document.getElementById('walletAddress');
const walletBalance = document.getElementById('walletBalance');
const statusDiv = document.getElementById('status');

let currentSlippage = 1;
const defaultBuyAmounts = [0.1, 0.5, 1, 1.2];

// 初始化
document.addEventListener('DOMContentLoaded', loadSettings);

// 显示/隐藏私钥
toggleKeyBtn.addEventListener('click', () => {
  if (privateKeyInput.type === 'password') {
    privateKeyInput.type = 'text';
    toggleKeyBtn.textContent = '🙈';
  } else {
    privateKeyInput.type = 'password';
    toggleKeyBtn.textContent = '👁️';
  }
});

// RPC 选择
rpcSelect.addEventListener('change', () => {
  heliusApiKeyInput.style.display = 'none';
  customRpcInput.style.display = 'none';

  if (rpcSelect.value === 'helius') {
    heliusApiKeyInput.style.display = 'block';
  } else if (rpcSelect.value === 'custom') {
    customRpcInput.style.display = 'block';
  }
});

// 滑点选择
slippageBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    slippageBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSlippage = parseFloat(btn.dataset.value);
    customSlippage.value = '';
  });
});

customSlippage.addEventListener('input', () => {
  if (customSlippage.value) {
    slippageBtns.forEach(b => b.classList.remove('active'));
    currentSlippage = parseFloat(customSlippage.value);
  }
});

// 保存设置
saveBtn.addEventListener('click', async () => {
  const privateKey = privateKeyInput.value.trim();
  const jupiterApiKey = jupiterApiKeyInput.value.trim();

  if (!privateKey) {
    showStatus('请输入私钥', 'error');
    return;
  }

  // 验证私钥格式 (Base58, 通常是 64 或 88 字符)
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(privateKey)) {
    showStatus('私钥格式不正确', 'error');
    return;
  }

  if (!jupiterApiKey) {
    showStatus('请输入 Jupiter API Key', 'error');
    return;
  }

  let rpcEndpoint = rpcSelect.value;
  let heliusApiKey = '';

  if (rpcEndpoint === 'helius') {
    heliusApiKey = heliusApiKeyInput.value.trim();
    if (!heliusApiKey) {
      showStatus('请输入 Helius API Key', 'error');
      return;
    }
    rpcEndpoint = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  } else if (rpcEndpoint === 'custom') {
    rpcEndpoint = customRpcInput.value.trim();
    if (!rpcEndpoint) {
      showStatus('请输入自定义 RPC 地址', 'error');
      return;
    }
  }

  // 收集买入金额
  const buyAmounts = buyAmountInputs.map((input, i) => {
    const val = parseFloat(input.value);
    return isNaN(val) || val <= 0 ? defaultBuyAmounts[i] : val;
  });

  const settings = {
    privateKey: privateKey,
    jupiterApiKey: jupiterApiKey,
    rpcEndpoint: rpcEndpoint,
    heliusApiKey: heliusApiKey,
    slippage: currentSlippage,
    priorityFee: parseFloat(priorityFeeSelect.value),
    jitoTip: parseFloat(jitoTipSelect.value),
    buyAmounts: buyAmounts,
    showPanel: showPanelToggle.checked,
    updatedAt: Date.now()
  };

  try {
    await chrome.storage.local.set({ solanaQuickTrade: settings });
    showStatus('设置已保存！', 'success');

    // 通知 content script 更新
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'SETTINGS_UPDATED',
        settings: { ...settings, privateKey: '***' } // 不传私钥到content script
      });
    }

    // 更新钱包信息显示
    await updateWalletInfo(privateKey, rpcEndpoint);
  } catch (error) {
    showStatus('保存失败: ' + error.message, 'error');
  }
});

// 测试连接
testBtn.addEventListener('click', async () => {
  const privateKey = privateKeyInput.value.trim();
  let rpcEndpoint = rpcSelect.value;

  if (rpcEndpoint === 'helius') {
    const heliusKey = heliusApiKeyInput.value.trim();
    if (!heliusKey) {
      showStatus('请输入 Helius API Key', 'error');
      return;
    }
    rpcEndpoint = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  } else if (rpcEndpoint === 'custom') {
    rpcEndpoint = customRpcInput.value.trim();
  }

  if (!privateKey) {
    showStatus('请先输入私钥', 'error');
    return;
  }

  showStatus('正在测试连接...', 'info');
  await updateWalletInfo(privateKey, rpcEndpoint);
});

// 悬浮窗开关
showPanelToggle.addEventListener('change', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    chrome.tabs.sendMessage(tabs[0].id, {
      type: 'TOGGLE_PANEL',
      show: showPanelToggle.checked
    });
  }
});

// 加载设置
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get('solanaQuickTrade');
    const settings = result.solanaQuickTrade;

    if (settings) {
      privateKeyInput.value = settings.privateKey || '';
      jupiterApiKeyInput.value = settings.jupiterApiKey || '';

      // 恢复 RPC 设置
      if (settings.heliusApiKey) {
        rpcSelect.value = 'helius';
        heliusApiKeyInput.value = settings.heliusApiKey;
        heliusApiKeyInput.style.display = 'block';
      } else if (settings.rpcEndpoint && settings.rpcEndpoint.includes('helius')) {
        rpcSelect.value = 'helius';
        // 尝试提取 API key
        const match = settings.rpcEndpoint.match(/api-key=([^&]+)/);
        if (match) {
          heliusApiKeyInput.value = match[1];
          heliusApiKeyInput.style.display = 'block';
        }
      } else if (settings.rpcEndpoint && !settings.rpcEndpoint.includes('mainnet-beta')) {
        rpcSelect.value = 'custom';
        customRpcInput.value = settings.rpcEndpoint;
        customRpcInput.style.display = 'block';
      }

      currentSlippage = settings.slippage || 1;
      slippageBtns.forEach(btn => {
        if (parseFloat(btn.dataset.value) === currentSlippage) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      if (settings.priorityFee) {
        priorityFeeSelect.value = settings.priorityFee.toString();
      }

      if (settings.jitoTip) {
        jitoTipSelect.value = settings.jitoTip.toString();
      }

      showPanelToggle.checked = settings.showPanel !== false;

      // 加载买入金额
      const amounts = settings.buyAmounts || defaultBuyAmounts;
      buyAmountInputs.forEach((input, i) => {
        input.value = amounts[i] || defaultBuyAmounts[i];
      });

      // 如果有私钥，显示钱包信息
      if (settings.privateKey) {
        await updateWalletInfo(settings.privateKey, settings.rpcEndpoint);
      }
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

// 更新钱包信息
async function updateWalletInfo(privateKey, rpcEndpoint) {
  try {
    // 发送消息到 background script 获取钱包信息
    const response = await chrome.runtime.sendMessage({
      type: 'GET_WALLET_INFO',
      privateKey: privateKey,
      rpcEndpoint: rpcEndpoint
    });

    if (response.success) {
      walletInfo.style.display = 'block';
      walletAddress.textContent = response.address.slice(0, 8) + '...' + response.address.slice(-6);
      walletBalance.textContent = response.balance.toFixed(4) + ' SOL';
      showStatus('连接成功！', 'success');
    } else {
      showStatus('连接失败: ' + response.error, 'error');
    }
  } catch (error) {
    showStatus('连接失败: ' + error.message, 'error');
  }
}

// 显示状态
function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = 'status ' + type;

  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}
