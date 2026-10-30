import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createDb, migrateSchema, parameters } from "./db.ts";
import { createTestDb, testDatabaseUrl } from "./test-db.ts";

describe("PostgreSQL database", () => {
  it("creates the current schema and rolls back failed transactions", async () => {
    const db = await createTestDb(randomUUID());
    try {
      expect(await db.prepare("SELECT version FROM api_schema_version").get()).toMatchObject({ version: 3 });
      await expect(db.transaction(async () => {
        await db.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
          .run("rollback-account", "rollback@example.com", "hash", 1, 1);
        throw new Error("stop");
      })).rejects.toThrow("stop");
      expect(await db.prepare("SELECT id FROM accounts WHERE id=?").get("rollback-account")).toBeUndefined();
    } finally { await db.close(); }
  });

  it("requires an explicit database URL", async () => {
    await expect(createDb("")).rejects.toThrow("DATABASE_URL");
  });

  it("fails startup when PostgreSQL cannot be reached", async () => {
    await expect(createDb("postgresql://127.0.0.1:1/unreachable?connect_timeout=1")).rejects.toThrow();
  });

  it("rejects a mismatched schema version without running DDL", async () => {
    const key = randomUUID();
    const url = await testDatabaseUrl(key);
    const db = await createDb(url);
    await db.prepare("UPDATE api_schema_version SET version=999").run();
    await db.close();
    await expect(createDb(url)).rejects.toThrow("schema version");
  });

  it("upgrades an occupied PostgreSQL schema 1 to 3 without changing existing records", async () => {
    const url = await testDatabaseUrl(randomUUID(), false);
    const client = new Client({ connectionString: url });
    const originalTables = [
      "accounts", "sessions", "projects", "objects", "agent_runs", "run_events", "operations",
      "resource_revisions", "project_commands", "video_edits", "edit_commands",
      "render_operations", "render_events", "prompt_idea_sets", "api_schema_version",
    ];
    const addedTables = ["tts_tasks", "episode_render_operations", "agent_edit_sets", "preview_operations", "preview_owned_objects"];
    try {
      await client.connect();
      await client.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
      await client.query("INSERT INTO api_schema_version(version) VALUES (1)");
      await client.query("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES ('a','a@example.com','hash',1,3)");
      await client.query("INSERT INTO sessions(id,account_id,expires_at) VALUES ('s','a',100)");
      await client.query("INSERT INTO projects(id,owner_id,title,document_json,created_at) VALUES ('p','a','Old project','{}',2)");
      await client.query("INSERT INTO objects(id,owner_id,sha256,mime,size,path,created_at) VALUES ('o','a','sha','image/jpeg',2,'/old/object.jpg',3)");
      await client.query(`INSERT INTO agent_runs(id,owner_id,project_id,client_request_id,request_hash,episode_id,source_object_id,prompt,duration_sec,plan_json,plan_hash,state,created_at,updated_at)
        VALUES ('r','a','p','request','hash','episode','o','prompt',5,'{}','plan','running',4,4)`);
      await client.query("INSERT INTO run_events(run_id,seq,state,message,created_at) VALUES ('r',1,'running','started',4)");
      await client.query("INSERT INTO operations(id,run_id,approval_id,state,external_task_id,created_at) VALUES ('op','r','approval','running','external',4)");
      await client.query("INSERT INTO resource_revisions(project_id,resource_type,resource_id,revision) VALUES ('p','episode','episode',2)");
      await client.query("INSERT INTO project_commands(project_id,command_id,payload_hash,resource_type,resource_id,resulting_revision,created_at) VALUES ('p','cmd','hash','episode','episode',2,4)");
      await client.query("INSERT INTO video_edits(id,owner_id,project_id,episode_id,shot_id,source_object_id,recipe_json,revision,created_at,updated_at) VALUES ('e','a','p','episode','shot','o','{}',1,5,5)");
      await client.query("INSERT INTO edit_commands(edit_id,command_id,payload_hash,resulting_revision) VALUES ('e','edit-cmd','hash',1)");
      await client.query("INSERT INTO render_operations(id,edit_id,owner_id,recipe_revision,recipe_json,state,created_at,updated_at) VALUES ('render','e','a',1,'{}','running',5,5)");
      await client.query("INSERT INTO render_events(operation_id,seq,state,message,created_at) VALUES ('render',1,'running','started',5)");
      await client.query("INSERT INTO prompt_idea_sets(id,owner_id,client_request_id,input_hash,input_text,state,created_at,updated_at) VALUES ('idea','a','idea-request','hash','topic','ready',6,6)");

      const tablesBefore = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")).rows.map(row => row.tablename);
      expect(tablesBefore).toEqual([...originalTables].sort());
      const countsBefore = [];
      for (const table of originalTables) countsBefore.push(Number((await client.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count));
      await expect(createDb(url)).rejects.toThrow("schema version");

      await migrateSchema(url);
      await migrateSchema(url);

      const tablesAfter = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")).rows.map(row => row.tablename);
      expect(tablesAfter).toEqual([...originalTables, ...addedTables].sort());
      const countsAfter = [];
      for (const table of originalTables) countsAfter.push(Number((await client.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count));
      expect(countsAfter).toEqual(countsBefore);
      expect((await client.query("SELECT version FROM api_schema_version")).rows).toMatchObject([{ version: 3 }]);
      expect((await client.query("SELECT id, owner_id, title, document_json FROM projects")).rows).toMatchObject([
        { id: "p", owner_id: "a", title: "Old project", document_json: "{}" },
      ]);
      expect((await client.query("SELECT id, path FROM objects")).rows).toMatchObject([{ id: "o", path: "/old/object.jpg" }]);
      expect((await client.query("SELECT id, state, external_task_id FROM operations")).rows).toMatchObject([
        { id: "op", state: "running", external_task_id: "external" },
      ]);
      for (const table of addedTables) expect(Number((await client.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count)).toBe(0);
      const db = await createDb(url);
      await db.close();
    } finally { await client.end(); }
  });

  it("keeps schema 1 intact when an incompatible existing table makes migration fail", async () => {
    const url = await testDatabaseUrl(randomUUID(), false);
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      await client.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
      await client.query("INSERT INTO api_schema_version(version) VALUES (1)");
      await client.query("CREATE TABLE tts_tasks (id TEXT PRIMARY KEY)");

      await expect(migrateSchema(url)).rejects.toThrow();

      expect((await client.query("SELECT version FROM api_schema_version")).rows).toMatchObject([{ version: 1 }]);
      expect((await client.query("SELECT to_regclass('episode_render_operations') AS name, to_regclass('preview_operations') AS preview")).rows)
        .toMatchObject([{ name: null, preview: null }]);
      expect((await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='tts_tasks' ORDER BY column_name")).rows)
        .toEqual([{ column_name: "id" }]);
    } finally { await client.end(); }
  });

  it("leaves quoted question marks and PostgreSQL JSON operators unchanged", () => {
    expect(parameters("SELECT '?' AS mark, data ? 'key', data ?| array['a'], id=?")).toBe("SELECT '?' AS mark, data ? 'key', data ?| array['a'], id=$1");
    expect(parameters("SELECT data ? ? FROM records WHERE id=?")).toBe("SELECT data ? $1 FROM records WHERE id=$2");
    expect(parameters("SELECT ? AS value, $tag$?$tag$ AS literal /* ? */ -- ?\nWHERE id=?")).toBe("SELECT $1 AS value, $tag$?$tag$ AS literal /* ? */ -- ?\nWHERE id=$2");
  });
});
