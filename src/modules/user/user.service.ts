import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { MailService } from "../../common/mail.service";
import { conflict, forbidden, unprocessable } from "../../common/errors/app-error";
import { PRIVILEGED_ROLES, ROLES, type Role } from "../../common/constants";
import { assertSameInstitute, inInstitute } from "../../common/institute-scope";
import { log } from "../../common/logger";
import type { Actor } from "../../common/actor";
import { AuthService } from "../auth/auth.service";
import { RefreshTokenService } from "../auth/refresh-token.service";

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
    private readonly refresh: RefreshTokenService,
  ) {}

  /**
   * The account list the Users module renders - the caller's institute only. `select`, never
   * `include` — `passwordHash` lives on this table.
   *
   * The two profile relations are here because the table shows a student's class and a
   * teacher's designation under their name; each is narrowed to just that field.
   */
  async list(actor: Actor) {
    return this.prisma.user.findMany({
      where: inInstitute(actor),
      select: {
        id: true, loginId: true, name: true, email: true, role: true,
        active: true, mustChangePassword: true, createdAt: true,
        studentProfile: { select: { classLevel: true } },
        teacherProfile: { select: { designation: true } },
      },
      orderBy: [{ role: "asc" }, { id: "asc" }],
    });
  }

  /** A user of the actor's own institute, or "not found". */
  private async ownUser(userId: number, actor: Actor) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, loginId: true, email: true, role: true, instituteId: true },
    });
    return assertSameInstitute(actor, user, "User");
  }

  /**
   * SEC-2: an office-issued credential must be replaced by its holder at first sign-in.
   * The account joins the creator's institute; only a super admin may name another one (to
   * open a new institute with its Head Master). Super admin and Head Master accounts can only
   * be made by a super admin - `users:manage` alone is IT support's, and must not mint either.
   */
  async create(
    input: { loginId: string; name: string; email?: string | null; role: string; classLevel?: string; designation?: string; instituteId?: number },
    actor: Actor,
    ip?: string,
  ) {
    if (!Object.values(ROLES).includes(input.role as never)) throw unprocessable("Choose a valid role.");
    if (PRIVILEGED_ROLES.includes(input.role as Role) && actor.role !== ROLES.SUPER_ADMIN) {
      log.warn("auth", "privileged_role_create_denied", { by: actor.loginId, role: input.role });
      throw forbidden("Only a super admin can create this kind of account.");
    }
    let instituteId = actor.instituteId;
    if (input.instituteId != null && input.instituteId !== actor.instituteId) {
      if (actor.role !== ROLES.SUPER_ADMIN) throw forbidden("Only a super admin can create accounts for another institute.");
      const target = await this.prisma.institute.findUnique({ where: { id: input.instituteId }, select: { id: true, active: true } });
      if (!target?.active) throw unprocessable("Choose an active institute.");
      instituteId = target.id;
    }
    if (await this.prisma.user.findUnique({ where: { loginId: input.loginId } })) {
      throw conflict(`Login ID ${input.loginId} already exists.`);
    }
    const tempPassword = randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 12);

    await this.prisma.user.create({
      data: {
        instituteId,
        loginId: input.loginId,
        name: input.name,
        email: input.email ?? null,
        passwordHash: hash,
        role: input.role,
        mustChangePassword: true,
        ...(input.role === "STUDENT"
          ? { studentProfile: { create: { studentId: input.loginId, classLevel: input.classLevel ?? "PRE_PRIMARY" } } }
          : {}),
        ...(input.role === "TEACHER"
          ? { teacherProfile: { create: { teacherId: input.loginId, designation: input.designation ?? null } } }
          : {}),
      },
    });

    if (input.email) {
      await this.mail.send(
        input.email,
        "Your BCSK account",
        this.mail.layout(
          "Account created",
          `<p style="font-size:14px;color:#232323">An account was created for you: ID <b>${input.loginId}</b>, temporary password <b>${tempPassword}</b>. You will be asked to change it at first sign-in.</p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "USER_CREATE", "User", input.loginId, input.role, { ip });
    log.info("auth", "user_created", { loginId: input.loginId, role: input.role, by: actor.loginId });
    return { loginId: input.loginId, temporaryPassword: tempPassword };
  }

  /**
   * The office sets a temporary password. Every existing session of the holder ends with it:
   * `passwordChangedAt` retires their access tokens and their refresh tokens are revoked.
   */
  async resetPassword(userId: number, actor: Actor, ip?: string) {
    const target = await this.ownUser(userId, actor);
    if (target.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
      throw forbidden("Only a super admin can reset this account.");
    }
    const tempPassword = randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 12);
    const now = new Date();
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        // SEC-2: the office chose this password, so the holder must replace it.
        data: { passwordHash: hash, mustChangePassword: true, passwordChangedAt: now },
      });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      return u;
    });
    if (user.email) {
      await this.mail.send(
        user.email,
        "BCSK password reset by office",
        this.mail.layout(
          "Password reset",
          `<p style="font-size:14px;color:#232323">Your password was reset by the school office. Temporary password: <b>${tempPassword}</b></p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "USER_PASSWORD_RESET", "User", userId, undefined, { ip });
    log.info("auth", "password_reset_by_office", { userId, loginId: user.loginId, by: actor.loginId });
    return { temporaryPassword: tempPassword };
  }

  async setActive(userId: number, active: boolean, actor: Actor, ip?: string) {
    if (actor.userId === userId && !active) throw unprocessable("You cannot deactivate your own account.");
    const target = await this.ownUser(userId, actor);
    if (target.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
      throw forbidden("Only a super admin can change this account.");
    }
    await this.prisma.user.update({ where: { id: userId }, data: { active } });
    // Access tokens already stop at the live `active` check; this ends the refresh tokens too.
    if (!active) await this.refresh.revokeAllForUser(userId);
    await this.audit.record(actor.userId, active ? "USER_ACTIVATE" : "USER_DEACTIVATE", "User", userId, undefined, { ip });
    return { userId, active };
  }

  /**
   * SEC-2: set your own password. Proves possession of the current one first.
   *
   * Signs out every other session (their tokens predate `passwordChangedAt`) and hands this one
   * a fresh access and refresh token, which the caller must store in place of the old ones.
   */
  async changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string, ip?: string) {
    if (newPassword.length < 10) throw unprocessable("Your new password must be at least 10 characters.");
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user) throw unprocessable("Your account could not be found.");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      log.warn("auth", "password_change_rejected", { userId: user.id, reason: "current_password_incorrect" });
      throw unprocessable("Your current password is not correct.");
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw unprocessable("Choose a password you have not used here before.");
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(newPassword, 12),
          mustChangePassword: false,
          passwordChangedAt: now,
        },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    await this.audit.record(user.id, "PASSWORD_CHANGE", "User", user.id, "changed by account holder", { ip });
    log.info("auth", "password_changed", { userId: user.id, loginId: user.loginId, role: user.role });

    const token = await this.auth.signSession(user);
    const { refreshToken } = await this.refresh.issue(user.id);
    return { ok: true, token, refreshToken };
  }
}
