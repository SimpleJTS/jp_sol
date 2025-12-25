// TweetNaCl 精简版 - Ed25519 签名
// 来源: https://tweetnacl.js.org (MIT License)

const gf = function(init) {
  let r = new Float64Array(16);
  if (init) for (let i = 0; i < init.length; i++) r[i] = init[i];
  return r;
};

const gf0 = gf();
const gf1 = gf([1]);
const D = gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]);
const D2 = gf([0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406]);
const X = gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]);
const Y = gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]);
const I = gf([0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43, 0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83]);

function ts64(x, i, h, l) {
  x[i]   = (h >> 24) & 0xff;
  x[i+1] = (h >> 16) & 0xff;
  x[i+2] = (h >>  8) & 0xff;
  x[i+3] = h & 0xff;
  x[i+4] = (l >> 24) & 0xff;
  x[i+5] = (l >> 16) & 0xff;
  x[i+6] = (l >>  8) & 0xff;
  x[i+7] = l & 0xff;
}

function vn(x, xi, y, yi, n) {
  let d = 0;
  for (let i = 0; i < n; i++) d |= x[xi+i] ^ y[yi+i];
  return (1 & ((d - 1) >>> 8)) - 1;
}

function crypto_verify_32(x, xi, y, yi) {
  return vn(x, xi, y, yi, 32);
}

function set25519(r, a) {
  for (let i = 0; i < 16; i++) r[i] = a[i] | 0;
}

function car25519(o) {
  let c;
  for (let i = 0; i < 16; i++) {
    o[i] += 65536;
    c = Math.floor(o[i] / 65536);
    o[(i+1) * (i < 15 ? 1 : 0)] += c - 1 + 37 * (c - 1) * (i === 15 ? 1 : 0);
    o[i] -= c * 65536;
  }
}

function sel25519(p, q, b) {
  let t, c = ~(b - 1);
  for (let i = 0; i < 16; i++) {
    t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function pack25519(o, n) {
  let m = gf(), t = gf();
  for (let i = 0; i < 16; i++) t[i] = n[i];
  car25519(t);
  car25519(t);
  car25519(t);
  for (let j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (let i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i-1] >> 16) & 1);
      m[i-1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
    let b = (m[15] >> 16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1 - b);
  }
  for (let i = 0; i < 16; i++) {
    o[2*i] = t[i] & 0xff;
    o[2*i+1] = t[i] >> 8;
  }
}

function neq25519(a, b) {
  let c = new Uint8Array(32), d = new Uint8Array(32);
  pack25519(c, a);
  pack25519(d, b);
  return crypto_verify_32(c, 0, d, 0);
}

function par25519(a) {
  let d = new Uint8Array(32);
  pack25519(d, a);
  return d[0] & 1;
}

function unpack25519(o, n) {
  for (let i = 0; i < 16; i++) o[i] = n[2*i] + (n[2*i+1] << 8);
  o[15] &= 0x7fff;
}

function A(o, a, b) {
  for (let i = 0; i < 16; i++) o[i] = a[i] + b[i];
}

function Z(o, a, b) {
  for (let i = 0; i < 16; i++) o[i] = a[i] - b[i];
}

function M(o, a, b) {
  let t = new Float64Array(31);
  for (let i = 0; i < 31; i++) t[i] = 0;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      t[i+j] += a[i] * b[j];
    }
  }
  for (let i = 0; i < 15; i++) {
    t[i] += 38 * t[i+16];
  }
  for (let i = 0; i < 16; i++) o[i] = t[i];
  car25519(o);
  car25519(o);
}

function S(o, a) {
  M(o, a, a);
}

function inv25519(o, i) {
  let c = gf();
  for (let a = 0; a < 16; a++) c[a] = i[a];
  for (let a = 253; a >= 0; a--) {
    S(c, c);
    if (a !== 2 && a !== 4) M(c, c, i);
  }
  for (let a = 0; a < 16; a++) o[a] = c[a];
}

function pow2523(o, i) {
  let c = gf();
  for (let a = 0; a < 16; a++) c[a] = i[a];
  for (let a = 250; a >= 0; a--) {
    S(c, c);
    if (a !== 1) M(c, c, i);
  }
  for (let a = 0; a < 16; a++) o[a] = c[a];
}

// SHA-512
const K = new Uint32Array([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817
]);

