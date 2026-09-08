import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';

const { jwtVerifyMock } = vi.hoisted(() => ({ jwtVerifyMock: vi.fn() }));

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    jwtVerify: jwtVerifyMock,
  };
});

function buildContext(headers: Record<string, string>, req: Record<string, unknown> = {}) {
  const request = { headers, ...req };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let reflector: Reflector;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_JWKS_URL = 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    reflector = new Reflector();
    guard = new SupabaseAuthGuard(reflector);
  });

  it('permite el paso sin token si la ruta es @Public()', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    await expect(guard.canActivate(buildContext({}))).resolves.toBe(true);
    expect(jwtVerifyMock).not.toHaveBeenCalled();
  });

  it('rechaza si falta el header Authorization', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza si el header no es tipo Bearer', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

    await expect(
      guard.canActivate(buildContext({ authorization: 'Basic algo' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza si jwtVerify falla (token inválido o expirado)', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtVerifyMock.mockRejectedValue(new Error('signature verification failed'));

    await expect(
      guard.canActivate(buildContext({ authorization: 'Bearer token-invalido' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('acepta y adjunta el payload a request.user si el token es válido', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const payload = { sub: 'user-1', role: 'authenticated' };
    jwtVerifyMock.mockResolvedValue({ payload });

    const request: Record<string, unknown> = { headers: { authorization: 'Bearer token-valido' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => vi.fn(),
      getClass: () => vi.fn(),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });
});
