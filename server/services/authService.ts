import type { SessionUser, UserRole } from '../../shared/types.js';
import type { Store, UserRow } from '../db/store.js';
import { AppError } from '../http/appError.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../security/passwords.js';

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  };
}

// A real hash used to equalize timing when the email does not exist.
let dummyHash: Promise<string> | null = null;

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly opts: { ownerEmail: string; sessionTtlMs: number },
  ) {}

  async register(input: { email: string; password: string; displayName: string }): Promise<UserRow> {
    if (await this.store.findUserByEmail(input.email)) throw new AppError('EMAIL_TAKEN');
    // OWNER_EMAIL decides the owner; when it is not set, the very first account becomes the owner (admin panel).
    const isOwner = this.opts.ownerEmail ? input.email === this.opts.ownerEmail : (await this.store.countUsers()) === 0;
    const role: UserRole = isOwner ? 'owner' : 'user';
    return this.store.createUser({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
      role,
    });
  }

  async login(email: string, password: string): Promise<UserRow> {
    const user = await this.store.findUserByEmail(email);
    if (!user) {
      dummyHash ??= hashPassword(randomToken());
      await verifyPassword(password, await dummyHash);
      throw new AppError('INVALID_CREDENTIALS');
    }
    if (user.disabled || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError('INVALID_CREDENTIALS');
    }
    return user;
  }

  /** Returns the raw session token for the cookie; only its SHA-256 is stored. */
  async createSession(userId: string, userAgent: string | undefined): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.opts.sessionTtlMs);
    await this.store.createSession({
      tokenHash: sha256(token),
      userId,
      userAgent: userAgent?.slice(0, 200) ?? null,
      expiresAt,
    });
    return { token, expiresAt };
  }

  async resolveSession(token: string | undefined): Promise<{ user: UserRow; sessionId: string } | null> {
    if (!token || token.length > 128) return null;
    const session = await this.store.findSessionByTokenHash(sha256(token));
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.store.deleteSession(session.id);
      return null;
    }
    const user = await this.store.findUserById(session.userId);
    if (!user || user.disabled) return null;
    return { user, sessionId: session.id };
  }

  async logout(sessionId: string) {
    await this.store.deleteSession(sessionId);
  }
}
