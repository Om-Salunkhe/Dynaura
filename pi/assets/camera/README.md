# Panel camera frames (SIM)

`clean.jpg` and `dusty.jpg` are **synthetic placeholders**, drawn with Python, of a clean panel and one half-covered by tracing paper and dust. In SIM mode `pi/camera.py` shows 0G `dusty.jpg` while the simulated panel is dusty (the "dust" demo moment), and `clean.jpg` otherwise.

Replace them with real photos of the demo panel (same names, JPEG, about 640×480, under 2 MB): one clean, one with the tracing paper on.

On the real Pi these files are never used. The frame comes from `CAMERA_CMD` (a camera), `CAMERA_FILE`, or a photo the admin uploads. With none of those, 0G is told there is no photo and judges from the meter alone.
