"""Tests for the 0G dust check (pi/dust.py) and the panel camera (pi/camera.py).

The 0G Router is mocked over real HTTP (a local server speaking the OpenAI chat API with the
ZG-Res-Key header and x_0g_trace), so zg.chat runs unchanged. No network, no keys.

Run from pi/:  python tests/test_dust_check.py
"""
import json
import socket
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import camera  # noqa: E402
import config  # noqa: E402
import dust  # noqa: E402
import zg  # noqa: E402
from store import Store  # noqa: E402

ROUTER = {"text_answer": '{"dirty": true, "coverage_pct": 52, "reason": "Output is half of a clear-sky day."}',
          "tee": True, "seen": []}


class FakeRouter(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, headers=None):
        out = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers["content-length"])))
        ROUTER["seen"].append(req)
        assert req.get("verify_tee") is True, "every 0G call asks for the TEE check"
        model, user = req["model"], req["messages"][-1]["content"]
        if model == "vision-missing":
            return self._send(404, {"error": {"message": f"model {model} not found", "type": "not_found"}})
        if model == "vision-ok":
            assert isinstance(user, list) and user[1]["image_url"]["url"].startswith("data:image/jpeg;base64,")
            answer = '<think>paper on it</think>{"dirty": true, "coverage_pct": 61, "reason": "A sheet covers most cells."}'
        else:
            assert isinstance(user, str) and "no photo" in user
            answer = ROUTER["text_answer"]
        n = len(ROUTER["seen"])
        self._send(200, {
            "id": f"chatcmpl-{n}", "object": "chat.completion", "created": 1, "model": model,
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": answer}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "x_0g_trace": {"request_id": f"router-{n}", "provider": "0xprovider", "tee_verified": ROUTER["tee"]},
        }, {"ZG-Res-Key": f"zg-chat-{n}"})


class FakeUploader:
    def __init__(self):
        self.episodes = []

    def enqueue(self, did, extra=None):
        self.episodes.append((did, extra or {}))


class SimHw:
    def __init__(self, dust_factor):
        self._dust = dust_factor


def closed_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def point_router(url: str) -> None:
    config.ZG_ROUTER_URL, config.ZG_API_KEY = url, "sk-test"
    zg._client = None


def test_camera(tmp: Path) -> None:
    camera.FRAMES = tmp / "frames"
    config.CAMERA_CMD = config.CAMERA_FILE = ""
    config.HW = "sim"
    dusty = camera.capture(SimHw(0.6))
    clean = camera.capture(SimHw(1.0))
    assert dusty == (camera.ASSETS / "dusty.jpg").read_bytes()
    assert clean == (camera.ASSETS / "clean.jpg").read_bytes()
    assert camera.latest()[1] == clean and camera.frame(camera.latest()[0]) == clean

    photo = (camera.ASSETS / "dusty.jpg").read_bytes()
    camera.set_upload(photo)  # a phone photo is used once
    assert camera.source() == "upload" and camera.capture(SimHw(1.0)) == photo
    assert camera.capture(SimHw(1.0)) == clean

    config.CAMERA_CMD = f"cat {camera.ASSETS / 'dusty.jpg'}"  # the real-camera seam
    assert camera.source() == "camera" and camera.capture(None) == photo
    config.CAMERA_CMD = ""

    config.HW = "real"  # real hardware, no camera: no stock picture pretending to be the panel
    assert camera.capture(SimHw(0.6)) is None and camera.source() == "none"
    config.HW = "sim"

    try:
        camera.set_upload(b"not a jpeg")
        raise AssertionError("non-JPEG upload accepted")
    except ValueError:
        pass
    assert camera.frame("../../etc/passwd") is None


