"""真实供应商端到端验证（Cursor LLM + 可灵图生视频）。

流程：登录 → 上传素材 → Cursor 生成选题 → 选定生成讲稿 → 生成分镜提示词
→ 提交可灵图生视频 → 轮询至成功 → 校验视频落盘。

用法：uv run python scripts/e2e_real_kling.py
"""

import os
import subprocess
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000/api"
IMG = "/Volumes/project/代码/ai-video-studio/design/images/generated-1793151094939.png"
FFMPEG = os.path.expanduser("~/.local/bin/ffmpeg")
KLING_TIMEOUT_SEC = 900


def main() -> int:
    s = httpx.Client(trust_env=False, timeout=httpx.Timeout(240.0, connect=15.0))  # 本地服务不走系统代理

    phone = "13800001234"
    r = s.post(f"{BASE}/auth/send-code", json={"phone": phone}, timeout=15)
    if r.status_code == 429:  # 验证码 60s 重发间隔
        print("   send-code 频控中，等待 65s 重试")
        time.sleep(65)
        r = s.post(f"{BASE}/auth/send-code", json={"phone": phone}, timeout=15)
    r.raise_for_status()
    code = r.json()["demoCode"]
    r = s.post(f"{BASE}/auth/login", json={"phone": phone, "code": code}, timeout=15)
    r.raise_for_status()
    s.headers["Authorization"] = f"Bearer {r.json()['token']}"
    print("1. login ok")

    with open(IMG, "rb") as f:
        r = s.post(f"{BASE}/assets/upload", files={"files": ("shiba.png", f, "image/png")}, timeout=60)
    r.raise_for_status()
    asset_id = r.json()[0]["id"]
    print(f"2. asset uploaded: {asset_id}")

    t0 = time.time()
    r = s.post(f"{BASE}/topics/generate", json={"keyword": "小狗"}, timeout=240)
    r.raise_for_status()
    topics = r.json()
    print(f"3. cursor topics ({time.time()-t0:.0f}s):")
    for t in topics:
        print(f"   - {t['title']}  |  {t['angle']}")

    t0 = time.time()
    topic_id = topics[0]["id"]
    s.post(f"{BASE}/topics/{topic_id}/select", timeout=30).raise_for_status()
    r = s.post(f"{BASE}/topics/{topic_id}/script", timeout=240)
    r.raise_for_status()
    script = r.json()
    print(f"4. cursor script ({time.time()-t0:.0f}s):")
    for seg in script["segments"]:
        print(f"   [{seg['index']}] {seg['text'][:42]}...")

    t0 = time.time()
    r = s.post(f"{BASE}/scripts/{script['id']}/prompts", timeout=240)
    r.raise_for_status()
    prompts = r.json()["segments"]
    print(f"5. cursor prompts ({time.time()-t0:.0f}s): {prompts[0]['prompt'][:50]}...")

    r = s.post(
        f"{BASE}/tasks/video-gen",
        json={
            "scriptId": script["id"],
            "segmentIndex": 0,
            "assetId": asset_id,
            "prompt": prompts[0]["prompt"],
        },
        timeout=60,
    )
    if r.status_code >= 400:
        print("kling submit failed:", r.status_code, r.text[:300])
        return 1
    task_id = r.json()["id"]
    print(f"6. kling task submitted: {task_id}, polling (up to {KLING_TIMEOUT_SEC}s)...")

    t0 = time.time()
    last = ""
    while time.time() - t0 < KLING_TIMEOUT_SEC:
        t = s.get(f"{BASE}/tasks/{task_id}", timeout=15).json()
        state = t["state"]
        if state != last:
            print(f"   [{time.time()-t0:6.1f}s] {state} {t.get('failDetail') or ''}")
            last = state
        if state in ("success", "failed"):
            if state == "failed":
                print("KLING FAILED:", t.get("failCategory"), t.get("failDetail"))
                return 1
            video_key = t.get("result", {}).get("videoKey") or t.get("result", {}).get("video_key")
            print(f"7. kling success! video_key = {video_key}")
            break
        time.sleep(4)
    else:
        print("KLING TIMEOUT")
        return 1

    path = f"data/uploads/{video_key}"
    out = subprocess.run(["ls", "-la", path], capture_output=True, text=True)
    print(out.stdout.strip() or out.stderr.strip())
    ff = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True)
    meta = [ln.strip() for ln in ff.stderr.splitlines() if "Duration" in ln or "Video:" in ln]
    print("\n".join(meta))
    return 0


if __name__ == "__main__":
    sys.exit(main())
