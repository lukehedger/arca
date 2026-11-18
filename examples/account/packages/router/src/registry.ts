import { type Adapter, ledger } from '@<project>/adapters';
import type { Variant } from '@<project>/schema';

// Each adapter pairs its own context with its own capabilities, so the registry does not need to know the context type.
export const registry: Readonly<Record<Variant, Adapter<unknown>>> = {
  ledger,
};
