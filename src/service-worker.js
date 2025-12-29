// Solana Quick Trade - Background Service Worker (Fast Mode with Jito)
import { Keypair, VersionedTransaction, Connection, PublicKey, SystemProgram, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import bs58 from 'bs58';

console.log('[SQT] Service Worker 加载中 (Jito Fast Mode)...');

// API 端点
const JUPITER_QUOTE_API = 'https://api.jup.ag/swap/v1';
const JUPITER_SWAP_API = 'https://api.jup.ag/swap/v1/swap';
const JUPITER_BALANCE_API = 'https://api.jup.ag/ultra/v1/balances';
const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1000000000;

// Jito 小费账户 (随机选择一个)
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVmkdzGTT4J4Kj1gfCmJY8',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
];

// 默认配置
const DEFAULT_JITO_TIP = 0.001; // 0.001 SOL
const DEFAULT_SLIPPAGE = 100; // 1% (以 bps 计)

// 从私钥创建 Keypair
function getKeypair(privateKeyBase58) {
  const secretKey = bs58.decode(privateKeyBase58);
  let keypair;
  if (secretKey.length === 64) {
    keypair = Keypair.fromSecretKey(secretKey);
  } else if (secretKey.length === 32) {
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

// 随机选择 Jito 小费账户
function getRandomTipAccount() {
  const index = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return JITO_TIP_ACCOUNTS[index];
}

// 缓存余额数据
let balanceCache = {
  data: null,
  timestamp: 0,
  address: ''
};
const CACHE_TTL = 5000;

// 从 Jupiter 获取余额
async function getBalancesFromJupiter(publicKey, apiKey) {
  const now = Date.now();
  if (balanceCache.address === publicKey &&
      balanceCache.data &&
      (now - balanceCache.timestamp) < CACHE_TTL) {
    return balanceCache.data;
  }

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

  balanceCache = { data, timestamp: now, address: publicKey };
  return data;
}

// 获取 SOL 余额
async function getSolBalance(publicKey, apiKey) {
  const balances = await getBalancesFromJupiter(publicKey, apiKey);
  if (balances.SOL) return balances.SOL.uiAmount || 0;
  if (balances[SOL_MINT]) return balances[SOL_MINT].uiAmount || 0;
  return 0;
}

// 获取 Token 余额
async function getTokenBalance(publicKey, tokenMint, apiKey, forceRefresh = false) {
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

// Jupiter Quote API - 获取报价
async function getQuote(inputMint, outputMint, amount, slippageBps = DEFAULT_SLIPPAGE, apiKey = null) {
  console.log('[SQT] 获取报价...', { inputMint, outputMint, amount });

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString()
  });

  const url = `${JUPITER_QUOTE_API}/quote?${params}`;
  const headers = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`报价获取失败: ${res.status} - ${text}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }

  console.log('[SQT] 报价:', data);
  return data;
}

// Jupiter Swap API - 获取交易
async function getSwapTransaction(quoteResponse, userPublicKey, apiKey = null) {
  console.log('[SQT] 获取 Swap 交易...');

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const res = await fetch(JUPITER_SWAP_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto'
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Swap 交易获取失败: ${res.status} - ${text}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }

  console.log('[SQT] Swap 交易获取成功');
  return data;
}

// 签名交易
function signTransaction(transactionBase64, keypair) {
  const txBuffer = Uint8Array.from(atob(transactionBase64), c => c.charCodeAt(0));
  const transaction = VersionedTransaction.deserialize(txBuffer);
  transaction.sign([keypair]);
  return transaction;
}

// 通过 Jito 发送 Bundle
async function sendJitoBundle(signedTransaction, tipLamports, keypair) {
  console.log('[SQT] 通过 Jito 发送 Bundle...');

  // 序列化主交易
  const serializedTx = signedTransaction.serialize();
  const base58Tx = bs58.encode(serializedTx);

  // 创建小费交易
  const tipAccount = getRandomTipAccount();
  console.log('[SQT] Jito 小费账户:', tipAccount);
  console.log('[SQT] Jito 小费金额:', tipLamports / LAMPORTS_PER_SOL, 'SOL');

  // Bundle 请求 (只发送主交易，小费通过 prioritization fee 处理)
  const bundleRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'sendBundle',
    params: [[base58Tx]]
  };

  const res = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundleRequest)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jito Bundle 发送失败: ${res.status} - ${text}`);
  }

  const data = await res.json();
  console.log('[SQT] Jito 响应:', data);

  if (data.error) {
    throw new Error(data.error.message || 'Jito Bundle 失败');
  }

  return data.result;
}