function crypto_hashblocks_hl(hh, hl, m, n) {
  let wh = new Int32Array(16), wl = new Int32Array(16);
  let bh0, bh1, bh2, bh3, bh4, bh5, bh6, bh7;
  let bl0, bl1, bl2, bl3, bl4, bl5, bl6, bl7;
  let th, tl, h, l, a, b, c, d;

  let ah0 = hh[0], ah1 = hh[1], ah2 = hh[2], ah3 = hh[3], ah4 = hh[4], ah5 = hh[5], ah6 = hh[6], ah7 = hh[7];
  let al0 = hl[0], al1 = hl[1], al2 = hl[2], al3 = hl[3], al4 = hl[4], al5 = hl[5], al6 = hl[6], al7 = hl[7];

  let pos = 0;
  while (n >= 128) {
    for (let i = 0; i < 16; i++) {
      let j = 8 * i + pos;
      wh[i] = (m[j+0] << 24) | (m[j+1] << 16) | (m[j+2] << 8) | m[j+3];
      wl[i] = (m[j+4] << 24) | (m[j+5] << 16) | (m[j+6] << 8) | m[j+7];
    }
    for (let i = 0; i < 80; i++) {
      bh0 = ah0; bh1 = ah1; bh2 = ah2; bh3 = ah3; bh4 = ah4; bh5 = ah5; bh6 = ah6; bh7 = ah7;
      bl0 = al0; bl1 = al1; bl2 = al2; bl3 = al3; bl4 = al4; bl5 = al5; bl6 = al6; bl7 = al7;

      h = ah7; l = al7;
      a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;

      h = ((ah4 >>> 14) | (al4 << (32-14))) ^ ((ah4 >>> 18) | (al4 << (32-18))) ^ ((al4 >>> (41-32)) | (ah4 << (32-(41-32))));
      l = ((al4 >>> 14) | (ah4 << (32-14))) ^ ((al4 >>> 18) | (ah4 << (32-18))) ^ ((ah4 >>> (41-32)) | (al4 << (32-(41-32))));
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

      h = (ah4 & ah5) ^ (~ah4 & ah6); l = (al4 & al5) ^ (~al4 & al6);
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

      h = K[i*2]; l = K[i*2+1];
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

      h = wh[i%16]; l = wl[i%16];
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

      b += a >>> 16; c += b >>> 16; d += c >>> 16;
      th = c & 0xffff | d << 16; tl = a & 0xffff | b << 16;

      h = th; l = tl;
      a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;

      h = ((ah0 >>> 28) | (al0 << (32-28))) ^ ((al0 >>> (34-32)) | (ah0 << (32-(34-32)))) ^ ((al0 >>> (39-32)) | (ah0 << (32-(39-32))));
      l = ((al0 >>> 28) | (ah0 << (32-28))) ^ ((ah0 >>> (34-32)) | (al0 << (32-(34-32)))) ^ ((ah0 >>> (39-32)) | (al0 << (32-(39-32))));
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

      h = (ah0 & ah1) ^ (ah0 & ah2) ^ (ah1 & ah2); l = (al0 & al1) ^ (al0 & al2) ^ (al1 & al2);
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

      b += a >>> 16; c += b >>> 16; d += c >>> 16;
      bh7 = (c & 0xffff) | (d << 16); bl7 = (a & 0xffff) | (b << 16);

      h = bh3; l = bl3;
      a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
      h = th; l = tl;
      a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
      b += a >>> 16; c += b >>> 16; d += c >>> 16;
      bh3 = (c & 0xffff) | (d << 16); bl3 = (a & 0xffff) | (b << 16);

      ah1 = bh0; ah2 = bh1; ah3 = bh2; ah0 = bh7;
      al1 = bl0; al2 = bl1; al3 = bl2; al0 = bl7;
      ah5 = bh4; ah6 = bh5; ah7 = bh6; ah4 = bh3;
      al5 = bl4; al6 = bl5; al7 = bl6; al4 = bl3;

      if (i % 16 === 15) {
        for (let j = 0; j < 16; j++) {
          h = wh[j]; l = wl[j];
          a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
          h = wh[(j+9)%16]; l = wl[(j+9)%16];
          a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

          th = wh[(j+1)%16]; tl = wl[(j+1)%16];
          h = ((th >>> 1) | (tl << (32-1))) ^ ((th >>> 8) | (tl << (32-8))) ^ (th >>> 7);
          l = ((tl >>> 1) | (th << (32-1))) ^ ((tl >>> 8) | (th << (32-8))) ^ ((tl >>> 7) | (th << (32-7)));
          a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

          th = wh[(j+14)%16]; tl = wl[(j+14)%16];
          h = ((th >>> 19) | (tl << (32-19))) ^ ((tl >>> (61-32)) | (th << (32-(61-32)))) ^ (th >>> 6);
          l = ((tl >>> 19) | (th << (32-19))) ^ ((th >>> (61-32)) | (tl << (32-(61-32)))) ^ ((tl >>> 6) | (th << (32-6)));
          a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;

          b += a >>> 16; c += b >>> 16; d += c >>> 16;
          wh[j] = (c & 0xffff) | (d << 16); wl[j] = (a & 0xffff) | (b << 16);
        }
      }
    }

    h = ah0; l = al0;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[0]; l = hl[0];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[0] = ah0 = (c & 0xffff) | (d << 16); hl[0] = al0 = (a & 0xffff) | (b << 16);

    h = ah1; l = al1;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[1]; l = hl[1];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[1] = ah1 = (c & 0xffff) | (d << 16); hl[1] = al1 = (a & 0xffff) | (b << 16);

    h = ah2; l = al2;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[2]; l = hl[2];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[2] = ah2 = (c & 0xffff) | (d << 16); hl[2] = al2 = (a & 0xffff) | (b << 16);

    h = ah3; l = al3;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[3]; l = hl[3];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[3] = ah3 = (c & 0xffff) | (d << 16); hl[3] = al3 = (a & 0xffff) | (b << 16);

    h = ah4; l = al4;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[4]; l = hl[4];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[4] = ah4 = (c & 0xffff) | (d << 16); hl[4] = al4 = (a & 0xffff) | (b << 16);

    h = ah5; l = al5;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[5]; l = hl[5];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[5] = ah5 = (c & 0xffff) | (d << 16); hl[5] = al5 = (a & 0xffff) | (b << 16);

    h = ah6; l = al6;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[6]; l = hl[6];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[6] = ah6 = (c & 0xffff) | (d << 16); hl[6] = al6 = (a & 0xffff) | (b << 16);

    h = ah7; l = al7;
    a = l & 0xffff; b = l >>> 16; c = h & 0xffff; d = h >>> 16;
    h = hh[7]; l = hl[7];
    a += l & 0xffff; b += l >>> 16; c += h & 0xffff; d += h >>> 16;
    b += a >>> 16; c += b >>> 16; d += c >>> 16;
    hh[7] = ah7 = (c & 0xffff) | (d << 16); hl[7] = al7 = (a & 0xffff) | (b << 16);

    pos += 128;
    n -= 128;
  }
  return n;
}

