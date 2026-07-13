import express, { Express, Router, Request, Response, NextFunction } from "express";
import { resolve } from "path";
import { EventEmitter } from "events";
import winston from "winston";
import { IPlugin, CoreContext } from "@pluggable/shared-common";
import { ModuleManager } from "./module-manager.js";

function wrapAsyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const p = fn(req, res, next);
      if (p?.catch) p.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

function wrapRouterForCircuitBreaker(router: Router, moduleName: string) {
  router.stack.forEach((layer: any) => {
    if (!layer.route) return;
    layer.route.stack.forEach((sub: any) => {
      sub.handle = wrapAsyncHandler(sub.handle);
    });
  });
  router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`[${moduleName}] Route error:`, err);
    res.status(503).json({ error: `${moduleName} temporarily unavailable` });
  });
}

const log = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "server.log" }),
  ],
});

export class PluggableServer {
  private app: Express;
  private manager: ModuleManager;
  private modulePath: string;
  private port: number;
  private context: CoreContext;
  private moduleRouters: Map<string, Router> = new Map();

  constructor(modulePath: string, port: number = 3000) {
    this.app = express();
    this.manager = new ModuleManager();
    this.modulePath = resolve(modulePath);
    this.port = port;
    this.context = {
      logger: log,
      eventBus: new EventEmitter(),
      config: {},
    };
    this.app.use(express.json());
    this.app.use((req, _res, next) => {
      log.info(`${req.method} ${req.path}`);
      next();
    });
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get("/health", (_req, res) => {
      res.json({ status: "running", modules: this.manager.getLoadedModules() });
    });
    this.app.get("/modules", (_req, res) => {
      res.json({ modules: this.manager.getLoadedModules() });
    });
    this.app.post("/reload/:name", async (req, res) => {
      const { name } = req.params;
      const moduleDir = resolve(this.modulePath, name);
      try {
        await this.loadAndMount(moduleDir);
        res.json({ success: true, message: `Module ${name} reloaded` });
      } catch (err: any) {
        res.status(500).json({ success: false, message: err.message });
      }
    });
  }

  private async loadAndMount(moduleDir: string): Promise<void> {
    const name = resolve(moduleDir).split("\\").pop() || moduleDir.split("/").pop() || "";
    if (this.manager.getModule(name)) {
      await this.unloadAndUnmount(name);
    }
    const module = await this.manager.loadModule(moduleDir, this.context);
    const router = Router();
    await module.execute(router);
    console.log(
      module.name,
      "routes:",
      router.stack.map((layer: any) => layer.route?.path).filter(Boolean),
    );
    wrapRouterForCircuitBreaker(router, module.name);
    this.app.use(`/api/v1/modules/${module.name}`, router);
    this.moduleRouters.set(module.name, router);
  }

  private async unloadAndUnmount(moduleName: string): Promise<void> {
    const router = this.moduleRouters.get(moduleName);
    this.moduleRouters.delete(moduleName);
    if (router) {
      const idx = (this.app._router.stack as any[]).findIndex(l => l.handle === router);
      if (idx !== -1) this.app._router.stack.splice(idx, 1);
    }
    await this.manager.unloadModule(moduleName);
  }

  async start(): Promise<void> {
    const dirs = this.manager.scanModules(this.modulePath);
    for (const dir of dirs) {
      try {
        await this.loadAndMount(dir);
      } catch (err) {
        console.error(`Skipping failed module: ${dir}`, err);
      }
    }
    this.manager.startWatcher(
      this.modulePath,
      (dir) => this.loadAndMount(dir),
      (name) => this.unloadAndUnmount(name),
    );
    this.app.listen(this.port, () => {
      console.log(`Pluggable Backend Server started on port ${this.port}`);
      console.log(`Loaded: ${this.manager.getLoadedModules().join(", ")}`);
    });
  }
}

export default PluggableServer;
