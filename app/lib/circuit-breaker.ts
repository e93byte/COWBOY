type State = {
  failures: number;
  openUntil: number;
  halfOpenProbe: boolean;
};

type CircuitBreakerOptions = {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
};

/** Small in-process breaker for provider/capability keys. */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, State>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(1, options.cooldownMs ?? 30_000);
    this.now = options.now ?? Date.now;
  }

  allow(key: string): boolean {
    const state = this.states.get(key);
    if (!state || state.openUntil === 0) return true;
    if (this.now() < state.openUntil) return false;
    if (state.halfOpenProbe) return false;
    state.halfOpenProbe = true;
    return true;
  }

  success(key: string): void {
    this.states.delete(key);
  }

  failure(key: string): void {
    const state = this.states.get(key) ?? { failures: 0, openUntil: 0, halfOpenProbe: false };
    state.failures += 1;
    state.halfOpenProbe = false;
    if (state.openUntil > 0 || state.failures >= this.failureThreshold) {
      state.openUntil = this.now() + this.cooldownMs;
    }
    this.states.set(key, state);
  }
}
