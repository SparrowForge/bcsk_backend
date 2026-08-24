/**
 * BCSK Platform seed — real content collected from bcskr.org (July 2026)
 * plus SRS-specified structure. Run: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { seedContent } from "./seed-content";

const db = new PrismaClient();

/**
 * SEC-2: the seed used to hard-code a weak shared password, and those accounts reached
 * production. It now refuses to do that unless demo data is explicitly requested; every
 * seeded account is flagged mustChangePassword either way.
 */
const ALLOW_DEMO_PASSWORD = process.env.ALLOW_DEMO_PASSWORD === "1";
const DEMO_PASSWORD = ALLOW_DEMO_PASSWORD
  ? "bcsk1234"
  : randomBytes(12).toString("base64url");

if (process.env.NODE_ENV === "production" && ALLOW_DEMO_PASSWORD) {
  throw new Error("Refusing to seed the shared demo password into a production database.");
}
const SEMESTER = "2026-2";

async function main() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  /* ---------------- Settings (stats, integrations, bank) ---------------- */
  const settings: Record<string, string> = {
    stat_total_students: "30",
    stat_total_classes: "6",
    stat_special_courses: "6",
    stat_teachers_staff: "9",
    whatsapp_number: "+821095998901",
    support_email: "bcskr22@gmail.com",
    school_phone: "+82 10-8948-3447",
    school_phone2: "+82 10-6893-6237",
    bank_name: "Hana Bank",
    bank_account_name: "Bangladesh Community School Korea",
    bank_account_number: "298-910032-72304",
    zoom_account: "",
    smtp_configured: "false",
    pg_provider: "Toss Payments (sandbox)",
    semester_current: SEMESTER,
    semester_1_dates: "March 1 – June 30",
    semester_2_dates: "September 1 – December 31",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  /* ---------------- Admin users ---------------- */
  await db.user.upsert({
    where: { loginId: "admin" },
    update: {},
    create: {
      loginId: "admin",
      name: "Super Admin",
      email: "bcskr22@gmail.com",
      passwordHash: hash, mustChangePassword: true,
      role: "SUPER_ADMIN",
    },
  });
  await db.user.upsert({
    where: { loginId: "office" },
    update: {},
    create: {
      loginId: "office",
      name: "Office Support",
      email: "bcskr22@gmail.com",
      passwordHash: hash, mustChangePassword: true,
      role: "ADMIN_SUPPORT",
    },
  });
  await db.user.upsert({
    where: { loginId: "itsupport" },
    update: {},
    create: {
      loginId: "itsupport",
      name: "IT Support",
      email: "bcskr22@gmail.com",
      passwordHash: hash, mustChangePassword: true,
      role: "IT_SUPPORT",
    },
  });

  /* ---------------- Teachers (real faculty from bcskr.org) ---------------- */
  const teachers = [
    {
      loginId: "BCSK-T-001",
      name: "Prof. Dr. Manwar Hussain",
      designation: "Principal",
      bio: "Professor at Hanyang University (ERICA Campus), Department of Materials Science and Chemical Engineering. Ph.D. in Chemical Process Engineering from Osaka University, Japan.",
      subjects: "Administration",
      guideClass: null as string | null,
      order: 1,
    },
    {
      loginId: "BCSK-T-002",
      name: "Dr. Kamrul Hasan",
      designation: "Vice Principal",
      bio: "Post-Doctoral Research Fellow, Department of Information and Communications Engineering, Hankuk University of Foreign Studies. Former CSE lecturer at Dhaka City College.",
      subjects: "ICT",
      guideClass: null,
      order: 2,
    },
    {
      loginId: "BCSK-T-003",
      name: "Sangida Islam",
      designation: "Bangla Teacher",
      bio: "M.Phil. in Geography; former lecturer at Bangabandhu College.",
      subjects: "Bangla",
      guideClass: "CLASS_1",
      order: 3,
    },
    {
      loginId: "BCSK-T-004",
      name: "Afsana Yesmin",
      designation: "English Teacher",
      bio: "MS in Social Economy (ongoing); Bachelor's in Global Business from Hannam University.",
      subjects: "English",
      guideClass: "CLASS_2",
      order: 4,
    },
    {
      loginId: "BCSK-T-005",
      name: "Md. Ariful Islam",
      designation: "Islamic Religion Teacher",
      bio: "Khateeb & Imam; former lecturer at Islamic institutes. Leads the Deen / Qur'an department.",
      subjects: "Islamic Studies, Qur'an",
      guideClass: null,
      order: 5,
    },
    {
      loginId: "BCSK-T-006",
      name: "Tonoya Najnin Tithi",
      designation: "Math Teacher",
      bio: "Master's student in Electrical Engineering at Kyungpook National University.",
      subjects: "Mathematics, Abacus",
      guideClass: "CLASS_3",
      order: 6,
    },
    {
      loginId: "BCSK-T-007",
      name: "Heinz Fraenkel",
      designation: "Native English Instructor",
      bio: "Native English speaker leading the IELTS for Kids programme.",
      subjects: "IELTS for Kids",
      guideClass: null,
      order: 7,
    },
  ];
  const teacherProfiles: Record<string, number> = {};
  for (const t of teachers) {
    const user = await db.user.upsert({
      where: { loginId: t.loginId },
      update: {},
      create: {
        loginId: t.loginId,
        name: t.name,
        passwordHash: hash, mustChangePassword: true,
        role: "TEACHER",
        teacherProfile: {
          create: {
            teacherId: t.loginId,
            designation: t.designation,
            bio: t.bio,
            subjects: t.subjects,
            guideClass: t.guideClass,
            displayOrder: t.order,
          },
        },
      },
      include: { teacherProfile: true },
    });
    const profile = await db.teacherProfile.findUnique({ where: { userId: user.id } });
    teacherProfiles[t.loginId] = profile!.id;
  }

  /* ---------------- Courses ---------------- */
  const regularSubjects = [
    { slug: "bangla", name: "Bangla", desc: "Mother-language literacy following the NCTB curriculum — reading, writing, and speaking Bangla with pride." },
    { slug: "english", name: "English", desc: "Global English teaching across the four skills: speaking, reading, writing, and listening." },
    { slug: "mathematics", name: "Mathematics", desc: "NCTB-aligned mathematics building strong foundations from Pre-Primary to Class 5." },
    { slug: "science", name: "Science", desc: "Hands-on primary science aligned with the national curriculum." },
    { slug: "bgs", name: "Bangladesh & Global Studies", desc: "Bangladesh and Global Studies (BGS) — society, history, and the world around us." },
    { slug: "religious-studies", name: "Religious Studies", desc: "Islamic Studies and Hindu Religious Studies tracks per the NCTB curriculum." },
  ];
  const courseIds: Record<string, number> = {};
  for (const [i, s] of regularSubjects.entries()) {
    const c = await db.course.upsert({
      where: { slug: s.slug },
      update: {},
      create: { slug: s.slug, name: s.name, type: "REGULAR", category: "subject", description: s.desc, displayOrder: i + 1 },
    });
    courseIds[s.slug] = c.id;
  }

  const specialCourses = [
    {
      slug: "deen",
      name: "Arabic / Deen (Qur'an & Islamic Studies)",
      category: "deen",
      desc: "Qur'an recitation with Tajweed (separate boys' and girls' tracks), the Hifz memorization program, a ladies-only Qur'an program, and the KOIE online Islamic education program.",
      hero: "Nurture your child's Deen — Qur'an, Tajweed, and Islamic manners taught with love.",
    },
    {
      slug: "ielts-for-kids",
      name: "IELTS for Kids",
      category: "ielts",
      desc: "The four core English skills — Listening, Speaking, Reading, and Writing — taught by native English speakers across nine progressive levels.",
      hero: "Give your child a global voice — IELTS foundations taught by native speakers.",
    },
    {
      slug: "abacus",
      name: "Abacus",
      category: "abacus",
      desc: "Mental arithmetic mastery through the ancient abacus — levels 0 to 7, with an interactive virtual abacus and gamified practice.",
      hero: "Where Math Becomes an Adventure",
    },
    {
      slug: "debate-club",
      name: "Debate Club",
      category: "debate",
      desc: "Structured argumentation, public speaking, and critical thinking in Bangla and English.",
      hero: "Speak with confidence. Think with clarity.",
    },
    {
      slug: "hifz",
      name: "Hifz Program",
      category: "deen",
      desc: "A guided Qur'an memorization program with individual progress tracking, surah by surah, juz by juz.",
      hero: "A journey of memorization, one verse at a time.",
    },
    {
      slug: "bangla-language",
      name: "Bangla Language (for non-natives)",
      category: "subject",
      desc: "Bangla language course for children growing up abroad and non-native speakers.",
      hero: "আমার ভাষা, আমার গর্ব — my language, my pride.",
    },
  ];
  for (const [i, s] of specialCourses.entries()) {
    const c = await db.course.upsert({
      where: { slug: s.slug },
      update: {},
      create: { slug: s.slug, name: s.name, type: "SPECIAL", category: s.category, description: s.desc, heroText: s.hero, displayOrder: 10 + i },
    });
    courseIds[s.slug] = c.id;
  }

  /* ---------------- Course levels ---------------- */
  // Abacus levels 0-7 (per demo design)
  const abacusLevels = [
    { name: "Level 0", syllabus: "Introduction to the abacus; parts of the tool (frame, beam, upper & lower beads); numbers 1–20; simple addition and subtraction with lower beads; finger technique basics." },
    { name: "Level 1", syllabus: "Numbers up to 100; small friends (pairs of 5); addition & subtraction using upper beads; two-digit calculations; speed drills." },
    { name: "Level 2", syllabus: "Big friends (pairs of 10); mixed addition & subtraction; three-digit numbers; introduction to mental visualization (anzan)." },
    { name: "Level 3", syllabus: "Multiplication tables on the abacus; two-digit × one-digit multiplication; mental arithmetic for two-digit sums." },
    { name: "Level 4", syllabus: "Division on the abacus; two-digit ÷ one-digit; combined operations; timed anzan practice." },
    { name: "Level 5", syllabus: "Three-digit multiplication and division; decimals introduction; flash anzan with 3-row sums." },
    { name: "Level 6", syllabus: "Decimal multiplication & division; negative numbers concept; competitive speed rounds." },
    { name: "Level 7", syllabus: "Advanced mixed operations; square roots introduction; full mental abacus fluency; graduation assessment." },
  ];
  for (const [i, l] of abacusLevels.entries()) {
    const exists = await db.courseLevel.findFirst({ where: { courseId: courseIds["abacus"], name: l.name } });
    if (!exists)
      await db.courseLevel.create({
        data: { courseId: courseIds["abacus"], name: l.name, displayOrder: i, syllabus: l.syllabus },
      });
  }

  // IELTS levels 1-9
  for (let i = 1; i <= 9; i++) {
    const name = `Level ${i}`;
    const exists = await db.courseLevel.findFirst({ where: { courseId: courseIds["ielts-for-kids"], name } });
    if (!exists)
      await db.courseLevel.create({
        data: {
          courseId: courseIds["ielts-for-kids"],
          name,
          displayOrder: i,
          syllabus:
            i <= 3
              ? `Foundations ${i}: phonics and listening comprehension, simple conversations, picture reading, guided sentence writing.`
              : i <= 6
              ? `Development ${i}: paragraph reading, structured speaking topics, listening to native dialogues, short essay writing.`
              : `Mastery ${i}: mock IELTS tasks across all four skills, band-score practice, academic vocabulary, timed writing.`,
        },
      });
  }

  // Deen tracks
  const deenTracks = [
    { name: "Qur'an Recitation & Tajweed (Boys)", syllabus: "Noorani Qaida through fluent recitation; Tajweed rules (makharij, sifaat, madd); daily surah practice." },
    { name: "Qur'an Recitation & Tajweed (Girls)", syllabus: "Noorani Qaida through fluent recitation; Tajweed rules; daily surah practice — girls-only class." },
    { name: "Hifz Program", syllabus: "Structured memorization from Juz Amma onward; revision cycles; individual progress tracking per surah and juz." },
    { name: "Ladies Qur'an Program", syllabus: "Qur'an recitation and Tajweed for mothers and adult sisters; flexible evening schedule." },
    { name: "KOIE – Korea Online Islamic Education", syllabus: "Qur'an recitation with Tajweed; basic Islamic beliefs (aqeedah); selected Hadith; stories of the Sahaba; daily duas; Islamic manners (adab & akhlaq)." },
  ];
  for (const [i, t] of deenTracks.entries()) {
    const exists = await db.courseLevel.findFirst({ where: { courseId: courseIds["deen"], name: t.name } });
    if (!exists)
      await db.courseLevel.create({
        data: { courseId: courseIds["deen"], name: t.name, displayOrder: i, syllabus: t.syllabus },
      });
  }

  /* ---------------- Class sessions ---------------- */
  const regularClassPlan: Array<{ classLevel: string; subject: string; day: string; start: string; end: string; teacher: string }> = [
    { classLevel: "PRE_PRIMARY", subject: "bangla", day: "Saturday", start: "10:00", end: "10:50", teacher: "BCSK-T-003" },
    { classLevel: "PRE_PRIMARY", subject: "english", day: "Saturday", start: "11:00", end: "11:50", teacher: "BCSK-T-004" },
    { classLevel: "PRE_PRIMARY", subject: "religious-studies", day: "Sunday", start: "10:00", end: "10:50", teacher: "BCSK-T-005" },
    { classLevel: "CLASS_1", subject: "bangla", day: "Saturday", start: "11:00", end: "11:50", teacher: "BCSK-T-003" },
    { classLevel: "CLASS_1", subject: "english", day: "Saturday", start: "10:00", end: "10:50", teacher: "BCSK-T-004" },
    { classLevel: "CLASS_1", subject: "mathematics", day: "Sunday", start: "10:00", end: "10:50", teacher: "BCSK-T-006" },
    { classLevel: "CLASS_1", subject: "religious-studies", day: "Sunday", start: "11:00", end: "11:50", teacher: "BCSK-T-005" },
    { classLevel: "CLASS_2", subject: "bangla", day: "Saturday", start: "14:00", end: "14:50", teacher: "BCSK-T-003" },
    { classLevel: "CLASS_2", subject: "english", day: "Saturday", start: "15:00", end: "15:50", teacher: "BCSK-T-004" },
    { classLevel: "CLASS_2", subject: "mathematics", day: "Sunday", start: "14:00", end: "14:50", teacher: "BCSK-T-006" },
    { classLevel: "CLASS_2", subject: "religious-studies", day: "Sunday", start: "15:00", end: "15:50", teacher: "BCSK-T-005" },
    { classLevel: "CLASS_3", subject: "bangla", day: "Saturday", start: "16:00", end: "16:50", teacher: "BCSK-T-003" },
    { classLevel: "CLASS_3", subject: "english", day: "Saturday", start: "17:00", end: "17:50", teacher: "BCSK-T-004" },
    { classLevel: "CLASS_3", subject: "mathematics", day: "Sunday", start: "16:00", end: "16:50", teacher: "BCSK-T-006" },
    { classLevel: "CLASS_4", subject: "bangla", day: "Sunday", start: "17:00", end: "17:50", teacher: "BCSK-T-003" },
    { classLevel: "CLASS_4", subject: "english", day: "Saturday", start: "18:00", end: "18:50", teacher: "BCSK-T-004" },
    { classLevel: "CLASS_5", subject: "bangla", day: "Sunday", start: "18:00", end: "18:50", teacher: "BCSK-T-003" },
    { classLevel: "CLASS_5", subject: "mathematics", day: "Saturday", start: "19:00", end: "19:50", teacher: "BCSK-T-006" },
  ];
  const sessionIds: number[] = [];
  for (const p of regularClassPlan) {
    const title = `${p.classLevel.replace("_", " ").replace("PRE PRIMARY", "Pre-Primary").replace("CLASS", "Class")} – ${regularSubjects.find((s) => s.slug === p.subject)?.name}`;
    const exists = await db.classSession.findFirst({ where: { title, semester: SEMESTER } });
    if (!exists) {
      const s = await db.classSession.create({
        data: {
          courseId: courseIds[p.subject],
          title,
          classLevel: p.classLevel,
          dayOfWeek: p.day,
          startTime: p.start,
          endTime: p.end,
          semester: SEMESTER,
          teacherId: teacherProfiles[p.teacher],
          zoomLink: "https://zoom.us/j/00000000000?pwd=demo",
        },
      });
      sessionIds.push(s.id);
    }
  }

  // Abacus online class grid: Level 0-1, Class 1-4 each
  const abacusLevelRows = await db.courseLevel.findMany({ where: { courseId: courseIds["abacus"] }, orderBy: { displayOrder: "asc" } });
  for (const lvl of abacusLevelRows.slice(0, 2)) {
    for (let c = 1; c <= 4; c++) {
      const title = `Abacus ${lvl.name} – Class ${c}`;
      const exists = await db.classSession.findFirst({ where: { title, semester: SEMESTER } });
      if (!exists)
        await db.classSession.create({
          data: {
            courseId: courseIds["abacus"],
            courseLevelId: lvl.id,
            title,
            dayOfWeek: c % 2 === 1 ? "Wednesday" : "Friday",
            startTime: `${16 + Math.floor(c / 3)}:00`,
            endTime: `${16 + Math.floor(c / 3)}:50`,
            semester: SEMESTER,
            teacherId: teacherProfiles["BCSK-T-006"],
            zoomLink: "https://zoom.us/j/00000000001?pwd=demo",
          },
        });
    }
  }

  // IELTS sessions (levels 1-3 active)
  const ieltsLevels = await db.courseLevel.findMany({ where: { courseId: courseIds["ielts-for-kids"] }, orderBy: { displayOrder: "asc" } });
  for (const lvl of ieltsLevels.slice(0, 3)) {
    const title = `IELTS for Kids ${lvl.name}`;
    const exists = await db.classSession.findFirst({ where: { title, semester: SEMESTER } });
    if (!exists)
      await db.classSession.create({
        data: {
          courseId: courseIds["ielts-for-kids"],
          courseLevelId: lvl.id,
          title,
          dayOfWeek: "Tuesday",
          startTime: `${17 + lvl.displayOrder - 1}:00`,
          endTime: `${17 + lvl.displayOrder - 1}:50`,
          semester: SEMESTER,
          teacherId: teacherProfiles["BCSK-T-007"],
          zoomLink: "https://zoom.us/j/00000000002?pwd=demo",
        },
      });
  }

  // Deen sessions per track
  const deenLevelRows = await db.courseLevel.findMany({ where: { courseId: courseIds["deen"] } });
  const deenDays = ["Monday", "Tuesday", "Thursday", "Friday", "Sunday"];
  for (const [i, lvl] of deenLevelRows.entries()) {
    const title = `Deen – ${lvl.name}`;
    const exists = await db.classSession.findFirst({ where: { title, semester: SEMESTER } });
    if (!exists)
      await db.classSession.create({
        data: {
          courseId: courseIds["deen"],
          courseLevelId: lvl.id,
          title,
          dayOfWeek: deenDays[i % deenDays.length],
          startTime: "19:00",
          endTime: "19:50",
          semester: SEMESTER,
          teacherId: teacherProfiles["BCSK-T-005"],
          zoomLink: "https://zoom.us/j/00000000003?pwd=demo",
        },
      });
  }

  /* ---------------- Fee configuration (real 2023 figures, marked for update) ---------------- */
  const fees = [
    { key: "pre_primary", label: "Pre-Primary", kind: "REGULAR_CLASS", admissionFee: 50000, semesterFee: 200000, bookFee: 30000, order: 1 },
    { key: "class_1", label: "Class 1", kind: "REGULAR_CLASS", admissionFee: 50000, semesterFee: 300000, bookFee: 40000, order: 2 },
    { key: "class_2", label: "Class 2", kind: "REGULAR_CLASS", admissionFee: 50000, semesterFee: 300000, bookFee: 40000, order: 3 },
    { key: "class_3", label: "Class 3", kind: "REGULAR_CLASS", admissionFee: 50000, semesterFee: 300000, bookFee: 45000, order: 4 },
    { key: "class_4", label: "Class 4", kind: "REGULAR_CLASS", admissionFee: 50000, semesterFee: 300000, bookFee: 45000, order: 5 },
    { key: "class_5", label: "Class 5", kind: "REGULAR_CLASS", admissionFee: 50000, semesterFee: 300000, bookFee: 50000, order: 6 },
    { key: "ielts_for_kids", label: "IELTS for Kids (per level)", kind: "SPECIAL_COURSE", admissionFee: 30000, semesterFee: 0, bcskPrice: 150000, nonBcskPrice: 200000, order: 10 },
    { key: "abacus", label: "Abacus (per level)", kind: "SPECIAL_COURSE", admissionFee: 30000, semesterFee: 0, bcskPrice: 120000, nonBcskPrice: 160000, order: 11 },
    { key: "deen", label: "Qur'an & Islamic Studies", kind: "SPECIAL_COURSE", admissionFee: 20000, semesterFee: 0, bcskPrice: 100000, nonBcskPrice: 130000, order: 12 },
    { key: "hifz", label: "Hifz Program", kind: "SPECIAL_COURSE", admissionFee: 20000, semesterFee: 0, bcskPrice: 120000, nonBcskPrice: 150000, order: 13 },
    { key: "debate_club", label: "Debate Club", kind: "SPECIAL_COURSE", admissionFee: 20000, semesterFee: 0, bcskPrice: 80000, nonBcskPrice: 100000, order: 14 },
    { key: "bangla_language", label: "Bangla Language", kind: "SPECIAL_COURSE", admissionFee: 20000, semesterFee: 0, bcskPrice: 90000, nonBcskPrice: 110000, order: 15 },
  ];
  for (const f of fees) {
    const { order, ...rest } = f;
    await db.feeConfig.upsert({ where: { key: f.key }, update: {}, create: { ...rest, displayOrder: order } });
  }

  /* ---------------- Curriculum entries (from bcskr.org + SRS NCTB list) ---------------- */
  const curriculum: Array<[string, string[]]> = [
    ["PRE_PRIMARY", ["Bangla & English (combined)", "Religious Studies (Islam / Hindu)"]],
    ["CLASS_1", ["Bangla", "English", "Mathematics", "Religious Studies (Islam / Hindu)"]],
    ["CLASS_2", ["Bangla", "English", "Mathematics", "Religious Studies (Islam / Hindu)"]],
    ["CLASS_3", ["Bangla", "English", "Mathematics", "Science", "Bangladesh & Global Studies", "Religious Studies"]],
    ["CLASS_4", ["Bangla", "English", "Mathematics", "Science", "Bangladesh & Global Studies", "Religious Studies"]],
    ["CLASS_5", ["Bangla", "English", "Mathematics", "Science", "Bangladesh & Global Studies", "Religious Studies"]],
  ];
  await db.curriculumEntry.deleteMany({});
  for (const [classLevel, subjects] of curriculum) {
    for (const [i, subject] of subjects.entries()) {
      await db.curriculumEntry.create({
        data: { classLevel, subject, details: "Updated NCTB curriculum", displayOrder: i },
      });
    }
  }

  /* ---------------- Governing body (real members from bcskr.org) ---------------- */
  const governing = [
    { name: "Dr. Kamrul Hasan", role: "Chairman", organization: "Post-Doctoral Research Fellow, Hankuk University of Foreign Studies", phone: "+82-10-6893-6237", email: "kamrulcsedu09@gmail.com", order: 1 },
    { name: "Prof. Dr. Manwar Hussain", role: "Member-Secretary", organization: "Principal, BCSK; Professor, Hanyang University (ERICA Campus)", order: 2 },
    { name: "Prof. Dr. Md Sumon Hossain", role: "Member", organization: "Assistant Professor, Kyungdong University Global Campus", order: 3 },
    { name: "Prof. Dr. Md. Furkanur Rahaman Mizan", role: "Member", organization: "Assistant Professor, Chung-Ang University", phone: "010-2175-8174", email: "rahaman4162@cau.ac.kr", order: 4 },
    { name: "Kang Woo-jin (Borhan Uddin)", role: "Member", organization: "CEO, WOOJIN ENG", phone: "+82-10-4708-9036", email: "Wjeng2014@hanmail.com", order: 5 },
    { name: "Kim Yeong Jun (Mohammad Heron Babu)", role: "Member", organization: "President, Hanmi Trading Corporation", phone: "+82-31-372-5344", email: "kim.y.jun@korbangla.com", order: 6 },
    { name: "Abubakar Siddiqie Rana", role: "Member", organization: "Ph.D. Candidate, Sejong University; Chairman, Prime Group", order: 7 },
  ];
  await db.governingMember.deleteMany({ where: { kind: "GOVERNING" } });
  for (const g of governing) {
    await db.governingMember.create({
      data: { kind: "GOVERNING", name: g.name, role: g.role, organization: g.organization, phone: g.phone, email: g.email, displayOrder: g.order },
    });
  }
  // Regional representatives — recruitment in progress per bcskr.org (May 2025)
  await db.governingMember.deleteMany({ where: { kind: "REGIONAL" } });
  await db.governingMember.create({
    data: {
      kind: "REGIONAL",
      name: "Recruitment in progress",
      role: "Regional Representative",
      region: "All regions",
      bio: "BCSK is recruiting regional representatives across South Korea. Contact the office to volunteer for your city.",
      displayOrder: 1,
    },
  });

  /* ---------------- News & events (real items from bcskr.org) ---------------- */
  const news = [
    { type: "NEWS", title: "Recruitment of Regional Representatives", date: "2025-05-20", body: "BCSK is expanding! We are recruiting regional representatives across South Korea to help connect Bangladeshi families in every city with the school's programs. Interested community members are requested to contact the school office." },
    { type: "EVENT", title: "Meeting with the Ambassador of Bangladesh", date: "2025-05-10", body: "The BCSK governing body met with the Honorable Ambassador of Bangladesh to the Republic of Korea to discuss the school's growth, community engagement, and support for expatriate children's education." },
    { type: "EVENT", title: "Community Iftar Gathering", date: "2025-03-15", body: "Students, parents, teachers, and community members joined together for our annual Iftar gathering — an evening of dua, food, and brotherhood." },
    { type: "SEMINAR", title: "Seminar: The Significance of Ramadan", date: "2025-02-25", body: "A special online seminar on the significance of Ramadan, its rulings and virtues, presented by our Islamic Studies department for students and guardians." },
    { type: "EVENT", title: "Martyrs' Day & International Mother Language Day", date: "2025-02-21", body: "BCSK observed Amar Ekushey — Martyrs' Day and International Mother Language Day — with recitations, essays, and songs honoring the language martyrs of 1952. Our students presented in Bangla, the language for which lives were given." },
  ];
  await db.eventNews.deleteMany({});
  for (const n of news) {
    await db.eventNews.create({
      data: { type: n.type, title: n.title, body: n.body, date: new Date(n.date), published: true },
    });
  }

  /* ---------------- Demo students with full portal data ---------------- */
  const students = [
    { loginId: "BCSK-2026-0001", name: "Arif Rahman", classLevel: "CLASS_2", gender: "Male", religion: "Islam", father: "Mohammad Rahman", mother: "Salma Rahman" },
    { loginId: "BCSK-2026-0002", name: "Nusrat Jahan", classLevel: "CLASS_1", gender: "Female", religion: "Islam", father: "Kamal Jahan", mother: "Farida Jahan" },
  ];
  for (const s of students) {
    const u = await db.user.upsert({
      where: { loginId: s.loginId },
      update: {},
      create: {
        loginId: s.loginId,
        name: s.name,
        email: "guardian@example.com",
        passwordHash: hash, mustChangePassword: true,
        role: "STUDENT",
        studentProfile: {
          create: {
            studentId: s.loginId,
            classLevel: s.classLevel,
            gender: s.gender,
            religion: s.religion,
            fatherName: s.father,
            motherName: s.mother,
            guardianPhone: "+82 10-1234-5678",
            guardianEmail: "guardian@example.com",
            addressKorea: "Yongin-si, Gyeonggi-do",
            addressBangladesh: "Dhaka, Bangladesh",
            emergencyContact: "+82 10-1234-5678",
            dob: new Date("2018-03-15"),
          },
        },
      },
    });
    // enroll in their class's sessions + abacus for student 1
    const classSessions = await db.classSession.findMany({ where: { classLevel: s.classLevel, semester: SEMESTER } });
    for (const cs of classSessions) {
      await db.enrollment.upsert({
        where: { studentUserId_classSessionId_semester: { studentUserId: u.id, classSessionId: cs.id, semester: SEMESTER } },
        update: {},
        create: { studentUserId: u.id, classSessionId: cs.id, semester: SEMESTER },
      });
    }
    if (s.loginId === "BCSK-2026-0001") {
      const abacusSession = await db.classSession.findFirst({ where: { title: "Abacus Level 0 – Class 1" } });
      const deenSession = await db.classSession.findFirst({ where: { title: { contains: "Hifz" } } });
      for (const cs of [abacusSession, deenSession]) {
        if (cs)
          await db.enrollment.upsert({
            where: { studentUserId_classSessionId_semester: { studentUserId: u.id, classSessionId: cs.id, semester: SEMESTER } },
            update: {},
            create: { studentUserId: u.id, classSessionId: cs.id, semester: SEMESTER },
          });
      }
      // sample hifz progress
      const surahs = [
        [114, "An-Nas"], [113, "Al-Falaq"], [112, "Al-Ikhlas"], [111, "Al-Masad"], [110, "An-Nasr"],
      ] as Array<[number, string]>;
      for (const [num, name] of surahs) {
        await db.hifzProgress.upsert({
          where: { studentUserId_surahNumber: { studentUserId: u.id, surahNumber: num } },
          update: {},
          create: { studentUserId: u.id, surahNumber: num, surahName: name, juz: 30 },
        });
      }
      // sample exam results
      const results: Array<[string, number, string]> = [["Bangla", 88, "A+"], ["English", 82, "A"], ["Mathematics", 91, "A+"], ["Islamic Studies", 95, "A+"]];
      for (const [subject, marks, grade] of results) {
        await db.examResult.upsert({
          where: { studentUserId_semester_subject: { studentUserId: u.id, semester: "2026-1", subject } },
          update: {},
          create: { studentUserId: u.id, semester: "2026-1", subject, marks, grade },
        });
      }
      // sample verified payment
      const existingPay = await db.payment.findFirst({ where: { payerUserId: u.id } });
      if (!existingPay)
        await db.payment.create({
          data: {
            payerUserId: u.id,
            purpose: "SEMESTER_FEE",
            method: "BANK_TRANSFER",
            amount: 300000,
            status: "VERIFIED",
            virtualRef: "BCSK-VR-20260301-0001",
            receiptPdfSerial: "BCSK-RCPT-2026-0001",
            verifiedAt: new Date("2026-03-02"),
          },
        });
    }
  }

  /* ---------------- Sample assignment + reminder ---------------- */
  const banglaC2 = await db.classSession.findFirst({ where: { title: "Class 2 – Bangla" } });
  if (banglaC2) {
    const exists = await db.assignment.findFirst({ where: { classSessionId: banglaC2.id } });
    if (!exists)
      await db.assignment.create({
        data: {
          classSessionId: banglaC2.id,
          title: "বাংলা হাতের লেখা — Handwriting practice",
          description: "Write the Bangla alphabet (অ–ঁ) twice in your workbook, photograph it, and upload.",
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      });
  }

  /* ---------------- Student corner samples ---------------- */
  const cornerCount = await db.studentCornerPost.count();
  if (cornerCount === 0) {
    await db.studentCornerPost.createMany({
      data: [
        { title: "আমার দেশ (My Country)", body: "সবুজ শ্যামল আমার দেশ,\nনদী-মাঠে ভরা বেশ।\nকোরিয়ায় থেকেও মনে পড়ে,\nবাংলাদেশ আমার ঘরে।", studentName: "Nusrat Jahan, Class 1", kind: "POEM", published: true },
        { title: "My First Abacus Competition", body: "Last month I joined my first abacus speed round. My fingers were shaking but I finished all ten sums! Teacher Tithi said my anzan is getting faster. Next time I want to try Level 1.", studentName: "Arif Rahman, Class 2", kind: "ARTICLE", published: true },
      ],
    });
  }

  /* ---------------- Gallery ---------------- */
  const albumCount = await db.galleryAlbum.count();
  if (albumCount === 0) {
    const album1 = await db.galleryAlbum.create({ data: { title: "Mother Language Day 2025", category: "Events" } });
    const album2 = await db.galleryAlbum.create({ data: { title: "Community Iftar 2025", category: "Events" } });
    const album3 = await db.galleryAlbum.create({ data: { title: "Classroom Moments", category: "School Life" } });
    await db.galleryItem.createMany({
      data: [
        { albumId: album1.id, url: "/images/gallery/ekushey-1.svg", caption: "Students presenting on Amar Ekushey" },
        { albumId: album1.id, url: "/images/gallery/ekushey-2.svg", caption: "Bangla recitation" },
        { albumId: album2.id, url: "/images/gallery/iftar-1.svg", caption: "Community Iftar gathering" },
        { albumId: album3.id, url: "/images/gallery/class-1.svg", caption: "Online Bangla class" },
        { albumId: album3.id, url: "/images/gallery/class-2.svg", caption: "Abacus practice session" },
      ],
    });
  }

  await seedContent(db);

  console.log("Seed complete.");
  console.log(`Password for all seeded accounts: ${DEMO_PASSWORD}`);
  console.log(ALLOW_DEMO_PASSWORD
    ? "  (shared demo password — ALLOW_DEMO_PASSWORD=1; never use this on a real deployment)"
    : "  (randomly generated — set ALLOW_DEMO_PASSWORD=1 for the old shared demo password)");
  console.log("  Every seeded account must change its password at first login.");
  console.log("Logins: admin / office / itsupport, teachers BCSK-T-001..007, students BCSK-2026-0001..0002");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
