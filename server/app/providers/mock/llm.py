"""Mock LLM Provider：生成结构固定的选题/讲稿/提示词，保证黄金任务流演示可跑。"""

import json
import uuid


class MockLLMProvider:
    name = "mock_llm"

    def complete(self, prompt: str, **kwargs: object) -> str:
        """按任务类型返回结构化 JSON 文本（与真实 LLM 输出格式一致）。

        kwargs 支持 task_kind: topics / script / prompts。
        """
        kind = str(kwargs.get("task_kind", "topics"))
        if kind == "topics":
            keyword = str(kwargs.get("keyword", "通用"))
            count = int(kwargs.get("count", 5))  # noqa: F841 数量由调用方控制
            topics = [
                {"title": f"{keyword}的 3 个反常识技巧（{i}）", "angle": f"从第 {i} 个常见误区切入，先破后立"}
                for i in range(1, 6)
            ]
            return json.dumps({"topics": topics}, ensure_ascii=False)

        if kind == "script":
            title = str(kwargs.get("title", "未命名选题"))
            seg_count = int(kwargs.get("segments", 5))
            segs = [
                {"text": f"《{title}》第 {i} 段口播：这一段讲一个让观众想看完的钩子。", "duration_sec": 8}
                for i in range(1, seg_count + 1)
            ]
            return json.dumps({"segments": segs}, ensure_ascii=False)

        if kind == "prompts":
            segs = list(kwargs.get("segments_text", [])) or ["占位段落"]
            prompts = [
                {"index": i, "prompt": f"竖屏 9:16，明亮居家场景，主体清晰：{text[:30]}"} for i, text in enumerate(segs)
            ]
            return json.dumps({"prompts": prompts}, ensure_ascii=False)

        request_id = uuid.uuid4().hex[:8]
        return f"mock-llm-response-{request_id}"
