// Every Arkiv read Dynaura makes, as plain functions: the web app (arkiv.js) and the bridge's
// smoke test (bridge/smoke.mjs) run the same queries, so what we test is what the screens show.
//
// Trust: anyone can write an entity with our schema tags, and an owner can hand an entity to any
// address. So every read is scoped to entities the building wallet both CREATED (fixed forever)
// and still OWNS. Nothing else counts, whatever its tags say.
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, desc, eq, gte, lte, or } from "@arkiv-network/sdk/query";
import { addr, u64 } from "@arkiv-network/sdk/schema";
import { hexToString, http } from "viem";
import { Bill, CleaningJob, DailyOutput, Decision, Heartbeat, Maintenance, Offer, Reading, Sale } from "./arkivSchemas.js";

/** A read-only Rabdi client. Rabdi makes a block every 2 s; viem assumes 12 s unless told. */
export function arkivClient(accessKey = "") {
  return createPublicClient({
    chain: { ...rabdi({ accessKey }), blockTime: 2000 },
    transport: http(undefined, { retryCount: 0, timeout: 10_000 }),
    pollingInterval: 1000,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rate limits (429), 5xx and dropped connections are worth another try; anything else is not. */
export function isRetryable(e) {
  for (let x = e; x; x = x.cause) {
    const s = x.status ?? x.code;
    if (s === 429 || s === -32005 || (s >= 500 && s < 600)) return true;
    const m = String(x.message || "");
    if (/429|rate limit|too many requests|fetch failed|timed out|ECONNRESET|socket hang up/i.test(m)) return true;
  }
  return false;
}

/** Reads are safe to repeat: back off exponentially, with jitter so retries don't line up. */
export async function withBackoff(fn, { tries = 4, base = 400 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i + 1 >= tries || !isRetryable(e)) throw e;
      await sleep(base * 2 ** i * (0.5 + Math.random()));
    }
  }
}

/** viem errors quote the RPC URL, which carries the access key: never show or log them raw. */
export function redact(text) {
  return String(text)
    .replace(/(rpc\.rabdi\.db-chain\.testnet\.arkiv\.network)\/[^\s"'`]+/g, "$1/<access-key>")
    .replace(/\bark_[A-Za-z0-9_-]{8,}/g, "<access-key>");
}

const text = (v) => {
  try {
    return hexToString(v);
  } catch {
    return "";
  }
};

// ctx = { client, owner, building }
const scoped = (ctx, q) => q.createdBy(ctx.owner).ownedBy(ctx.owner);

/** History timeline, Home "Recent on Arkiv", Ask Dyna: the latest 0G decisions with their proof. */
export function decisions(ctx, limit = 20) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, kind: true, mode: true, decision_id: true, day: true, og_request_id: true, model: true, og_storage_root: true, summary: true })
        .from(Decision)
        .where(eq("building", ctx.building)),
    )
      .orderBy(desc("decision_id"))
      .limit(limit)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      kind: e.kind.value,
      mode: e.mode.value,
      id: Number(e.decision_id.value),
      day: e.day.value,
      requestId: e.og_request_id?.value,
      model: e.model?.value,
      storageRoot: e.og_storage_root?.value,
      summary: text(e.summary.value),
    }));
  });
}

/** The decision behind a 0G request ID: links a cleaning job (or offer) to the AI call that made it. */
export function decisionByOgRequest(ctx, ogRequestId) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, kind: true, decision_id: true, day: true, og_request_id: true, og_storage_root: true, summary: true })
        .from(Decision)
        .where(and(eq("building", ctx.building), eq("og_request_id", ogRequestId))),
    )
      .limit(1)
      .fetch();
    const e = page.entities[0];
    return e
      ? { key: e.$key, kind: e.kind.value, id: Number(e.decision_id.value), day: e.day.value, requestId: e.og_request_id?.value, storageRoot: e.og_storage_root?.value, summary: text(e.summary.value) }
      : null;
  });
}

