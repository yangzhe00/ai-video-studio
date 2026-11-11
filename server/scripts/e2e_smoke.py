"""端到端 API 冒烟脚本：黄金任务流全链路（Mock Provider）。

用法：python scripts/e2e_smoke.py
覆盖：登录 → 选题 → 讲稿 → 提示词 → 素材 → 生视频 → 配音 → 校验 → 合成 → 成片
"""

import json
import sys
import time

import httpx

BASE = "http://127.0.0.1:8000/api"


def wait_task(client: httpx.Client, task_id: str, timeout: float = 60.0) -> dict:
    """轮询任务直到落定。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        tasks = client.get(f"{BASE}/tasks").json()
        for t in tasks:
            if t["id"] == task_id:
                if t["state"] in ("success", "failed", "voided", "exported"):
                    return t
        time.sleep(1)
    raise TimeoutError(f"任务 {task_id} 超时")


def main() -> int:
    c = httpx.Client(timeout=30)
    phone = f"1380000{int(time.time()) % 10000:04d}"

    sent = c.post(f"{BASE}/auth/send-code", json={"phone": phone}).json()
    code = sent["demoCode"]
    token = c.post(f"{BASE}/auth/login", json={"phone": phone, "code": code}).json()["token"]
    c.headers["Authorization"] = f"Bearer {token}"
    me = c.get(f"{BASE}/me").json()
    print(f"[1] 登录 OK  余额={me['quotaBalance']}  预警={me['quotaWarn']}")

    topics = c.post(f"{BASE}/topics/generate", json={"keyword": "居家收纳"}).json()
    assert len(topics) == 5, topics
    print(f"[2] 选题生成 5 条 OK  首条：{topics[0]['title']}")

    topic = c.post(f"{BASE}/topics/{topics[0]['id']}/select").json()
    script = c.post(f"{BASE}/topics/{topic['id']}/script").json()
    assert len(script["segments"]) == 5
    print(f"[3] 讲稿生成 {len(script['segments'])} 段 OK")

    script = c.post(f"{BASE}/scripts/{script['id']}/prompts").json()
    assert all(s["prompt"] for s in script["segments"])
    print(f"[4] 分镜提示词 OK  首段：{script['segments'][0]['prompt'][:24]}...")

    # 生成一张 mock 图 + 上传一张真实 png
    gen = c.post(f"{BASE}/assets/generate", json={"prompt": "明亮卧室衣柜"}).json()
    gen_task = wait_task(c, gen["taskId"])
    assert gen_task["state"] == "success", gen_task
    print(f"[5] AI 生图 OK  asset={gen_task['result'].get('asset_id')[:8]}")

    png = _sample_png()
    up = c.post(f"{BASE}/assets/upload", files=[("files", ("demo.png", png, "image/png"))]).json()
    print(f"[6] 素材上传 OK  {len(up)} 张")
    asset_id = up[0]["id"]

    # 逐段提交生视频
    task_ids = []
    for seg in script["segments"]:
        r = c.post(
            f"{BASE}/tasks/video-gen",
            json={"scriptId": script["id"], "segmentIndex": seg["index"], "assetId": asset_id, "prompt": seg["prompt"]},
        )
        assert r.status_code == 200, r.text
        task_ids.append(r.json()["id"])
    print(f"[7] 提交 {len(task_ids)} 个生视频任务 OK")

    for tid in task_ids:
        t = wait_task(c, tid)
        assert t["state"] == "success", f"任务 {tid} 失败 {t['failCategory']}"
    print("[8] 全部片段生成成功 OK")

    tts = c.post(f"{BASE}/compose/tts", json={"scriptId": script["id"]}).json()
    for tid in tts["taskIds"]:
        assert wait_task(c, tid)["state"] == "success"
    print(f"[9] TTS 配音 {len(tts['taskIds'])} 段 OK")

    check = c.get(f"{BASE}/compose/check", params={"script_id": script["id"]}).json()
    assert check["ready"], check
    print("[10] 合成要素校验 ready OK")

    templates = c.get(f"{BASE}/templates").json()
    comp = c.post(f"{BASE}/compose", json={"scriptId": script["id"], "templateId": templates[0]["id"]}).json()
    comp_task = wait_task(c, comp["taskId"], timeout=120)
    assert comp_task["state"] == "success", comp_task
    print(f"[11] 合成成功 OK  版本 v{comp['versionNo']}")

    comps = c.get(f"{BASE}/compositions").json()
    assert comps and comps[0]["videoUrl"], comps
    video = c.get("http://127.0.0.1:8000" + comps[0]["videoUrl"])
    print(f"[12] 成片可下载 OK  {len(video.content)/1024:.0f}KB  {comps[0]['videoUrl']}")

    quota = c.get(f"{BASE}/quota").json()
    print(f"[13] 额度结算 余额={quota['balance']} 明细={len(quota['ledger'])} 条")

    tasks = c.get(f"{BASE}/tasks").json()
    print(f"[14] 任务中心 共 {len(tasks)} 条（含 TTS/生图/生视频/合成）")

    print("\n✅ 黄金任务流端到端跑通")
    print(json.dumps({"phone": phone, "token": token, "scriptId": script["id"]}, ensure_ascii=False))
    return 0


def _sample_png() -> bytes:
    """生成一张 2x2 PNG 作为上传样例。"""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"\x00\xff\x66\x33\xff\x66\x33" * 2
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    sys.exit(main())
