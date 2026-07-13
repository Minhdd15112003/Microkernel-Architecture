import { Router } from "express";
import { IPlugin, CoreContext, IEventBus } from "@pluggable/shared-common";
import initSqlJs, { Database as SqlJsDb } from "sql.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";

export class PaymentModule implements IPlugin {
  public readonly name = "payment-module";
  public readonly version = "1.0.0";
  public readonly dependencies = [];
  private db: SqlJsDb | null = null;
  private dbPath: string = "";
  private bus: IEventBus | null = null;
  private onUserCreated: ((payload: { username: string }) => void) | null = null;

  async initialize(context: CoreContext): Promise<void> {
    this.bus = context.eventBus;
    const dbDir = dirname(fileURLToPath(import.meta.url));
    this.dbPath = join(dbDir, "..", "payment.db");
    const SQL = await initSqlJs();
    this.db = existsSync(this.dbPath)
      ? new SQL.Database(readFileSync(this.dbPath))
      : new SQL.Database();
    this.db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      balance REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    this.save();

    this.onUserCreated = (payload) => {
      if (!this.db) return;
      try {
        this.db.run("INSERT INTO wallets (username, balance) VALUES (?, 0)", [payload.username]);
        this.save();
        console.log(`[${this.name}] Wallet created for ${payload.username}`);
      } catch (err: any) {
        if (!err?.message?.includes("UNIQUE")) console.error(`[${this.name}] Wallet error:`, err);
      }
    };
    this.bus.on("user:created", this.onUserCreated);
    console.log(`[${this.name}] DB ready, listening for user:created`);
  }

  async execute(router: Router): Promise<void> {
    router.post("/checkout", (req, res) => {
      const { amount, currency } = req.body || {};
      if (!amount) {
        res.status(400).json({ success: false, message: "Amount required" });
        return;
      }
      this.db!.run("INSERT INTO transactions (amount, currency) VALUES (?, ?)", [
        amount,
        currency || "USD",
      ]);
      this.save();
      const id = this.db!.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
      res.json({
        success: true,
        transactionId: `txn-${id}`,
        amount,
        currency: currency || "USD",
      });
    });

    // router.get("/helo", (req, res) => {
    //   res.json({ message: "cccccccccccccccc" });
    // });
  }

  async shutdown(): Promise<void> {
    if (this.onUserCreated && this.bus) {
      this.bus.off("user:created", this.onUserCreated);
    }
    this.db?.close();
    this.db = null;
    console.log(`[${this.name}] DB closed, unsubscribed`);
  }

  private save(): void {
    writeFileSync(this.dbPath, Buffer.from(this.db!.export()));
  }
}

export default new PaymentModule();
