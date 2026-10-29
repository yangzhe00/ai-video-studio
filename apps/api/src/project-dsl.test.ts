import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./db.ts";
import { readProjectDsl } from "./project-dsl.ts";

describe("read-only project DSL projection", () => {
  it("restores every successful edited output without changing the legacy document", () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-dsl-projection-"));
    const db = createDb(dir);
    try {
      const ownerId = "owner-1", projectId = "project-1";
      db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
        .run(ownerId, "owner@example.com", "hash", 1, 1);
      const originalDocument = { version: 1, assets: [
        { id: "photo-1", kind: "image" }, { id: "video-1", kind: "video" }, { id: "video-3", kind: "video" },
      ], characters: [], episodes: [{ id: "episode-1", title: "第 1 集", timeline: ["video-1"],
        timelineClips: [{ id: "clip-1", assetId: "video-1", inMs: 0, outMs: 5000, volume: 1 }],
        shots: [{ id: "shot-1", runId: "run-1", sourceAssetId: "photo-1", prompt: "小狗做饭", durationSec: 5,
          originalAssetId: "video-1", resultAssetId: "video-3", selectedAssetId: "video-3" }] }] };
      const raw = JSON.stringify(originalDocument);
      db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
        .run(projectId, ownerId, "项目", 3, raw, 1);
      for (const [index, id] of ["video-1", "video-2", "video-3", "cover-2", "cover-3"].entries()) {
        db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(id, ownerId, `sha-${index}`, id.startsWith("cover") ? "image/jpeg" : "video/mp4", 1, `/tmp/${id}`, 1);
      }
      db.prepare(`INSERT INTO video_edits
        (id,owner_id,project_id,episode_id,shot_id,source_object_id,recipe_json,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run("edit-1", ownerId, projectId, "episode-1", "shot-1", "video-1", "{}", 2, 1, 2);
      for (const [index, id] of ["video-2", "video-3"].entries()) {
        db.prepare(`INSERT INTO render_operations
          (id,edit_id,owner_id,recipe_revision,recipe_json,state,output_object_id,cover_object_id,created_at,updated_at)
          VALUES (?,?,?,?,?,'succeeded',?,?,?,?)`)
          .run(`render-${index}`, "edit-1", ownerId, index + 1, "{}", id, `cover-${index + 2}`, index + 1, index + 1);
      }
      const projected = readProjectDsl(db, ownerId, projectId);
      expect(projected?.document.episodes[0].scenes[0]).toMatchObject({
        outputAssetIds: ["video-1", "video-2", "video-3"], selectedAssetId: "video-3",
      });
      expect(projected?.document.assets.items.filter(item => item.kind === "thumbnail")).toHaveLength(2);
      expect(projected?.document.episodes[0].tracks[0].clips[0].assetId).toBe("video-1");
      expect(db.prepare("SELECT document_json FROM projects WHERE id=?").get(projectId)).toMatchObject({ document_json: raw });
      expect(readProjectDsl(db, "other-owner", projectId)).toBeNull();
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