/** Admin upkeep page and History: the panel's maintenance record, newest first. */
export function maintenance(ctx, limit = 20) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client.select({ $key: true, date: true, at: true, title: true, details: true, arc_tx: true }).from(Maintenance).where(eq("building", ctx.building)),
    )
      .orderBy(desc("at"))
      .limit(limit)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      date: e.date.value,
      at: e.at ? Number(e.at.value) : null,
      title: e.title.value,
      text: text(e.details.value),
      arcTx: e.arc_tx?.value,
    }));
  });
}

/** "Building online" badge. The Pi renews this entity every 30 s for 2 more minutes; if the Pi
 *  stops, Arkiv drops it and this returns null. No monitoring server: the expiry is the alarm. */
export function heartbeat(ctx) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, mode: true, flats: true, pump: true, solar_w: true, used_w: true, updated: true, $expiresAt: true })
        .from(Heartbeat)
        .where(eq("building", ctx.building)),
    )
      .orderBy(desc("updated"))
      .limit(1)
      .fetch();
    const e = page.entities[0];
    if (!e) return null;
    return {
      key: e.$key,
      mode: e.mode.value,
      flats: e.flats.value,
      pump: e.pump.value,
      solarW: Number(e.solar_w.value),
      usedW: Number(e.used_w.value),
      updated: Number(e.updated.value),
      // seconds of life left, at 2 s per block
      expiresInS: Math.max(0, Number(e.$expiresAt - page.blockNumber) * 2),
    };
  });
}

/** Shop offers page. Offers expire when the solar window closes, so a closed one is just gone. */
export function offers(ctx, limit = 20) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, day: true, kwh: true, price_usdc: true, window_end: true, og_request_id: true, $expiresAt: true })
        .from(Offer)
        .where(eq("building", ctx.building)),
    )
      .orderBy(asc("window_end"))
      .limit(limit)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      day: e.day.value,
      kwh: Number(e.kwh.value),
      price: Number(e.price_usdc.value),
      windowEnd: Number(e.window_end.value),
      requestId: e.og_request_id?.value,
    }));
  });
}

/** Cleaning requests (flow v3), newest first. Filter with `status: "flagged"` or
 *  `statuses: ["open", "accepted", "cleaned"]`. v2 jobs come back too, with their old fields mapped. */
export function cleaningJobs(ctx, { status, statuses, limit = 20 } = {}) {
  return withBackoff(async () => {
    const list = statuses?.length ? statuses : status ? [status] : [];
    const byStatus = list.length === 1 ? eq("status", list[0]) : list.length > 1 ? or(list.map((x) => eq("status", x))) : null;
    const page = await scoped(
      ctx,
      ctx.client
        .select({
          $key: true, case_id: true, status: true, job_id: true, created_at: true, fee_usdc: true, deadline: true,
          dusty_pct: true, after_pct: true, output_before: true, output_after: true, coverage_pct: true, og_input: true, og_tee: true,
          og_request_id: true, og_storage_root: true, proof_hash: true, proof_from: true, proof_to: true,
          open_tx: true, release_tx: true, refund_tx: true, arc_tx: true, $expiresAt: true,
        })
        .from(CleaningJob)
        .where(byStatus ? and(eq("building", ctx.building), byStatus) : eq("building", ctx.building)),
    )
      .orderBy(desc("created_at"))
      .limit(limit)
      .fetch();
    const n = (v) => (v ? Number(v.value) : null);
    return page.entities.map((e) => {
      const dusty = n(e.dusty_pct) ?? n(e.output_before);
      const after = n(e.after_pct) ?? n(e.output_after);
      return {
        key: e.$key,
        caseId: e.case_id?.value ?? null,
        status: e.status.value,
        jobId: n(e.job_id), // Arc escrow id: null until approved
        createdAt: n(e.created_at),
        feeUsdc: n(e.fee_usdc) ?? 0, // 0 until the admin approves a fee (the board calls toFixed on it)
        deadline: n(e.deadline),
        dustyPct: dusty,
        afterPct: after,
        outputBefore: dusty, // v2 names, still used by the job board
        outputAfter: after,
        coveragePct: n(e.coverage_pct),
        ogInput: e.og_input?.value ?? null,
        ogTee: e.og_tee ? Boolean(e.og_tee.value) : null,
        ogRequestId: e.og_request_id?.value,
        ogStorageRoot: e.og_storage_root?.value,
        proofHash: e.proof_hash?.value ?? null,
        proofWindow: e.proof_from && e.proof_to ? [n(e.proof_from), n(e.proof_to)] : null,
        openTx: e.open_tx?.value ?? null,
        releaseTx: e.release_tx?.value ?? null,
        refundTx: e.refund_tx?.value ?? null,
        arcTx: e.arc_tx?.value ?? e.release_tx?.value ?? e.refund_tx?.value ?? e.open_tx?.value,
      };
    });
  });
}

