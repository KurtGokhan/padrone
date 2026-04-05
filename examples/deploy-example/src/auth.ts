import { defineInterceptor } from 'padrone';
import type { User } from './types.ts';

/**
 * Interceptor that authenticates the current user and provides `{ user: User }` to the command context.
 * In a real app, this would read a token from the environment, keychain, or config file.
 */
export const authInterceptor = defineInterceptor({ name: 'auth', order: -500 }, () => ({
  start(ctx, next) {
    const user: User = { name: 'alice', role: 'admin' };
    // NOTE: See ISSUES.md — requires `as any` to spread existing context onto the new one.
    // There is no type-safe way to extend context in an interceptor's start phase.
    return next({ context: { ...(ctx.context as Record<string, unknown>), user } });
  },
})).provides<{ user: User }>();
