"""What Dyna looks at when the panel output drops: one JPEG of the panel (cleaning flow v3, step 1).

capture(hw) returns JPEG bytes from the first source that works:
  1. an uploaded photo (set_upload(), e.g. the admin's phone photo); used once
  2. CAMERA_CMD: a command that prints one JPEG on stdout. This is the real-camera seam, e.g.
     CAMERA_CMD="rpicam-still -n -t 500 --width 640 --height 480 -o -"   (Raspberry Pi camera)
  3. CAMERA_FILE: a fixed photo of the panel
  4. SIM only: pi/assets/camera/dusty.jpg while the simulated panel is dusty, else clean.jpg
On real hardware with none of 1-3 it returns None: 0G then judges from the meter alone, and is told
so. It never hands 0G a stock picture as if it were the real panel.

Every frame is kept in pi/episodes/frames/<sha256>.jpg; latest() is the last one (for the app).
"""
import hashlib
import logging
import shlex
import subprocess
import threading
from pathlib import Path

import config

log = logging.getLogger("dynaura.camera")
ASSETS = Path(__file__).resolve().parent / "assets" / "camera"
FRAMES = Path(__file__).resolve().parent / "episodes" / "frames"
MAX_BYTES = 2_000_000
SIM_DUSTY_BELOW = 0.85  # sim dust factor: 1.0 = clean panel, 0.6 = dusty

_lock = threading.Lock()
_upload: bytes | None = None
_latest: tuple[str, bytes] | None = None  # (sha256, jpeg)


def is_jpeg(data: bytes | None) -> bool:
    return bool(data) and data[:3] == b"\xff\xd8\xff" and len(data) <= MAX_BYTES


def set_upload(jpeg: bytes) -> None:
    """Use this photo for the next capture (e.g. a phone photo of the real panel)."""
    global _upload
    if not is_jpeg(jpeg):
        raise ValueError("not a JPEG, or larger than 2 MB")
    with _lock:
        _upload = jpeg


def _from_cmd() -> bytes | None:
    if not config.CAMERA_CMD:
        return None
    try:
        p = subprocess.run(shlex.split(config.CAMERA_CMD), capture_output=True, timeout=15)
    except Exception as e:
        log.warning("camera command failed: %s", e)
        return None
    if p.returncode != 0 or not is_jpeg(p.stdout):
        log.warning("camera command gave no JPEG (exit %s): %s", p.returncode, p.stderr[-200:])
        return None
    return p.stdout


def _from_file() -> bytes | None:
    if not config.CAMERA_FILE:
        return None
    try:
        data = Path(config.CAMERA_FILE).read_bytes()
    except OSError as e:
        log.warning("CAMERA_FILE unreadable: %s", e)
        return None
    return data if is_jpeg(data) else None


def _from_sim(hw) -> bytes | None:
    if config.HW != "sim" or hw is None:
        return None
    dust = getattr(hw, "_dust", 1.0)  # SimHardware's dust factor (pi/hw is read, never changed)
    return (ASSETS / ("dusty.jpg" if dust < SIM_DUSTY_BELOW else "clean.jpg")).read_bytes()


def source() -> str:
    """Where the next frame comes from: upload, camera, file, sim or none."""
    with _lock:
        if _upload:
            return "upload"
    if config.CAMERA_CMD:
        return "camera"
    if config.CAMERA_FILE:
        return "file"
    return "sim" if config.HW == "sim" else "none"


def capture(hw=None) -> bytes | None:
    """One JPEG of the panel, or None when there is no real picture to take."""
    global _upload
    with _lock:
        jpeg, _upload = _upload, None
    jpeg = jpeg or _from_cmd() or _from_file() or _from_sim(hw)
    if jpeg:
        save(jpeg)
    return jpeg


def save(jpeg: bytes) -> str:
    """Keep a frame on disk and as the latest one. Returns its sha256."""
    global _latest
    sha = hashlib.sha256(jpeg).hexdigest()
    FRAMES.mkdir(parents=True, exist_ok=True)
    path = FRAMES / f"{sha}.jpg"
    if not path.exists():
        path.write_bytes(jpeg)
    with _lock:
        _latest = (sha, jpeg)
    return sha


def latest() -> tuple[str, bytes] | None:
    """(sha256, jpeg) of the last frame, for GET /api/camera/latest.jpg."""
    with _lock:
        return _latest


def frame(sha: str) -> bytes | None:
    """A kept frame by its sha256 (hex), for a job's evidence link."""
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        return None
    path = FRAMES / f"{sha}.jpg"
    return path.read_bytes() if path.exists() else None
