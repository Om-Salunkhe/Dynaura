"""0G decides whether the panel is dirty (cleaning flow v3, step 2).

    check_dust(jpeg, ctx, store=..., uploader=..., notify=...) -> dict

- Looks at the panel photo with the 0G vision model (ZG_VISION_MODEL), with verify_tee.
- No photo, or no vision model on the Router: asks the 0G text model with the meter readings and the
  cloud forecast instead, and says so (input = "meter-only"). That is still 0G's decision.
- Records the decision (kind "dust", mode "ai") and uploads its episode log, photo included, to
  0G Storage like every other decision.
- 0G unreachable, the TEE check failed, or no true/false answer: raises zg.ZGUnavailable and records
  nothing. The caller (pi/cleaning.py) logs the no_check decision; the exception carries
  .request_id, .model, .raw_answer (when 0G did answer) and .frame_sha256 for it. It never makes up
  a verdict.

ctx: what the meter knows, e.g. {"measured_w": 2.1, "expected_w": 4.4, "output_pct": 48,
"cloud_cover_pct": 10, "dust_pct": 70}. Any keys are passed to 0G as they are.
"""
import base64
import hashlib
import json
import logging

import config
import zg

log = logging.getLogger("dynaura.dust")

SYSTEM = """You inspect the rooftop solar panel of a small apartment building.
Decide if the panel surface is dirty or covered (dust, paper, leaves, bird droppings) enough that it
should be cleaned. Shade from clouds or a low sun is NOT dirt.
You get the panel's meter readings, and a photo of the panel when there is one.
Answer with ONE JSON object only, no other text:
{"dirty": true or false, "coverage_pct": <0-100, how much of the panel is covered>, "reason": "one short sentence"}"""

PHOTO = "Look at this photo of the panel. Meter readings:\n{ctx}\nIs the panel dirty?"
METER_ONLY = ("There is no photo this time; judge from the meter readings alone. Output far below what the"
              " sun should give under a clear sky points to dirt; clouds explain a drop too.\n"
              "Meter readings:\n{ctx}\nIs the panel dirty?")


def _verdict(answer: dict) -> dict:
    dirty = answer.get("dirty")
    if not isinstance(dirty, bool):
        raise zg.ZGUnavailable(f"0G dust answer has no true/false 'dirty': {str(answer)[:120]}")
    try:
        coverage = round(min(100.0, max(0.0, float(answer.get("coverage_pct") or 0))), 1)
    except (TypeError, ValueError):
        coverage = None
    return {"dirty": dirty, "coverage_pct": coverage, "reason": str(answer.get("reason") or "")[:200]}


def _ask(jpeg: bytes | None, ctx_text: str) -> tuple[zg.ZGReply, str]:
    """(reply, input kind). Vision when there is a photo and a vision model; else meter-only."""
    if jpeg and config.ZG_VISION_MODEL:
        url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        messages = [{"role": "system", "content": SYSTEM},
                    {"role": "user", "content": [{"type": "text", "text": PHOTO.format(ctx=ctx_text)},
                                                 {"type": "image_url", "image_url": {"url": url}}]}]
        try:
            return zg.chat(messages, max_tokens=800, temperature=0.1, model=config.ZG_VISION_MODEL), "vision"
        except zg.ZGModelUnavailable as e:
            log.warning("0G vision model unavailable, checking from the meter only: %s", e)
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": METER_ONLY.format(ctx=ctx_text)}]
    return zg.chat(messages, max_tokens=800, temperature=0.1), "meter-only"


def check_dust(jpeg: bytes | None, ctx: dict, *, store=None, uploader=None, notify=None) -> dict:
    """Ask 0G about the dust, record the decision and its episode. Raises zg.ZGUnavailable (no verdict).
    Without store= it only returns 0G's verdict (decision_id None): the caller records it."""
    ctx_text = json.dumps(ctx, default=str)
    frame_sha = hashlib.sha256(jpeg).hexdigest() if jpeg else None
    reply = None
    try:
        reply, kind = _ask(jpeg, ctx_text)
        verdict = _verdict(zg.extract_json(reply.text))
    except zg.ZGUnavailable as e:
        # No verdict. Nothing is recorded here: the caller logs the no_check decision with these.
        e.request_id = reply.request_id if reply else None
        e.model = reply.model if reply else None
        e.raw_answer = reply.text if reply else None
        e.frame_sha256 = frame_sha
        log.warning("dust check: no verdict from 0G: %s", e)
        raise

    pct = verdict["coverage_pct"]
    summary = (f"0G: panel dirty{f' (~{pct:.0f}% covered)' if pct is not None else ''}: {verdict['reason']}"
               if verdict["dirty"] else f"0G: panel clean: {verdict['reason']}")
    output = {**verdict, "input": kind, "frame_sha256": frame_sha, "ctx": ctx}
    if store is None:
        log.warning("dust check without store=: verdict returned unrecorded (0G %s)", reply.request_id)
        return {**verdict, "request_id": reply.request_id, "tee": reply.tee_verified, "decision_id": None,
                "input": kind, "model": reply.model, "frame_sha256": frame_sha}
    did = store.add_decision("dust", "ai", summary[:200], output, request_id=reply.request_id,
                             model=reply.model, tee=reply.tee, input=ctx_text)
    extra = {"raw_answer": reply.text, "input": kind}
    if jpeg and kind == "vision":
        extra["frame_jpeg_b64"] = base64.b64encode(jpeg).decode()  # what 0G saw, in the episode log
    _publish(did, uploader, notify, extra)
    log.info("dust check #%s (%s, 0G %s): %s", did, kind, reply.request_id, summary)
    return {**verdict, "request_id": reply.request_id, "tee": reply.tee_verified, "decision_id": did,
            "input": kind, "model": reply.model, "frame_sha256": frame_sha}


def _publish(did: int, uploader, notify, extra: dict | None) -> None:
    """Episode to 0G Storage (then Arkiv), like every other decision."""
    if uploader:
        uploader.enqueue(did, extra)
    if notify:
        try:
            notify(did)
        except Exception:
            log.exception("decision callback failed")
