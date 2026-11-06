"""0G Compute Router client (OpenAI-compatible).

Every call returns the answer plus the proof details judges ask for:
the request ID (ZG-Res-Key header), the model, the provider, how long 0G took,
and the Router's TEE check (x_0g_trace.tee_verified, asked for with verify_tee).
A response whose TEE signature did not verify is refused, like 0G being down.
"""
import json
import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field

import httpx
import openai
from openai import OpenAI

import config

log = logging.getLogger("dynaura.0g")


class ZGUnavailable(RuntimeError):
    """0G could not be reached or gave no usable answer."""

    decision_id: int | None = None  # the "no-ai" / "no_check" decision logged for it, when there is one


class ZGModelUnavailable(ZGUnavailable):
    """The Router answered, but this model is not there or does not take this input (404 / 400 / 422)."""


@dataclass
class ZGReply:
    text: str
    request_id: str | None
    model: str
    tee: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)
    trace: dict = field(default_factory=dict)  # the Router's x_0g_trace block
    latency_ms: int | None = None

    @property
    def tee_verified(self) -> bool | None:
        """True / False from the Router's TEE check; None if it did not report one."""
        v = self.trace.get("tee_verified")
        return v if isinstance(v, bool) else None

    def proof(self) -> dict:
        return {"request_id": self.request_id, "router_request_id": self.trace.get("request_id"),
                "model": self.model, "provider": self.trace.get("provider"), "tee_verified": self.tee_verified,
                "latency_ms": self.latency_ms, "usage": self.usage, "via": "0G Compute Router"}


_proofs: OrderedDict[str, dict] = OrderedDict()  # recent proofs by request ID, for the episode log


def proof_for(request_id: str | None) -> dict | None:
    return _proofs.get(request_id) if request_id else None


_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if not config.ZG_ROUTER_URL or not config.ZG_API_KEY:
        raise ZGUnavailable("ZG_ROUTER_URL and ZG_API_KEY must be set in .env")
    if _client is None:
        # Connecting fails fast when the internet is gone (the offline demo); the answer itself
        # may take longer because the model thinks first.
        _client = OpenAI(base_url=config.ZG_ROUTER_URL, api_key=config.ZG_API_KEY,
                         timeout=httpx.Timeout(config.ZG_TIMEOUT_S, connect=5.0), max_retries=config.ZG_MAX_RETRIES)
    return _client


def _find_tee(obj, out=None, path=""):
    """Collect any field that looks like TEE / verification info from the response body."""
    out = {} if out is None else out
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else k
            if any(s in k.lower() for s in ("tee", "verif", "attest", "signature")):
                out[p] = v
            elif isinstance(v, (dict, list)):
                _find_tee(v, out, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:5]):
            _find_tee(v, out, f"{path}[{i}]")
    return out


def chat(messages: list[dict], max_tokens: int = 4000, temperature: float = 0.2, model: str | None = None) -> ZGReply:
    model = model or config.ZG_MODEL
    t0 = time.monotonic()
    try:
        raw = client().chat.completions.with_raw_response.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            extra_body={"verify_tee": True},
        )
    except ZGUnavailable:
        raise
    except (openai.NotFoundError, openai.BadRequestError, openai.UnprocessableEntityError) as e:
        raise ZGModelUnavailable(f"0G model {model} unavailable: {e}") from e
    except Exception as e:  # network, auth, 402 no balance
        raise ZGUnavailable(f"0G call failed: {e}") from e

    latency_ms = round((time.monotonic() - t0) * 1000)
    request_id = raw.headers.get("ZG-Res-Key") or raw.headers.get("zg-res-key")
    resp = raw.parse()
    body = json.loads(raw.text) if raw.text else {}
    trace = body.get("x_0g_trace") if isinstance(body.get("x_0g_trace"), dict) else {}
    if trace.get("tee_verified") is False:  # 0G: "treat the response as untrusted"
        raise ZGUnavailable(f"0G answer refused: the provider's TEE signature did not verify ({request_id})")
    text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
    if not text:
        raise ZGUnavailable("0G returned an empty answer")
    usage = resp.usage.model_dump() if resp.usage else {}
    reply = ZGReply(text=text, request_id=request_id or body.get("id"), model=resp.model or model,
                    tee=_find_tee(body), usage=usage, trace=trace, latency_ms=latency_ms)
    if reply.request_id:
        _proofs[reply.request_id] = reply.proof()
        while len(_proofs) > 100:
            _proofs.popitem(last=False)
    log.info("0G answered in %d ms (request %s, provider %s, tee_verified %s)",
             latency_ms, reply.request_id, trace.get("provider"), reply.tee_verified)
    return reply


def check_dust(jpeg, ctx, **kw) -> dict:
    """The 0G dust check lives in pi/dust.py (it records decisions); this is a shortcut to it."""
    import dust
    return dust.check_dust(jpeg, ctx, **kw)


def extract_json(text: str) -> dict:
    """Models with 'thinking' may wrap JSON in prose or <think> blocks: take the last JSON object."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    fenced = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    candidates = fenced or re.findall(r"\{.*\}", text, flags=re.S)
    for c in reversed(candidates):
        try:
            return json.loads(c)
        except json.JSONDecodeError:
            continue
    raise ZGUnavailable("0G answer had no valid JSON")


def extract_text(text: str) -> str:
    """Drop any <think> block a reasoning model adds before its answer."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    return text.split("</think>")[-1].strip()
