import { Router } from 'express';
import { EventEmitter } from 'events';

export interface ILogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface IEventBus {
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

export interface CoreContext {
  logger: ILogger;
  eventBus: IEventBus;
  config: Record<string, any>;
}

export interface IPlugin {
  name: string;
  version: string;
  dependencies?: string[];
  initialize(context: CoreContext): Promise<void>;
  execute(router: Router): Promise<void>;
  shutdown(): Promise<void>;
}
