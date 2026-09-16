// 安全随机（供非加密的行为/抽取使用，满足审计要求：不用 Math.random）
import { webcrypto } from 'node:crypto'

export function secretsLikePick(arr) {
  const r = webcrypto.getRandomValues(new Uint32Array(1))[0]
  return arr[r % arr.length]
}

export function secretsLikeFloat() {
  return webcrypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
}
