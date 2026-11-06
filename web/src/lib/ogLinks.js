// 0G explorer links. storagescan has no page per root, only per submission number (txSeq),
// so a root is resolved lazily: GET /api/txs?rootHash=<root> -> data.list[0].txSeq (CORS *).
// Not indexed yet -> no link (the chip still shows the root).
import { useEffect, useState } from "react";

const SCAN = "https://storagescan-galileo.0g.ai";
const CHAIN = "https://chainscan-galileo.0g.ai";
const isRoot = (r) => /^0x[0-9a-fA-F]{64}$/.test(r || "");
const cache = new Map(); // root -> Promise<url | null>

export const ogTxUrl = (hash) => `${CHAIN}/tx/${hash}`;
export const ogAddressUrl = (addr) => `${CHAIN}/address/${addr}`;

export function resolveOgRoot(root) {
  if (!isRoot(root)) return Promise.resolve(null);
  if (!cache.has(root)) {
    const p = fetch(`${SCAN}/api/txs?skip=0&limit=1&rootHash=${root}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const seq = j?.data?.list?.[0]?.txSeq;
        if (seq == null) cache.delete(root); // not indexed yet: try again next time
        return seq == null ? null : `${SCAN}/submission/${seq}`;
      })
      .catch(() => {
        cache.delete(root);
        return null;
      });
    cache.set(root, p);
  }
  return cache.get(root);
}

/** storagescan page for a 0G Storage root, or null until it's indexed. */
export function useOgRootUrl(root, on = true) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!on || !isRoot(root)) return undefined;
    let alive = true;
    resolveOgRoot(root).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [root, on]);
  return url;
}
