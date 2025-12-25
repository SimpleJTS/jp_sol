// Solana Quick Trade - Background Service Worker
try {
  importScripts('lib/nacl.js');
  console.log('[SQT] nacl.js 加载成功');
  console.log('[SQT] self.nacl:', self.nacl);
  console.log('[SQT] self.nacl.sign:', typeof self.nacl?.sign);
  console.log('[SQT] self.nacl.getPublicKey:', typeof self.nacl?.getPublicKey);
} catch (e) {
  console.error('[SQT] 加载 nacl.js 失败:', e);
}

// Jupiter Ultra API
const JUPITER_ULTRA_API = 'https://lite-api.jup.ag/ultra/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1000000000;

// Base58
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const idx = BASE58_ALPHABET.indexOf(str[i]);
    if (idx === -1) throw new Error('Invalid base58 character');
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function base58Encode(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) str += '1';
  for (let i = digits.length - 1; i >= 0; i--) str += BASE58_ALPHABET[digits[i]];
  return str;
}

// 获取密钥对
function getKeypair(privateKeyBase58) {
  let secretKey = base58Decode(privateKeyBase58);

  // 如果是32字节的seed，派生完整密钥对
  if (secretKey.length === 32) {
    const publicKey = self.nacl.getPublicKey(secretKey);
    const fullKey = new Uint8Array(64);
    fullKey.set(secretKey);
    fullKey.set(publicKey, 32);
    secretKey = fullKey;
  }

  if (secretKey.length !== 64) {
    throw new Error('私钥长度无效，需要32或64字节');
  }

  const publicKey = secretKey.slice(32);
  return {
    secretKey,
    publicKey,
    publicKeyBase58: base58Encode(publicKey)
  };
}

// 获取设置
async function getSettings() {
  const result = await chrome.storage.local.get('solanaQuickTrade');
  return result.solanaQuickTrade || {};
}

// RPC 请求
async function rpcRequest(endpoint, method, params = []) {
  console.log(`[SQT] RPC: ${method} -> ${endpoint}`);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    console.log(`[SQT] RPC 响应:`, data);

    if (data.error) {
      throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data.result;
  } catch (err) {
    console.error(`[SQT] RPC 错误 (${method}):`, err);
    throw err;
  }
}

// Jupiter Ultra API - 获取所有余额
const JUPITER_BALANCE_API = 'https://lite-api.jup.ag/ultra/v1/balances';

// 缓存余额数据
let balanceCache = {
  data: null,
  timestamp: 0,
  address: ''
};
const CACHE_TTL = 5000; // 5秒缓存

// 从 Jupiter 获取所有余额
async function getBalancesFromJupiter(publicKey) {
  // 检查缓存
  const now = Date.now();
  if (balanceCache.address === publicKey &&
      balanceCache.data &&
      (now - balanceCache.timestamp) < CACHE_TTL) {
    console.log('[SQT] 使用缓存余额');
    return balanceCache.data;
  }

  console.log('[SQT] Jupiter Ultra API 获取余额...');
  const res = await fetch(`${JUPITER_BALANCE_API}/${publicKey}`);

  if (!res.ok) {
    throw new Error(`Jupiter API 错误: ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error);
  }

  // 更新缓存
  balanceCache = {
    data: data,
    timestamp: now,
    address: publicKey
  };

  console.log('[SQT] Jupiter 余额:', data);
  return data;
}

// 获取 SOL 余额
async function getSolBalance(publicKey) {
  const balances = await getBalancesFromJupiter(publicKey);

  // SOL 的 key 是 "SOL" 或 wrapped SOL mint
  if (balances.SOL) {
    return balances.SOL.uiAmount || 0;
  }
  if (balances[SOL_MINT]) {
    return balances[SOL_MINT].uiAmount || 0;
  }

  return 0;
}

// 获取 Token 余额
async function getTokenBalance(publicKey, tokenMint) {
  const balances = await getBalancesFromJupiter(publicKey);

  if (balances[tokenMint]) {
    return balances[tokenMint].uiAmount || 0;
  }

  return 0;
}

// 获取代币信息
async function getTokenInfo(tokenMint) {
  try {
    const priceRes = await fetch(`https://price.jup.ag/v6/price?ids=${tokenMint}`);
    const priceData = await priceRes.json();

    const info = { mint: tokenMint, symbol: 'Unknown', price: null, decimals: 9 };

    if (priceData.data?.[tokenMint]) {
      info.price = priceData.data[tokenMint].price;
    }

    try {
      const metaRes = await fetch(`https://tokens.jup.ag/token/${tokenMint}`);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        info.symbol = meta.symbol || 'Unknown';
        info.name = meta.name;
        info.decimals = meta.decimals || 9;
      }
    } catch (e) {}

    return info;
  } catch (err) {
    return { mint: tokenMint, symbol: 'Unknown', price: null, decimals: 9 };
  }
}

