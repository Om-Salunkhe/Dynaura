"""0G Compute Router client (OpenAI-compatible).

Every call returns the answer plus the proof details judges ask for:
the request ID (ZG-Res-Key header), the model, and any TEE verification
fields the Router sends back.
"""
import json
import logging
import re
from dataclasses import dataclass, field

from openai import OpenAI

import config

log = logging.getLogger("dynaura.0g")


class ZGUnavailable(RuntimeError):
    """0G could not be reached or gave no usable answer."""


@dataclass
class ZGReply:
    text: str
    request_id: str | None
    model: str
    tee: dict = field(default_factory=dict)
    usage: dict = field(default_factory=dict)

    def proof(self) -> dict:
        return {"request_id": self.request_id, "model": self.model, "tee": self.tee, "provider": "0G Compute Router"}


_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if not config.ZG_ROUTER_URL or not config.ZG_API_KEY:
        raise ZGUnavailable("ZG_ROUTER_URL and ZG_API_KEY must be set in .env")
    if _client is None:
        _client = OpenAI(base_url=config.ZG_ROUTER_URL, api_key=config.ZG_API_KEY, timeout=60, max_retries=1)
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


def chat(messages: list[dict], max_tokens: int = 1200, temperature: float = 0.2) -> ZGReply:
    try:
        raw = client().chat.completions.with_raw_response.create(
            model=config.ZG_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            extra_body={"verify_tee": True},
        )
    except ZGUnavailable:
        raise
    except Exception as e:  # network, auth, 402 no balance, 404 model
        raise ZGUnavailable(f"0G call failed: {e}") from e

    request_id = raw.headers.get("ZG-Res-Key") or raw.headers.get("zg-res-key")
    resp = raw.parse()
    body = json.loads(raw.text) if raw.text else {}
    text = (resp.choices[0].message.content or "").strip() if resp.choices else ""
    if not text:
        raise ZGUnavailable("0G returned an empty answer")
    usage = resp.usage.model_dump() if resp.usage else {}
    return ZGReply(text=text, request_id=request_id or body.get("id"), model=resp.model or config.ZG_MODEL,
                   tee=_find_tee(body), usage=usage)


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
