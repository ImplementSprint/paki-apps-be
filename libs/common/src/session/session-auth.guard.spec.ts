import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import { createSessionToken, SESSION_COOKIE } from './session.util';

function makeContext(cookieHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { cookie: cookieHeader }, user: undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;

  beforeEach(() => {
    guard = new SessionAuthGuard();
  });

  it('throws UnauthorizedException when no cookie is present', () => {
    expect(() => guard.canActivate(makeContext())).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when cookie value is not a valid session token', () => {
    expect(() => guard.canActivate(makeContext(`${SESSION_COOKIE}=garbage`))).toThrow(
      UnauthorizedException,
    );
  });

  it('returns true and attaches session to request when cookie is valid', () => {
    const payload = { userId: 'u1', role: 'customer', fullName: 'Alice' };
    const token = createSessionToken(payload);
    const request: any = { headers: { cookie: `${SESSION_COOKIE}=${token}` } };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(request.user).toEqual(payload);
  });
});
