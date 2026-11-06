"""Live check of the 0G Router setup. Run on the Pi:  cd pi && python zg_check.py

1. /models: are ZG_MODEL and ZG_VISION_MODEL there, and do they take images?
2. One small text call with verify_tee: is the request ID in the ZG-Res-Key header, and does the
   Router report tee_verified?
3. The dust check on the clean and the dusty frame (pi/assets/camera): does the vision model tell
   them apart? If not, try ZG_VISION_MODEL=qwen3-vl-plus.

Nothing is recorded or uploaded, and the API key is never printed. Exit code 1 if something failed.
"""
import json
import sys
import time

import httpx

import camera
import config
import dust
import zg

ok = True


def show(name: str, good: bool, detail: str) -> None:
    global ok
    ok = ok and good
    print(f"{'OK  ' if good else 'FAIL'} {name}: {detail}")


def main() -> int:
    print(f"Router {config.ZG_ROUTER_URL} · model {config.ZG_MODEL} · vision {config.ZG_VISION_MODEL or '(none)'}")
    if not config.ZG_API_KEY:
        show("API key", False, "ZG_API_KEY is empty in .env (get one at pc.0g.ai)")
        return 1

    # 1. models
    try:
        r = httpx.get(config.ZG_ROUTER_URL.rstrip("/") + "/models",
                      headers={"Authorization": f"Bearer {config.ZG_API_KEY}"}, timeout=20)
        models = {m["id"]: m for m in r.json().get("data", [])}
        for mid in filter(None, {config.ZG_MODEL, config.ZG_VISION_MODEL}):
            m = models.get(mid)
            inputs = ((m or {}).get("architecture") or {}).get("input_modalities")
            show(f"model {mid}", m is not None,
                 f"inputs {inputs}, tee_attested {(m or {}).get('tee_attested')}" if m else "not on this Router")
    except Exception as e:
        show("/models", False, str(e)[:200])

    # 2. a text call with verify_tee
    try:
        raw = zg.client().chat.completions.with_raw_response.create(
            model=config.ZG_MODEL, messages=[{"role": "user", "content": "Reply with the word ok."}],
            max_tokens=200, extra_body={"verify_tee": True})
        header = raw.headers.get("ZG-Res-Key")
        trace = (json.loads(raw.text) or {}).get("x_0g_trace") or {}
        show("ZG-Res-Key header", bool(header), header or "missing (zg.py falls back to the body id)")
        show("x_0g_trace.tee_verified", trace.get("tee_verified") is True,
             f"{trace.get('tee_verified')!r}, provider {trace.get('provider')}")
    except Exception as e:
        show("text call", False, str(e)[:300])
        return 1

    # 3. the dust check on both frames (nothing recorded)
    ctx = {"health_pct": None, "note": "connection check: judge from the photo"}
    for name in ("clean", "dusty"):
        jpeg = (camera.ASSETS / f"{name}.jpg").read_bytes()
        t0 = time.monotonic()
        try:
            reply, kind = dust._ask(jpeg, json.dumps(ctx))
            v = dust._verdict(zg.extract_json(reply.text))
            right = v["dirty"] == (name == "dusty") and kind == "vision"
            show(f"dust check on {name}.jpg", right,
                 f"input {kind}, dirty {v['dirty']}, coverage {v['coverage_pct']}%, "
                 f"tee {reply.tee_verified}, {time.monotonic() - t0:.1f}s, request {reply.request_id}: {v['reason']}")
        except zg.ZGUnavailable as e:
            show(f"dust check on {name}.jpg", False, str(e)[:300])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
