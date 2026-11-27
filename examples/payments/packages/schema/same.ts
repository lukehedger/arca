// True only when A and B accept the same values. Wrap it in Assert, so a schema that drifts from the core's type fails to compile.
export type Same<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

export type Assert<T extends true> = T;
