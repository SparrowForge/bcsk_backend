export const ROLES = {
  STUDENT: "STUDENT",
  TEACHER: "TEACHER",
  ADMIN_SUPPORT: "ADMIN_SUPPORT",
  IT_SUPPORT: "IT_SUPPORT",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ADMIN_ROLES: Role[] = [ROLES.ADMIN_SUPPORT, ROLES.IT_SUPPORT, ROLES.SUPER_ADMIN];

export const CLASS_LEVELS = [
  { key: "PRE_PRIMARY", label: "Pre-Primary" },
  { key: "CLASS_1", label: "Class 1" },
  { key: "CLASS_2", label: "Class 2" },
  { key: "CLASS_3", label: "Class 3" },
  { key: "CLASS_4", label: "Class 4" },
  { key: "CLASS_5", label: "Class 5" },
] as const;

export const classLevelLabel = (key: string) =>
  CLASS_LEVELS.find((c) => c.key === key)?.label ?? key;

export const APPLICATION_STATUS = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  PAID: "PAID",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CORRECTIONS_REQUESTED: "CORRECTIONS_REQUESTED",
} as const;

export const PAYMENT_STATUS = {
  PENDING: "PENDING",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  PAID: "PAID",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
  REFUNDED: "REFUNDED",
  FAILED: "FAILED",
} as const;

export const LANGS = [
  { code: "en", label: "English" },
  { code: "bn", label: "বাংলা" },
  { code: "ko", label: "한국어" },
] as const;
export type Lang = "en" | "bn" | "ko";

export const SEMESTER_CURRENT = "2026-2";

export const SCHOOL = {
  name: "Bangladesh Community School, Korea",
  shortName: "BCSK",
  nameBn: "বাংলাদেশ কমিউনিটি স্কুল, কোরিয়া",
  nameKo: "방글라데시 커뮤니티 스쿨 코리아",
  email: "bcskr22@gmail.com",
  phone: "+82 10-8948-3447",
  phone2: "+82 10-6893-6237",
  whatsapp: "+821095998901",
  whatsappDisplay: "+82 10 9599 8901",
  address:
    "794-29 Wangsan-ri, Mohyeon-eup, Cheoin-gu, Yongin-si, Gyeonggi-do, South Korea",
  bank: {
    name: "Hana Bank",
    accountName: "Bangladesh Community School Korea",
    accountNumber: "298-910032-72304",
  },
  facebook: "https://www.facebook.com/bcskr",
  youtube: "https://www.youtube.com/@bcskr",
} as const;
