import { defineInterceptor } from 'padrone';
import type { User } from './types.ts';

/**
 * Interceptor that authenticates the current user and provides `{ user: User }` to the command context.
 * In a real app, this would read a token from the environment, keychain, or config file.
 */
export const authInterceptor = defineInterceptor({ name: 'auth', order: -500 }, () => ({
  start(_ctx, next) {
    const user: User = { name: 'alice', role: 'admin' };
    return next({ context: { user } });
  },
})).provides<{ user: User }>();
