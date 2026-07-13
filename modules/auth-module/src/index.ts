import { Router } from "express";
import { IPlugin, CoreContext, IEventBus } from "@pluggable/shared-common";
import initSqlJs, { Database as SqlJsDb } from "sql.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

export class AuthModule implements IPlugin {
  public readonly name = "auth-module";
  public readonly version = "1.0.0";
  public readonly dependencies = [];
  private db: SqlJsDb | null = null;
  private dbPath: string = "";
  private bus: IEventBus | null = null;

  async initialize(context: CoreContext): Promise<void> {
    this.bus = context.eventBus;
    const dbDir = dirname(fileURLToPath(import.meta.url));
    this.dbPath = join(dbDir, "..", "auth.db");
    const SQL = await initSqlJs();
    this.db = existsSync(this.dbPath)
      ? new SQL.Database(readFileSync(this.dbPath))
      : new SQL.Database();
    this.db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    this.save();
    console.log(`[${this.name}] DB ready`);
  }

  async execute(router: Router): Promise<void> {
    // router.get("/helo", (req, res) => {
    //   res.json({ message: "bbbbbbbbbbbbbbbbb" });
    // });

    router.post("/login", (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ success: false, message: "Username and password required" });
        return;
      }
      const stmt = this.db!.prepare("SELECT id FROM users WHERE username = ? AND password = ?");
      stmt.bind([username, password]);
      const exists = stmt.step();
      stmt.free();
      if (!exists) {
        res.status(401).json({ success: false, message: "Invalid credentials" });
        return;
      }
      res.json({ success: true, token: `mock-jwt-${username}` });
    });

    router.post("/register", (req, res) => {
      const { username, password } = req.body || {};
      if (!username || !password) {
        res.status(400).json({ success: false, message: "Username and password required" });
        return;
      }
      try {
        this.db!.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password]);
        this.save();
        this.bus?.emit("user:created", { username });
        res.json({ success: true, message: "User registered" });
      } catch (err: any) {
        if (err?.message?.includes("UNIQUE")) {
          res.status(409).json({ success: false, message: "Username already exists" });
          return;
        }
        throw err;
      }
    });
  }

  async shutdown(): Promise<void> {
    this.db?.close();
    this.db = null;
    console.log(`[${this.name}] DB closed`);
  }

  private save(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db!.export()));
  }
}

export default new AuthModule();
