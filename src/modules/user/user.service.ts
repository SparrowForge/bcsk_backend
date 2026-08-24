import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/common/audit.service";
import { MailService } from "@/common/mail.service";
import { conflict, notFound, unprocessable } from "@/common/errors/app-error";
import { ROLES } from "@/common/constants";
import { log } from "@/common/logger";
import type { Actor } from "@/common/actor";

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * The account list the Users module renders. `select`, never `include` — `passwordHash`
   * lives on this table.
   *
   * The two profile relations are here because the table shows a student's class and a
   * teacher's designation under their name; each is narrowed to just that field.
   */
  async list() {
    return this.prisma.user.findMany({
      select: {
        id: true, loginId: true, name: true, email: true, role: true,
        active: true, mustChangePassword: true, createdAt: true,
        studentProfile: { select: { classLevel: true } },
        teacherProfile: { select: { designation: true } },
      },
      orderBy: [{ role: "asc" }, { id: "asc" }],
    });
  }

  /** SEC-2: an office-issued credential must be replaced by its holder at first sign-in. */
  async create(
    input: { loginId: string; name: string; email?: string | null; role: string; classLevel?: string; designation?: string },
    actor: Actor,
  ) {
    if (!Object.values(ROLES).includes(input.role as never)) throw unprocessable("Choose a valid role.");
    if (await this.prisma.user.findUnique({ where: { loginId: input.loginId } })) {
      throw conflict(`Login ID ${input.loginId} already exists.`);
    }
    const tempPassword = randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 12);

    await this.prisma.user.create({
      data: {
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
    await this.audit.record(actor.userId, "USER_CREATE", "User", input.loginId, input.role);
    log.info("auth", "user_created", { loginId: input.loginId, role: input.role, by: actor.loginId });
    return { loginId: input.loginId, temporaryPassword: tempPassword };
  }

  async resetPassword(userId: number, actor: Actor) {
    const tempPassword = randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 12);
    const user = await this.prisma.user.update({
      where: { id: userId },
      // SEC-2: the office chose this password, so the holder must replace it.
      data: { passwordHash: hash, mustChangePassword: true },
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
    await this.audit.record(actor.userId, "USER_PASSWORD_RESET", "User", userId);
    log.info("auth", "password_reset_by_office", { userId, loginId: user.loginId, by: actor.loginId });
    return { temporaryPassword: tempPassword };
  }

  async setActive(userId: number, active: boolean, actor: Actor) {
    if (actor.userId === userId && !active) throw unprocessable("You cannot deactivate your own account.");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User");
    await this.prisma.user.update({ where: { id: userId }, data: { active } });
    await this.audit.record(actor.userId, active ? "USER_ACTIVATE" : "USER_DEACTIVATE", "User", userId);
    return { userId, active };
  }

  /** SEC-2: set your own password. Proves possession of the current one first. */
  async changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string) {
    if (newPassword.length < 10) throw unprocessable("Your new password must be at least 10 characters.");
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user) throw notFound("Account");
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      log.warn("auth", "password_change_rejected", { userId: user.id, reason: "current_password_incorrect" });
      throw unprocessable("Your current password is not correct.");
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw unprocessable("Choose a password you have not used here before.");
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    await this.audit.record(user.id, "PASSWORD_CHANGE", "User", user.id, "changed by account holder");
    log.info("auth", "password_changed", { userId: user.id, loginId: user.loginId, role: user.role });
    return { ok: true };
  }
}
