// Solana Quick Trade - Background Service Worker
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

console.log('[SQT] Service Worker 加载中...');

// Jupiter Ultra API (已迁移到 api.jup.ag)
const JUPITER_ULTRA_API = 'https://api.jup.ag/ultra/v1';
const JUPITER_BALANCE_API = 'https://api.jup.ag/ultra/v1/balances';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1000000000;

// 从私钥创建 Keypair
function getKeypair(privateKeyBase58) {
  const secretKey = bs58.decode(privateKeyBase58);

  // Keypair.fromSecretKey 接受 64 字节或 32 字节
  let keypair;
  if (secretKey.length === 64) {
    keypair = Keypair.fromSecretKey(secretKey);
  } else if (secretKey.length === 32) {
    // 32 字节是 seed，需要用 fromSeed
    keypair = Keypair.fromSeed(secretKey);
  } else {
    throw new Error('私钥长度无效，需要32或64字节');
  }

  return {
    keypair,
    secretKey: keypair.secretKey,
    publicKey: keypair.publicKey,
    publicKeyBase58: keypair.publicKey.toBase58()
  };
}

// 获取设置
async function getSettings() {
  const result = await chrome.storage.local.get('solanaQuickTrade');
  return result.solanaQuickTrade || {};
}

// 缓存余额数据
let balanceCache = {
  data: null,
  timestamp: 0,
  address: ''
};
const CACHE_TTL = 5000; // 5秒缓存

// 从 Jupiter 获取所有余额
async function getBalancesFromJupiter(publicKey, apiKey) {
  const now = Date.now();
  if (balanceCache.address === publicKey &&
      balanceCache.data &&
      (now - balanceCache.timestamp) < CACHE_TTL) {
    console.log('[SQT] 使用缓存余额');
    return balanceCache.data;
  }

  console.log('[SQT] Jupiter Ultra API 获取余额...');
  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  const res = await fetch(`${JUPITER_BALANCE_API}/${publicKey}`, { headers });

  if (!res.ok) {
    throw new Error(`Jupiter API 错误: ${res.status}`);
  }

  const data = await res.json();

  if (data.error) {
    throw new Error(data.error);
  }

  balanceCache = {
    data: data,
    timestamp: now,
    address: publicKey
  };

  console.log('[SQT] Jupiter 余额:', data);
  return data;
}

// 获取 SOL 余额
async function getSolBalance(publicKey, apiKey) {
  const balances = await getBalancesFromJupiter(publicKey, apiKey);

  if (balances.SOL) {
    return balances.SOL.uiAmount || 0;
  }
  if (balances[SOL_MINT]) {
    return balances[SOL_MINT].uiAmount || 0;
  }

  return 0;
}

// 获取 Token 余额 (返回原始数量和UI数量)
async function getTokenBalance(publicKey, tokenMint, apiKey, forceRefresh = false) {
  // 如果强制刷新，清除缓存
  if (forceRefresh) {
    balanceCache = { data: null, timestamp: 0, address: '' };
  }

  const balances = await getBalancesFromJupiter(publicKey, apiKey);

  if (balances[tokenMint]) {
    return {
      raw: balances[tokenMint].amount || '0',
      uiAmount: balances[tokenMint].uiAmount || 0
    };
  }

  return { raw: '0', uiAmount: 0 };
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
async function createOrder(inputMint, outputMint, amount, taker, apiKey) {
  console.log('[SQT] 获取订单...', { inputMint, outputMint, amount });

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    taker
  });

  const url = `${JUPITER_ULTRA_API}/order?${params}`;
  console.log('[SQT] 请求 URL:', url);

  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const res = await fetch(url, { headers });

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