/** Resident Bill page: one flat's bills (or every flat's for a month). */
export function bills(ctx, { flat, month, limit = 12 } = {}) {
  return withBackoff(async () => {
    const terms = [eq("building", ctx.building)];
    if (flat) terms.push(eq("flat", flat));
    if (month) terms.push(eq("month", month));
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, flat: true, month: true, kwh: true, solar_pct: true, usdc: true, arc_tx: true })
        .from(Bill)
        .where(and(terms)),
    )
      .orderBy(desc("month"))
      .limit(limit)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      flat: e.flat.value,
      month: e.month.value,
      kwh: Number(e.kwh.value),
      solarPct: Number(e.solar_pct.value),
      usdc: Number(e.usdc.value),
      arcTx: e.arc_tx?.value,
    }));
  });
}

/** Admin trading page: kWh sold to nearby shops and settled on Arc. */
export function sales(ctx, { buyer, limit = 20 } = {}) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, order_id: true, buyer: true, buyer_name: true, kwh: true, usdc: true, arc_tx: true })
        .from(Sale)
        .where(buyer ? and(eq("building", ctx.building), eq("buyer", addr(buyer))) : eq("building", ctx.building)),
    )
      .orderBy(desc("order_id"))
      .limit(limit)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      orderId: Number(e.order_id.value),
      buyer: e.buyer.value,
      name: e.buyer_name.value,
      kwh: Number(e.kwh.value),
      usdc: Number(e.usdc.value),
      arcTx: e.arc_tx.value,
    }));
  });
}

/** Daily totals, newest first. Dyna's planner reads the last 7 days of these into its prompt. */
export function dailyOutput(ctx, days = 7) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client.select({ $key: true, day: true, panel_wh: true, flats_wh: true, solar_pct: true }).from(DailyOutput).where(eq("building", ctx.building)),
    )
      .orderBy(desc("day"))
      .limit(days)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      day: e.day.value,
      panelWh: Number(e.panel_wh.value),
      flatsWh: Number(e.flats_wh.value),
      solarPct: Number(e.solar_pct.value),
    }));
  });
}

/** Signed 1-minute readings of one meter ("panel", "A", "B", "C"), newest first, with minute in
 *  [since, until]. A paid job's proof window is exactly that range. */
export function readings(ctx, { meter, since = 0, until, limit = 60 } = {}) {
  return withBackoff(async () => {
    const page = await scoped(
      ctx,
      ctx.client
        .select({ $key: true, meter: true, minute: true, avg_w: true, wh: true, solar_wh: true, samples: true, signer: true, sig: true })
        .from(Reading)
        .where(
          and(
            eq("building", ctx.building),
            eq("meter", meter),
            gte("minute", u64(BigInt(since))),
            ...(until != null ? [lte("minute", u64(BigInt(until)))] : []),
          ),
        ),
    )
      .orderBy(desc("minute"))
      .limit(limit)
      .fetch();
    return page.entities.map((e) => ({
      key: e.$key,
      meter: e.meter.value,
      minute: Number(e.minute.value),
      avgW: Number(e.avg_w.value),
      wh: Number(e.wh.value),
      solarWh: Number(e.solar_wh.value),
      samples: Number(e.samples.value),
      signer: e.signer.value,
      sig: e.sig.value,
    }));
  });
}
