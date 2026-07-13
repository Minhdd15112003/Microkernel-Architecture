import { IPlugin, CoreContext } from '@pluggable/shared-common';
import { watch } from 'chokidar';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync, readdirSync } from 'fs';

export class ModuleManager {
  private loadedModules: Map<string, IPlugin> = new Map();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private modulesPath: string = '';
  private onLoadCallback: ((moduleDir: string) => Promise<void>) | null = null;
  private onUnloadCallback: ((moduleName: string) => Promise<void>) | null = null;

  scanModules(basePath: string): string[] {
    const dirs: string[] = [];
    for (const entry of readdirSync(basePath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const distIndex = join(basePath, entry.name, 'dist', 'index.js');
        if (existsSync(distIndex)) dirs.push(join(basePath, entry.name));
      }
    }
    return dirs;
  }

  async loadModule(moduleDir: string, context: CoreContext): Promise<IPlugin> {
    const distPath = join(moduleDir, 'dist', 'index.js');
    const absolutePath = resolve(distPath);
    const moduleURL = pathToFileURL(absolutePath).href;
    const moduleExports = await import(`${moduleURL}?t=${Date.now()}`);
    const module: IPlugin = moduleExports.default;
    if (!module?.name || !module?.initialize || !module?.execute || !module?.shutdown) {
      throw new Error(`Invalid module at ${moduleDir}`);
    }
    await module.initialize(context);
    this.loadedModules.set(module.name, module);
    console.log(`Module loaded: ${module.name} v${module.version}`);
    return module;
  }

  async unloadModule(name: string): Promise<void> {
    const module = this.loadedModules.get(name);
    if (!module) throw new Error(`Module ${name} not loaded`);
    await module.shutdown();
    this.loadedModules.delete(name);
    console.log(`Module unloaded: ${name}`);
  }

  startWatcher(
    modulesPath: string,
    onLoad: (moduleDir: string) => Promise<void>,
    onUnload: (moduleName: string) => Promise<void>
  ): void {
    this.modulesPath = modulesPath;
    this.onLoadCallback = onLoad;
    this.onUnloadCallback = onUnload;

    const pattern = join(modulesPath, '*', 'dist');
    const watcher = watch(pattern, { ignoreInitial: true, depth: 1 });

    watcher.on('addDir', async (dirPath) => {
      if (!dirPath.endsWith('dist')) return;
      try {
        await onLoad(resolve(dirPath, '..'));
      } catch (err) {
        console.error(`Failed to load module:`, err);
      }
    });

    watcher.on('add', async (filePath) => {
      if (!filePath.endsWith('index.js') || filePath.includes('node_modules')) return;
      try {
        const moduleDir = resolve(filePath, '..', '..');
        const name = moduleDir.split('\\').pop() || moduleDir.split('/').pop() || '';
        if (this.loadedModules.has(name)) await onUnload(name);
        await onLoad(moduleDir);
      } catch (err) {
        console.error(`Failed to reload module:`, err);
      }
    });

    watcher.on('change', async (filePath) => {
      if (!filePath.endsWith('index.js') || filePath.includes('node_modules')) return;
      try {
        const moduleDir = resolve(filePath, '..', '..');
        const name = moduleDir.split('\\').pop() || moduleDir.split('/').pop() || '';
        if (this.loadedModules.has(name)) await onUnload(name);
        await onLoad(moduleDir);
      } catch (err) {
        console.error(`Failed to reload module:`, err);
      }
    });

    watcher.on('unlinkDir', async (dirPath) => {
      if (!dirPath.endsWith('dist')) return;
      try {
        const name = resolve(dirPath, '..').split('\\').pop() || '';
        await onUnload(name);
      } catch (err) {
        console.error(`Failed to unload module:`, err);
      }
    });

    watcher.on('unlink', async (filePath) => {
      if (!filePath.endsWith('index.js') || filePath.includes('node_modules')) return;
      try {
        const moduleDir = resolve(filePath, '..', '..');
        const name = moduleDir.split('\\').pop() || moduleDir.split('/').pop() || '';
        if (this.loadedModules.has(name)) await onUnload(name);
      } catch (err) {
        console.error(`Failed to unload module via unlink:`, err);
      }
    });

    // ponytail: periodic poll fallback for platforms where fs.watch events don't fire reliably
    this.pollTimer = setInterval(() => this.pollModules(), 2000);

    console.log(`Watching: ${pattern}`);
  }

  private pollModules(): void {
    // Check loaded modules — unload if dist/index.js is gone
    for (const [name, _module] of this.loadedModules) {
      const distIndex = join(this.modulesPath, name, 'dist', 'index.js');
      if (!existsSync(distIndex)) {
        this.onUnloadCallback?.(name);
      }
    }
    // Scan for new dist/ directories that watcher may have missed
    for (const entry of readdirSync(this.modulesPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const distIndex = join(this.modulesPath, entry.name, 'dist', 'index.js');
      if (existsSync(distIndex) && !this.loadedModules.has(entry.name)) {
        this.onLoadCallback?.(join(this.modulesPath, entry.name));
      }
    }
  }

  getLoadedModules(): string[] {
    return Array.from(this.loadedModules.keys());
  }

  getModule(name: string): IPlugin | undefined {
    return this.loadedModules.get(name);
  }
}
