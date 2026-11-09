import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));
const { migrateDatabase, uniqueAgentName } = await import("./database");

describe("member agent backfill", () => {
  it("matches uniqueAgentName for duplicates, Unicode and NUL across the 500-member boundary", () => {
    const db = new DatabaseSync(":memory:");
    const reference = new DatabaseSync(":memory:");
    try {
      migrateDatabase(db);
      db.exec(`
        drop table agent_group_members;
        create table agent_group_members (
          group_id text, session_id text, joined_at text, agent_id text, role text
        );
        insert into workspaces (id, root_path, display_name, is_git_repository, last_opened_at, created_at)
          values ('ws', '.', 'Project', 0, 'now', 'now');
        insert into agent_groups (id, name, workspace_id, mode, created_at, updated_at)
          values ('g', 'Group', 'ws', 'free', 'now', 'now');
      `);
      reference.exec("create table agents (name text collate nocase)");
      const session = db.prepare(`insert into agent_sessions
        (id, title, workspace_id, cwd, status, created_at, updated_at)
        values (?, ?, 'ws', '.', 'idle', 'now', 'now')`);
      const member = db.prepare(`insert into agent_group_members
        (group_id, session_id, joined_at) values ('g', ?, 'now')`);
      const expected: string[] = [];
      const titles = [
        "Jennie",
        "jennie",
        "Jennie 2",
        "Ä",
        "ä",
        "İ",
        "i",
        "",
        "  Agent  ",
        "A\0x",
        "a\0y",
        "B\0yy",
        "b\0é",
        "b\0xx",
        "A",
        "a\0",
        "😀",
        "K",
        "k",
      ];
      const afterBatch = ["Ä", "ä", "A\0zz", "a\0ww", "Jennie"];
      for (let i = 0; i < 505; i++) {
        const title =
          (i >= 500 ? afterBatch[i - 500] : titles[i < titles.length ? i : i % 9]) ?? "";
        session.run(String(i), title);
        member.run(String(i));
        const name = uniqueAgentName(reference, title.trim() || "Agent");
        expected.push(name);
        reference.prepare("insert into agents (name) values (?)").run(name);
      }
      migrateDatabase(db);
      const names = db
        .prepare(`select a.name from agent_group_members m
        join agents a on a.id = m.agent_id order by cast(m.session_id as integer)`)
        .all();
      expect(names.map((row) => row.name)).toEqual(expected);
      migrateDatabase(db);
      expect(db.prepare("select count(*) as count from agents").get()?.count).toBe(505);
    } finally {
      db.close();
      reference.close();
    }
  });
});
