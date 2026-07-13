import { IPlugin, CoreContext } from '@pluggable/shared-common';
import { watch } from 'chokidar';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { existsSync, readdirSync } from 'fs';

export class ModuleManager {
  private loadedModules: Map<string, IPlugin> = new Map();

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

    console.log(`Watching: ${pattern}`);
  }

  getLoadedModules(): string[] {
    return Array.from(this.loadedModules.keys());
  }

  getModule(name: string): IPlugin | undefined {
    return this.loadedModules.get(name);
  }
}