// 签名交易 - 使用 @solana/web3.js
function signTransaction(transactionBase64, keypair) {
  console.log('[SQT] 签名交易...');

  // 解码 base64 交易
  const txBuffer = Uint8Array.from(atob(transactionBase64), c => c.charCodeAt(0));
  console.log('[SQT] 交易字节长度:', txBuffer.length);

  // 反序列化为 VersionedTransaction
  const transaction = VersionedTransaction.deserialize(txBuffer);
  console.log('[SQT] 交易反序列化成功');

  // 签名
  transaction.sign([keypair]);
  console.log('[SQT] 交易签名成功');

  // 序列化
  const signedTxBytes = transaction.serialize();

  // 返回 base64 编码
  return btoa(String.fromCharCode(...signedTxBytes));
}

// Jupiter Ultra API - 执行交易
async function executeOrder(signedTransaction, requestId, apiKey) {
  console.log('[SQT] 执行交易...', requestId);

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const res = await fetch(`${JUPITER_ULTRA_API}/execute`, {
    method: 'POST',
    headers,
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
  if (!settings.jupiterApiKey) throw new Error('Jupiter API Key 未配置');

  const { keypair, publicKeyBase58 } = getKeypair(settings.privateKey);
  const apiKey = settings.jupiterApiKey;

  let inputMint, outputMint, tradeAmount;

  if (tradeType === 'buy') {
    inputMint = SOL_MINT;
    outputMint = tokenCA;
    tradeAmount = Math.floor(amount * LAMPORTS_PER_SOL);
  } else {
    inputMint = tokenCA;
    outputMint = SOL_MINT;

    // 卖出前强制刷新余额
    const tokenBalance = await getTokenBalance(publicKeyBase58, tokenCA, apiKey, true);
    console.log('[SQT] 代币余额:', tokenBalance);

    if (tokenBalance.uiAmount === 0) throw new Error('没有持仓');

    // 直接使用原始数量计算
    const rawBalance = BigInt(tokenBalance.raw);
    const sellPercent = BigInt(Math.floor(amount)); // 百分比
    tradeAmount = (rawBalance * sellPercent / 100n).toString();

    console.log('[SQT] 卖出计算:', {
      rawBalance: tokenBalance.raw,
      percent: amount,
      tradeAmount
    });
  }

  // 1. 创建订单 (获取报价和未签名交易)
  console.log('[SQT] 创建订单...');
  const order = await createOrder(inputMint, outputMint, tradeAmount, publicKeyBase58, apiKey);

  if (!order.transaction) {
    throw new Error('未获取到交易数据');
  }

  // 2. 签名交易
  const signedTx = signTransaction(order.transaction, keypair);

  // 3. 执行交易
  console.log('[SQT] 提交交易...');
  const result = await executeOrder(signedTx, order.requestId, apiKey);

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
      const { publicKeyBase58 } = getKeypair(message.privateKey);
      // 从 storage 获取 API key 用于余额查询
      const settings = await getSettings();
      const apiKey = settings.jupiterApiKey;
      const balance = await getSolBalance(publicKeyBase58, apiKey);
      return { success: true, address: publicKeyBase58, balance };
    }

    case 'GET_BALANCES': {
      const settings = await getSettings();
      if (!settings.privateKey) throw new Error('钱包未配置');

      const { publicKeyBase58 } = getKeypair(settings.privateKey);
      const apiKey = settings.jupiterApiKey;
      const solBalance = await getSolBalance(publicKeyBase58, apiKey);
      let tokenBalance = 0;
      if (message.tokenCA) {
        const tokenData = await getTokenBalance(publicKeyBase58, message.tokenCA, apiKey);
        tokenBalance = tokenData.uiAmount;
      }
      return { success: true, solBalance, tokenBalance };
    }

    case 'GET_TOKEN_INFO': {
      const settings = await getSettings();
      const tokenInfo = await getTokenInfo(message.tokenCA);

      let balance = 0;
      if (settings.privateKey) {
        const { publicKeyBase58 } = getKeypair(settings.privateKey);
        const apiKey = settings.jupiterApiKey;
        const tokenData = await getTokenBalance(publicKeyBase58, message.tokenCA, apiKey);
        balance = tokenData.uiAmount;
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

console.log('[SQT] Solana Quick Trade 已加载');