// Jupiter Ultra API - 获取订单 (GET 请求)
async function createOrder(inputMint, outputMint, amount, taker) {
  console.log('[SQT] 获取订单...', { inputMint, outputMint, amount });

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    taker
  });

  const url = `${JUPITER_ULTRA_API}/order?${params}`;
  console.log('[SQT] 请求 URL:', url);

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`订单获取失败: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log('[SQT] 订单响应:', data);

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

// 签名交易
function signTransaction(transactionBase64, secretKey) {
  // 检查 nacl 是否可用
  if (!self.nacl || typeof self.nacl.sign !== 'function') {
    console.error('[SQT] nacl 未正确加载:', self.nacl);
    throw new Error('签名库未加载');
  }

  // 解码 base64 交易
  const txBytes = Uint8Array.from(atob(transactionBase64), c => c.charCodeAt(0));
  console.log('[SQT] 交易字节长度:', txBytes.length);

  // 解析 VersionedTransaction
  const numSignatures = txBytes[0];
  const signatureSize = 64;
  const signaturesEnd = 1 + numSignatures * signatureSize;
  console.log('[SQT] 签名数量:', numSignatures, '签名区结束:', signaturesEnd);

  // 消息部分 (用于签名)
  const message = txBytes.slice(signaturesEnd);
  console.log('[SQT] 消息长度:', message.length);

  // 使用 Ed25519 签名消息
  const signature = self.nacl.sign(message, secretKey);
  console.log('[SQT] 签名完成, 长度:', signature.length);

  // 将签名插入到交易中
  const signedTx = new Uint8Array(txBytes.length);
  signedTx.set(txBytes);
  signedTx.set(signature, 1);

  // 返回 base64 编码的签名交易
  return btoa(String.fromCharCode(...signedTx));
}

// Jupiter Ultra API - 执行交易
async function executeOrder(signedTransaction, requestId) {
  console.log('[SQT] 执行交易...', requestId);

  const res = await fetch(`${JUPITER_ULTRA_API}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signedTransaction,
      requestId
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`交易执行失败: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log('[SQT] 执行结果:', data);

  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

// 执行交易 (完整流程)
async function executeTrade(tradeType, tokenCA, amount) {
  const settings = await getSettings();
  if (!settings.privateKey) throw new Error('钱包未配置');

  const keypair = getKeypair(settings.privateKey);

  let inputMint, outputMint, tradeAmount;

  if (tradeType === 'buy') {
    inputMint = SOL_MINT;
    outputMint = tokenCA;
    tradeAmount = Math.floor(amount * LAMPORTS_PER_SOL);
  } else {
    inputMint = tokenCA;
    outputMint = SOL_MINT;

    const tokenBalance = await getTokenBalance(keypair.publicKeyBase58, tokenCA);
    if (tokenBalance === 0) throw new Error('没有持仓');

    const tokenInfo = await getTokenInfo(tokenCA);
    const decimals = tokenInfo.decimals || 9;
    const sellAmount = tokenBalance * (amount / 100);
    tradeAmount = Math.floor(sellAmount * Math.pow(10, decimals));
  }

  // 1. 创建订单 (获取报价和未签名交易)
  console.log('[SQT] 创建订单...');
  const order = await createOrder(inputMint, outputMint, tradeAmount, keypair.publicKeyBase58);

  if (!order.transaction) {
    throw new Error('未获取到交易数据');
  }

  // 2. 签名交易
  console.log('[SQT] 签名交易...');
  const signedTx = signTransaction(order.transaction, keypair.secretKey);

  // 3. 执行交易
  console.log('[SQT] 执行交易...');
  const result = await executeOrder(signedTx, order.requestId);

  if (result.status === 'Failed') {
    throw new Error(result.error || '交易失败');
  }

  console.log('[SQT] 交易成功:', result.signature);
  return result.signature;
}

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[SQT] 收到消息:', message.type);
  handleMessage(message)
    .then(response => {
      console.log('[SQT] 响应:', response);
      sendResponse(response);
    })
    .catch(err => {
      console.error('[SQT] 处理错误:', err);
      sendResponse({ success: false, error: err.message });
    });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_WALLET_INFO': {
      const keypair = getKeypair(message.privateKey);
      const balance = await getSolBalance(keypair.publicKeyBase58);
      return { success: true, address: keypair.publicKeyBase58, balance };
    }

    case 'GET_BALANCES': {
      const settings = await getSettings();
      if (!settings.privateKey) throw new Error('钱包未配置');

      const keypair = getKeypair(settings.privateKey);
      const solBalance = await getSolBalance(keypair.publicKeyBase58);
      let tokenBalance = 0;
      if (message.tokenCA) {
        tokenBalance = await getTokenBalance(keypair.publicKeyBase58, message.tokenCA);
      }
      return { success: true, solBalance, tokenBalance };
    }

    case 'GET_TOKEN_INFO': {
      const settings = await getSettings();
      const tokenInfo = await getTokenInfo(message.tokenCA);

      let balance = 0;
      if (settings.privateKey) {
        const keypair = getKeypair(settings.privateKey);
        balance = await getTokenBalance(keypair.publicKeyBase58, message.tokenCA);
      }
      return { success: true, tokenInfo, balance };
    }

    case 'EXECUTE_TRADE': {
      const signature = await executeTrade(message.tradeType, message.tokenCA, message.amount);
      return { success: true, signature };
    }

    case 'OPEN_POPUP': {
      chrome.action.openPopup();
      return { success: true };
    }

    default:
      throw new Error('Unknown message type');
  }
}

console.log('Solana Quick Trade 已加载');
