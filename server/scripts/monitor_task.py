"""监控指定 video_gen 任务直至落定，成功后校验视频落盘（真实可灵验证用）。"""

import os
import subprocess
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000/api"
TASK_ID = sys.argv[1] if len(sys.argv) > 1 else ""
FFMPEG = os.path.expanduser("~/.local/bin/ffmpeg")
TIMEOUT = 900


def main() -> int:
    s = httpx.Client(trust_env=False, timeout=httpx.Timeout(60.0, connect=15.0))
    r = s.post(f"{BASE}/auth/send-code", json={"phone": "13800001234"})
    if r.status_code == 429:
        time.sleep(65)
        r = s.post(f"{BASE}/auth/send-code", json={"phone": "13800001234"})
    r.raise_for_status()
    code = r.json()["demoCode"]
    r = s.post(f"{BASE}/auth/login", json={"phone": "13800001234", "code": code})
    r.raise_for_status()
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"

    t0 = time.time()
    last = ""
    while time.time() - t0 < TIMEOUT:
        tasks = s.get(f"{BASE}/tasks", params={"type": "video_gen"}).json()
        t = next((x for x in tasks if x["id"] == TASK_ID), None)
        if t is None:
            print("task not found")
            return 1
        state = t["state"]
        if state != last:
            print(f"  [{time.time()-t0:6.1f}s] {state} {t.get('failDetail') or ''}")
            last = state
        if state in ("success", "failed"):
            if state == "failed":
                print("FAILED:", t.get("failCategory"), t.get("failDetail"))
                return 1
            key = t["result"].get("videoKey") or t["result"].get("video_key")
            print(f"SUCCESS video_key = {key}")
            path = f"data/uploads/{key}"
            out = subprocess.run(["ls", "-la", path], capture_output=True, text=True)
            print(out.stdout.strip() or out.stderr.strip())
            ff = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True)
            meta = [ln.strip() for ln in ff.stderr.splitlines() if "Duration" in ln or "Video:" in ln]
            print("\n".join(meta))
            return 0
        time.sleep(5)
    print("TIMEOUT")
    return 1


if __name__ == "__main__":
    sys.exit(main())
