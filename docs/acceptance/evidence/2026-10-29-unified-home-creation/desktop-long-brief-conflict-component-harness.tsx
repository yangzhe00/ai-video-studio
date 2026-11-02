import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SyncConflictDialog } from "@ai-video/ui-web";
import "@ai-video/ui-web/styles.css";

const common = "共同的长剧本内容。".repeat(130);
function Harness() {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".avs-sync-conflict-brief pre").forEach(node => { node.scrollTop = node.scrollHeight; });
  }, []);
  return <><SyncConflictDialog projectTitle="长剧本冲突 · QA 组件测试" resources={[{
    resourceType: "brief", resourceId: "brief-qa", title: "创作原文",
    local: { revision: 2, preview: "", brief: { source: "manual", originalText: common, finalText: common + "【本端结尾】小狗把热菜端上桌。" } },
    cloud: { revision: 3, preview: "", brief: { source: "manual", originalText: common, finalText: common + "【云端结尾】小狗先在厨房摆盘。" } },
  }]} onCancel={() => {}} onResolve={() => {}} />
    <div style={{ position: "fixed", top: 0, left: 0, zIndex: 9999, padding: 8, background: "#fff", color: "#111", font: "12px sans-serif" }}>QA 组件测试页面 · 非真实云同步</div></>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