function crypto_hash(out, m, n) {
  let hh = new Int32Array(8), hl = new Int32Array(8);
  let x = new Uint8Array(256);
  let b = n;

  hh[0] = 0x6a09e667; hh[1] = 0xbb67ae85; hh[2] = 0x3c6ef372; hh[3] = 0xa54ff53a;
  hh[4] = 0x510e527f; hh[5] = 0x9b05688c; hh[6] = 0x1f83d9ab; hh[7] = 0x5be0cd19;
  hl[0] = 0xf3bcc908; hl[1] = 0x84caa73b; hl[2] = 0xfe94f82b; hl[3] = 0x5f1d36f1;
  hl[4] = 0xade682d1; hl[5] = 0x2b3e6c1f; hl[6] = 0xfb41bd6b; hl[7] = 0x137e2179;

  crypto_hashblocks_hl(hh, hl, m, n);
  n %= 128;

  for (let i = 0; i < n; i++) x[i] = m[b-n+i];
  x[n] = 128;

  n = 256 - 128 * (n < 112 ? 1 : 0);
  x[n-9] = 0;
  ts64(x, n-8, (b / 0x20000000) | 0, b << 3);
  crypto_hashblocks_hl(hh, hl, x, n);

  for (let i = 0; i < 8; i++) {
    out[i*8+0] = (hh[i] >>> 24) & 0xff;
    out[i*8+1] = (hh[i] >>> 16) & 0xff;
    out[i*8+2] = (hh[i] >>> 8) & 0xff;
    out[i*8+3] = hh[i] & 0xff;
    out[i*8+4] = (hl[i] >>> 24) & 0xff;
    out[i*8+5] = (hl[i] >>> 16) & 0xff;
    out[i*8+6] = (hl[i] >>> 8) & 0xff;
    out[i*8+7] = hl[i] & 0xff;
  }
  return 0;
}