def main():
    tmp = Path(tempfile.mkdtemp(prefix="dynaura-dust-"))
    test_camera(tmp)

    srv = HTTPServer(("127.0.0.1", 0), FakeRouter)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    point_router(f"http://127.0.0.1:{srv.server_port}/v1")
    store = Store(str(tmp / "t.db"))
    up = FakeUploader()
    notified = []
    ctx = {"measured_w": 2.1, "expected_w": 4.4, "output_pct": 48, "cloud_cover_pct": 5}
    jpeg = (camera.ASSETS / "dusty.jpg").read_bytes()

    # 1. Vision: 0G looks at the photo; decision + episode (with the photo) recorded
    config.ZG_VISION_MODEL = "vision-ok"
    r = dust.check_dust(jpeg, ctx, store=store, uploader=up, notify=notified.append)
    assert r["dirty"] is True and r["coverage_pct"] == 61 and r["input"] == "vision", r
    assert r["request_id"] == "zg-chat-1" and r["tee"] is True, r
    d = store.decision(r["decision_id"])
    assert (d["kind"], d["mode"], d["request_id"]) == ("dust", "ai", "zg-chat-1"), d
    assert d["output"]["frame_sha256"] == r["frame_sha256"]
    did, extra = up.episodes[-1]
    assert did == r["decision_id"] and extra["frame_jpeg_b64"] and extra["input"] == "vision"
    assert notified == [r["decision_id"]]

    # 1b. Called without store=: still 0G's verdict, nothing recorded, no decision_id
    n = len(store.decisions(limit=100))
    r = zg.check_dust(jpeg, ctx)
    assert r["dirty"] is True and r["decision_id"] is None and r["request_id"], r
    assert len(store.decisions(limit=100)) == n

    # 2. Vision model not on the Router: falls back to the text model with the meter readings
    config.ZG_VISION_MODEL = "vision-missing"
    r = dust.check_dust(jpeg, ctx, store=store, uploader=up)
    assert r["input"] == "meter-only" and r["dirty"] is True and r["coverage_pct"] == 52, r
    assert "frame_jpeg_b64" not in up.episodes[-1][1]  # 0G did not see the photo, so it is not claimed

    # 3. No photo at all (real Pi without a camera): meter-only
    config.ZG_VISION_MODEL = ""
    ROUTER["text_answer"] = '{"dirty": false, "coverage_pct": 0, "reason": "Heavy cloud explains the drop."}'
    r = dust.check_dust(None, {**ctx, "cloud_cover_pct": 90}, store=store, uploader=up)
    assert r["dirty"] is False and r["input"] == "meter-only" and r["frame_sha256"] is None, r
    assert store.decision(r["decision_id"])["summary"].startswith("0G: panel clean")

    # 4. An answer without a true/false verdict: no verdict is invented, nothing is recorded here,
    #    and the exception carries the 0G call for the caller's no_check record
    ROUTER["text_answer"] = "The panel might be a bit dirty, hard to say."
    n_dec, n_ep = len(store.decisions(limit=100)), len(up.episodes)
    try:
        zg.check_dust(None, ctx, store=store, uploader=up)  # the zg shortcut
        raise AssertionError("made up a verdict")
    except zg.ZGUnavailable as e:
        assert e.request_id and e.raw_answer.startswith("The panel might"), vars(e)
    assert len(store.decisions(limit=100)) == n_dec and len(up.episodes) == n_ep

    # 5. TEE signature did not verify: refused like 0G being down
    ROUTER["text_answer"], ROUTER["tee"] = '{"dirty": true, "coverage_pct": 50, "reason": "x"}', False
    try:
        dust.check_dust(None, ctx, store=store, uploader=up)
        raise AssertionError("accepted an unverified answer")
    except zg.ZGUnavailable as e:
        assert "TEE" in str(e) and e.request_id is None  # refused before any answer was used
    ROUTER["tee"] = True

    # 6. 0G unreachable: raises, logs no_check, nothing else
    point_router(f"http://127.0.0.1:{closed_port()}/v1")
    config.ZG_VISION_MODEL = "vision-ok"
    try:
        dust.check_dust(jpeg, ctx, store=store, uploader=up)
        raise AssertionError("0G was down but a verdict came back")
    except zg.ZGUnavailable as e:
        assert not isinstance(e, zg.ZGModelUnavailable)
        assert e.request_id is None and e.frame_sha256, vars(e)
    assert len(store.decisions(limit=100)) == n_dec  # nothing recorded on any failure

    srv.shutdown()
    print("dust check + camera: all checks passed", flush=True)


if __name__ == "__main__":
    main()