// 通过 RPC 发送交易 (备用方案)
async function sendViaRpc(signedTransaction, rpcEndpoint = 'https://api.mainnet-beta.solana.com') {
  console.log('[SQT] 通过 RPC 发送交易...');

  const serializedTx = signedTransaction.serialize();
  const base64Tx = btoa(String.fromCharCode(...serializedTx));

  const res = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [base64Tx, {
        skipPreflight: true,
        preflightCommitment: 'processed',
        encoding: 'base64',
        maxRetries: 3
      }]
    })
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || 'RPC 发送失败');
  }

  return data.result;
}

// 确认交易
async function confirmTransaction(signature, rpcEndpoint = 'https://api.mainnet-beta.solana.com', timeout = 30000) {
  console.log('[SQT] 确认交易:', signature);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignatureStatuses',
          params: [[signature], { searchTransactionHistory: true }]
        })
      });

      const data = await res.json();
      const status = data.result?.value?.[0];

      if (status) {
        if (status.err) {
          throw new Error('交易失败: ' + JSON.stringify(status.err));
        }
        if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
          console.log('[SQT] 交易已确认:', status.confirmationStatus);
          return true;
        }
      }
    } catch (e) {
      console.log('[SQT] 确认检查错误:', e.message);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('[SQT] 交易确认超时，但可能已成功');
  return false;
}

