// Solana Quick Trade - Background Service Worker
importScripts('../lib/nacl.js');

// Jupiter API
const JUPITER_API = 'https://quote-api.jup.ag/v6';
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
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// 获取 SOL 余额
async function getSolBalance(publicKey, rpcEndpoint) {
  const result = await rpcRequest(rpcEndpoint, 'getBalance', [publicKey]);
  return result.value / LAMPORTS_PER_SOL;
}

// 获取 Token 余额
async function getTokenBalance(publicKey, tokenMint, rpcEndpoint) {
  try {
    const result = await rpcRequest(rpcEndpoint, 'getTokenAccountsByOwner', [
      publicKey,
      { mint: tokenMint },
      { encoding: 'jsonParsed' }
    ]);
    if (result.value?.length > 0) {
      return parseFloat(result.value[0].account.data.parsed.info.tokenAmount.uiAmount) || 0;
    }
    return 0;
  } catch (err) {
    console.error('获取Token余额失败:', err);
    return 0;
  }
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

// 获取最近区块哈希
async function getRecentBlockhash(rpcEndpoint) {
  const result = await rpcRequest(rpcEndpoint, 'getLatestBlockhash', [{ commitment: 'finalized' }]);
  return result.value.blockhash;
}

// Jupiter 报价
async function getQuote(inputMint, outputMint, amount, slippageBps) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: slippageBps.toString()
  });
  const res = await fetch(`${JUPITER_API}/quote?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// 获取交换交易
async function getSwapTransaction(quote, userPublicKey, priorityFee) {
  const res = await fetch(`${JUPITER_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      prioritizationFeeLamports: Math.floor(priorityFee * LAMPORTS_PER_SOL),
      dynamicComputeUnitLimit: true
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// 签名并发送交易
async function signAndSendTransaction(swapTransaction, secretKey, rpcEndpoint) {
  // 解码 base64 交易
  const txBytes = Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0));

  // 解析 VersionedTransaction
  // 第一个字节是签名数量
  const numSignatures = txBytes[0];
  const signatureSize = 64;
  const signaturesEnd = 1 + numSignatures * signatureSize;

  // 消息部分 (用于签名)
  const message = txBytes.slice(signaturesEnd);

  // 使用 Ed25519 签名消息
  const signature = self.nacl.sign(message, secretKey);

  // 将签名插入到交易中 (第一个签名位置)
  const signedTx = new Uint8Array(txBytes.length);
  signedTx.set(txBytes);
  signedTx.set(signature, 1); // 签名从偏移量1开始

  // 发送交易
  const signedTxBase64 = btoa(String.fromCharCode(...signedTx));

  const result = await rpcRequest(rpcEndpoint, 'sendTransaction', [
    signedTxBase64,
    {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3
    }
  ]);

  return result;
}

// 确认交易
async function confirmTransaction(signature, rpcEndpoint, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await rpcRequest(rpcEndpoint, 'getSignatureStatuses', [[signature]]);
      if (result.value[0]) {
        if (result.value[0].err) {
          throw new Error('交易失败: ' + JSON.stringify(result.value[0].err));
        }
        if (['confirmed', 'finalized'].includes(result.value[0].confirmationStatus)) {
          return true;
        }
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('交易确认超时');
}

// 执行交易
async function executeTrade(tradeType, tokenCA, amount) {
  const settings = await getSettings();
  if (!settings.privateKey) throw new Error('钱包未配置');

  const keypair = getKeypair(settings.privateKey);
  const rpcEndpoint = settings.rpcEndpoint || 'https://api.mainnet-beta.solana.com';
  const slippageBps = Math.floor((settings.slippage || 1) * 100);
  const priorityFee = settings.priorityFee || 0.0005;

  let inputMint, outputMint, tradeAmount;

  if (tradeType === 'buy') {
    inputMint = SOL_MINT;
    outputMint = tokenCA;
    tradeAmount = Math.floor(amount * LAMPORTS_PER_SOL);
  } else {
    inputMint = tokenCA;
    outputMint = SOL_MINT;

    const tokenBalance = await getTokenBalance(keypair.publicKeyBase58, tokenCA, rpcEndpoint);
    if (tokenBalance === 0) throw new Error('没有持仓');

    const tokenInfo = await getTokenInfo(tokenCA);
    const decimals = tokenInfo.decimals || 9;
    const sellAmount = tokenBalance * (amount / 100);
    tradeAmount = Math.floor(sellAmount * Math.pow(10, decimals));
  }

  console.log('获取报价...');
  const quote = await getQuote(inputMint, outputMint, tradeAmount, slippageBps);

  console.log('获取交易数据...');
  const swapData = await getSwapTransaction(quote, keypair.publicKeyBase58, priorityFee);

  console.log('签名并发送交易...');
  const signature = await signAndSendTransaction(swapData.swapTransaction, keypair.secretKey, rpcEndpoint);

  console.log('等待确认:', signature);
  await confirmTransaction(signature, rpcEndpoint);

  return signature;
}

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_WALLET_INFO': {
      const keypair = getKeypair(message.privateKey);
      const rpc = message.rpcEndpoint || 'https://api.mainnet-beta.solana.com';
      const balance = await getSolBalance(keypair.publicKeyBase58, rpc);
      return { success: true, address: keypair.publicKeyBase58, balance };
    }

    case 'GET_BALANCES': {
      const settings = await getSettings();
      if (!settings.privateKey) throw new Error('钱包未配置');

      const keypair = getKeypair(settings.privateKey);
      const rpc = settings.rpcEndpoint || 'https://api.mainnet-beta.solana.com';

      const solBalance = await getSolBalance(keypair.publicKeyBase58, rpc);
      let tokenBalance = 0;
      if (message.tokenCA) {
        tokenBalance = await getTokenBalance(keypair.publicKeyBase58, message.tokenCA, rpc);
      }
      return { success: true, solBalance, tokenBalance };
    }

    case 'GET_TOKEN_INFO': {
      const settings = await getSettings();
      const tokenInfo = await getTokenInfo(message.tokenCA);

      let balance = 0;
      if (settings.privateKey) {
        const keypair = getKeypair(settings.privateKey);
        const rpc = settings.rpcEndpoint || 'https://api.mainnet-beta.solana.com';
        balance = await getTokenBalance(keypair.publicKeyBase58, message.tokenCA, rpc);
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