function add(p, q) {
  let a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf(), g = gf(), h = gf(), t = gf();
  Z(a, p[1], p[0]); Z(t, q[1], q[0]); M(a, a, t);
  A(b, p[0], p[1]); A(t, q[0], q[1]); M(b, b, t);
  M(c, p[3], q[3]); M(c, c, D2);
  M(d, p[2], q[2]); A(d, d, d);
  Z(e, b, a); Z(f, d, c); A(g, d, c); A(h, b, a);
  M(p[0], e, f); M(p[1], h, g); M(p[2], g, f); M(p[3], e, h);
}

function cswap(p, q, b) {
  for (let i = 0; i < 4; i++) sel25519(p[i], q[i], b);
}

function pack(r, p) {
  let tx = gf(), ty = gf(), zi = gf();
  inv25519(zi, p[2]);
  M(tx, p[0], zi); M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= par25519(tx) << 7;
}

function scalarmult(p, q, s) {
  set25519(p[0], gf0); set25519(p[1], gf1); set25519(p[2], gf1); set25519(p[3], gf0);
  for (let i = 255; i >= 0; --i) {
    let b = (s[(i/8)|0] >> (i&7)) & 1;
    cswap(p, q, b);
    add(q, p);
    add(p, p);
    cswap(p, q, b);
  }
}

function scalarbase(p, s) {
  let q = [gf(), gf(), gf(), gf()];
  set25519(q[0], X); set25519(q[1], Y); set25519(q[2], gf1);
  M(q[3], X, Y);
  scalarmult(p, q, s);
}

const L = new Float64Array([0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10]);

function modL(r, x) {
  let carry;
  for (let i = 63; i >= 32; --i) {
    carry = 0;
    for (let j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[i - 32 + 12] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (let j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (let j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (let i = 0; i < 32; i++) {
    x[i+1] += x[i] >> 8;
    r[i] = x[i] & 255;
  }
}

function reduce(r) {
  let x = new Float64Array(64);
  for (let i = 0; i < 64; i++) x[i] = r[i];
  for (let i = 0; i < 64; i++) r[i] = 0;
  modL(r, x);
}

// 主签名函数
function crypto_sign(sm, m, n, sk) {
  let d = new Uint8Array(64), h = new Uint8Array(64), r = new Uint8Array(64);
  let x = new Float64Array(64);
  let p = [gf(), gf(), gf(), gf()];

  crypto_hash(d, sk, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  let smlen = n + 64;
  for (let i = 0; i < n; i++) sm[64 + i] = m[i];
  for (let i = 0; i < 32; i++) sm[32 + i] = d[32 + i];

  crypto_hash(r, sm.subarray(32), n + 32);
  reduce(r);
  scalarbase(p, r);
  pack(sm, p);

  for (let i = 0; i < 32; i++) sm[i + 32] = sk[i + 32];
  crypto_hash(h, sm, n + 64);
  reduce(h);

  for (let i = 0; i < 64; i++) x[i] = 0;
  for (let i = 0; i < 32; i++) x[i] = r[i];
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < 32; j++) {
      x[i+j] += h[i] * d[j];
    }
  }

  modL(sm.subarray(32), x);
  return smlen;
}

// 导出签名函数
function sign(message, secretKey) {
  let signedMsg = new Uint8Array(64 + message.length);
  crypto_sign(signedMsg, message, message.length, secretKey);
  return signedMsg.subarray(0, 64);
}

// 导出公钥派生
function getPublicKey(secretKey) {
  let d = new Uint8Array(64);
  let p = [gf(), gf(), gf(), gf()];
  let pk = new Uint8Array(32);

  crypto_hash(d, secretKey, 32);
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;
  scalarbase(p, d);
  pack(pk, p);
  return pk;
}

// 导出到全局对象 (Service Worker 使用 self)
(function() {
  const naclExport = { sign, getPublicKey, crypto_hash };

  // Service Worker 和 Web Worker
  if (typeof self !== 'undefined') {
    self.nacl = naclExport;
  }
  // 浏览器窗口
  if (typeof window !== 'undefined') {
    window.nacl = naclExport;
  }
  // Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = naclExport;
  }
  // globalThis (现代标准)
  if (typeof globalThis !== 'undefined') {
    globalThis.nacl = naclExport;
  }
})();

console.log('[nacl.js] 导出完成, self.nacl =', typeof self !== 'undefined' ? self.nacl : 'N/A');
