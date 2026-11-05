// Backoff for READS only. A read is safe to repeat; a write is not (see writer.mjs).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Rate limits (429), 5xx, timeouts and dropped connections are worth another try. */
export function isRetryable(e) {
  for (let x = e; x; x = x.cause) {
    const s = x.status ?? x.code
    if (s === 429 || s === -32005 || (s >= 500 && s < 600)) return true
    const m = String(x.message || "")
    if (/\b429\b|rate limit|too many requests|fetch failed|timed out|timeout|ECONNRESET|ECONNREFUSED|socket hang up/i.test(m)) return true
  }
  return false
}

/** Exponential backoff with full jitter, so a burst of retries doesn't hit the node in lockstep. */
export async function withBackoff(fn, { tries = 5, base = 400, max = 8000 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i + 1 >= tries || !isRetryable(e)) throw e
      await sleep(Math.min(max, base * 2 ** i) * (0.5 + Math.random()))
    }
  }
}