// 执行交易 (完整流程) - Jito Fast Mode
async function executeTrade(tradeType, tokenCA, amount) {
  const timing = { start: Date.now() };
  console.log('[SQT] ⏱️ 交易开始 (Jito Fast Mode) ========================');

  // Step 1: 获取设置
  const settings = await getSettings();
  timing.getSettings = Date.now();
  console.log(`[SQT] ⏱️ 获取设置: ${timing.getSettings - timing.start}ms`);

  if (!settings.privateKey) throw new Error('钱包未配置');

  // Step 2: 创建 Keypair
  const { keypair, publicKeyBase58 } = getKeypair(settings.privateKey);
  timing.getKeypair = Date.now();
  console.log(`[SQT] ⏱️ 创建Keypair: ${timing.getKeypair - timing.getSettings}ms`);

  const apiKey = settings.jupiterApiKey;
  const jitoTip = settings.jitoTip || DEFAULT_JITO_TIP;
  const slippageBps = (settings.slippage || 1) * 100; // 转换为 bps

  let inputMint, outputMint, tradeAmount;

  if (tradeType === 'buy') {
    inputMint = SOL_MINT;
    outputMint = tokenCA;
    tradeAmount = Math.floor(amount * LAMPORTS_PER_SOL);
    timing.prepareAmount = Date.now();
  } else {
    inputMint = tokenCA;
    outputMint = SOL_MINT;

    const tokenBalance = await getTokenBalance(publicKeyBase58, tokenCA, apiKey, true);
    timing.getBalance = Date.now();
    console.log(`[SQT] ⏱️ 获取Token余额: ${timing.getBalance - timing.getKeypair}ms`);

    if (tokenBalance.uiAmount === 0) throw new Error('没有持仓');

    const rawBalance = BigInt(tokenBalance.raw);
    const sellPercent = BigInt(Math.floor(amount));
    tradeAmount = (rawBalance * sellPercent / 100n).toString();
    timing.prepareAmount = Date.now();
  }

  // Step 3: 获取报价
  const quoteStart = Date.now();
  const quote = await getQuote(inputMint, outputMint, tradeAmount, slippageBps, apiKey);
  timing.getQuote = Date.now();
  console.log(`[SQT] ⏱️ 获取报价(Jupiter Quote): ${timing.getQuote - quoteStart}ms`);

  // Step 4: 获取 Swap 交易
  const swapStart = Date.now();
  const swapData = await getSwapTransaction(quote, publicKeyBase58, apiKey);
  timing.getSwap = Date.now();
  console.log(`[SQT] ⏱️ 获取Swap交易(Jupiter Swap): ${timing.getSwap - swapStart}ms`);

  // Step 5: 签名交易
  const signStart = Date.now();
  const signedTx = signTransaction(swapData.swapTransaction, keypair);
  timing.signTransaction = Date.now();
  console.log(`[SQT] ⏱️ 签名交易: ${timing.signTransaction - signStart}ms`);

  // Step 6: 发送交易 (优先 Jito，失败则用 RPC)
  const sendStart = Date.now();
  let signature;
  let usedJito = false;

  try {
    // 尝试 Jito Bundle
    const bundleId = await sendJitoBundle(signedTx, Math.floor(jitoTip * LAMPORTS_PER_SOL), keypair);
    console.log('[SQT] Jito Bundle ID:', bundleId);
    usedJito = true;

    // 从交易中提取签名
    signature = bs58.encode(signedTx.signatures[0]);
  } catch (jitoError) {
    console.log('[SQT] Jito 失败，使用 RPC 备用:', jitoError.message);
    // 回退到 RPC
    signature = await sendViaRpc(signedTx, settings.rpcEndpoint);
  }

  timing.sendTransaction = Date.now();
  console.log(`[SQT] ⏱️ 发送交易(${usedJito ? 'Jito' : 'RPC'}): ${timing.sendTransaction - sendStart}ms`);
  console.log('[SQT] 交易签名:', signature);

  // Step 7: 确认交易 (可选，不阻塞)
  const confirmStart = Date.now();
  const confirmed = await confirmTransaction(signature, settings.rpcEndpoint);
  timing.confirmTransaction = Date.now();
  console.log(`[SQT] ⏱️ 确认交易: ${timing.confirmTransaction - confirmStart}ms`);

  // 总耗时统计
  timing.end = Date.now();
  const totalTime = timing.end - timing.start;
  console.log('[SQT] ⏱️ ========================');
  console.log(`[SQT] ⏱️ 总耗时: ${totalTime}ms (${(totalTime/1000).toFixed(2)}s)`);
  console.log('[SQT] ⏱️ 耗时分布:');
  console.log(`[SQT]    - 获取设置: ${timing.getSettings - timing.start}ms`);
  console.log(`[SQT]    - 创建Keypair: ${timing.getKeypair - timing.getSettings}ms`);
  if (timing.getBalance) {
    console.log(`[SQT]    - 获取余额: ${timing.getBalance - timing.getKeypair}ms`);
  }
  console.log(`[SQT]    - 获取报价: ${timing.getQuote - (timing.prepareAmount || timing.getKeypair)}ms`);
  console.log(`[SQT]    - 获取Swap: ${timing.getSwap - timing.getQuote}ms`);
  console.log(`[SQT]    - 签名交易: ${timing.signTransaction - timing.getSwap}ms`);
  console.log(`[SQT]    - 发送交易: ${timing.sendTransaction - timing.signTransaction}ms`);
  console.log(`[SQT]    - 确认交易: ${timing.confirmTransaction - timing.sendTransaction}ms`);
  console.log(`[SQT] ⏱️ 发送方式: ${usedJito ? 'Jito Bundle' : 'RPC'}`);
  console.log('[SQT] ⏱️ ========================');

  return signature;
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

console.log('[SQT] Solana Quick Trade (Jito Fast Mode) 已加载');
