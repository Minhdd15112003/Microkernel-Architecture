import { PluggableServer } from './index.js';
import { resolve } from 'path';

const modulesPath = resolve('../modules');
const server = new PluggableServer(modulesPath, 3000);

server.start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
