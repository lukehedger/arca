import {
  type CapabilitySignatures,
  type ContextConfig,
  createContextDeps,
} from '@<project>/adapters';
import type { Variant } from '@<project>/schema';
import { registry } from './registry.ts';
import { createRouter, type Router } from './router.ts';

export type AppRouter = Router<Variant, CapabilitySignatures>;

// The production wiring a handler's entry point uses. Each layer builds the one below it from plain config.
export const createAppRouter = (config: ContextConfig): AppRouter =>
  createRouter({ registry, contextDeps: createContextDeps(config) });
