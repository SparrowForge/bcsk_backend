/** CMS content pages — real copy gathered from bcskr.org plus SRS-specified pages. */
import type { PrismaClient } from "@prisma/client";

type Page = { slug: string; lang: string; title: string; content: string };

const pages: Page[] = [
  /* ------------ Home hero (per-language) ------------ */
  {
    slug: "home-hero",
    lang: "en",
    title: "Kids are the best explorers in the world!",
    content:
      "Welcome to the **first Bangladeshi school in Korea** — where children of the Bangladeshi community grow with their mother language, their culture, their Deen, and a world-class education.",
  },
  {
    slug: "home-hero",
    lang: "bn",
    title: "শিশুরাই পৃথিবীর সেরা অভিযাত্রী!",
    content:
      "**কোরিয়ার প্রথম বাংলাদেশি স্কুলে** স্বাগতম — যেখানে বাংলাদেশি কমিউনিটির সন্তানেরা বেড়ে ওঠে মাতৃভাষা, সংস্কৃতি, দ্বীন এবং বিশ্বমানের শিক্ষা নিয়ে।",
  },
  {
    slug: "home-hero",
    lang: "ko",
    title: "아이들은 세상에서 가장 훌륭한 탐험가입니다!",
    content:
      "**한국 최초의 방글라데시 학교**에 오신 것을 환영합니다 — 방글라데시 커뮤니티의 아이들이 모국어와 문화, 신앙, 그리고 세계적 수준의 교육과 함께 성장하는 곳입니다.",
  },

  /* ------------ About ------------ */
  {
    slug: "about-us",
    lang: "en",
    title: "About Us",
    content: `## The First Bangladeshi School in Korea

Bangladesh Community School, Korea (BCSK) is the first educational institution established for the children of the Bangladeshi expatriate community in South Korea. Despite the presence of Bangladeshis in South Korea for over 30 years, no educational institution had been established to introduce our children to our own educational culture — until BCSK.

The institution began its journey with the aim of **connecting the next generation with the mainstream education of Bangladesh**, following the updated NCTB (National Curriculum and Textbook Board) curriculum from Pre-Primary through Class 5, alongside special programs in Qur'an & Islamic studies, IELTS for Kids, Abacus mental arithmetic, and debate.

### Why Choose Us

- **First Bangla School** — a focus on intellectual development rooted in identity
- **Quality Education** — a curriculum that encourages innovation and curiosity
- **Moral Education** — character and values at the heart of learning
- **Bangladeshi Culture** — preservation of our language, heritage, and tradition

We hope that today's little children will grow to build the golden Bangladesh of tomorrow — and that our school will gradually be upgraded to Higher Secondary (12th) class, In Sha Allah.`,
  },
  {
    slug: "about-us",
    lang: "bn",
    title: "আমাদের সম্পর্কে",
    content: `## কোরিয়ার প্রথম বাংলাদেশি স্কুল

বাংলাদেশ কমিউনিটি স্কুল, কোরিয়া (BCSK) দক্ষিণ কোরিয়ায় প্রবাসী বাংলাদেশি কমিউনিটির সন্তানদের জন্য প্রতিষ্ঠিত প্রথম শিক্ষা প্রতিষ্ঠান। ৩০ বছরেরও বেশি সময় ধরে দক্ষিণ কোরিয়ায় বাংলাদেশিদের উপস্থিতি থাকা সত্ত্বেও আমাদের সন্তানদের দেশীয় শিক্ষা-সংস্কৃতির সাথে পরিচয় করিয়ে দেওয়ার মতো কোনো প্রতিষ্ঠান ছিল না — BCSK সেই শূন্যতা পূরণ করেছে।

জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড (NCTB)-এর হালনাগাদ শিক্ষাক্রম অনুসরণ করে প্রাক-প্রাথমিক থেকে পঞ্চম শ্রেণি পর্যন্ত পাঠদান, সেই সাথে কুরআন ও ইসলামিক স্টাডিজ, IELTS for Kids, অ্যাবাকাস এবং বিতর্কের বিশেষ কোর্স।

### কেন আমাদের বেছে নেবেন

- **প্রথম বাংলা স্কুল** — আত্মপরিচয়ে শিকড় গেড়ে বুদ্ধিবৃত্তিক বিকাশ
- **মানসম্মত শিক্ষা** — উদ্ভাবন ও কৌতূহলকে উৎসাহিত করা শিক্ষাক্রম
- **নৈতিক শিক্ষা** — শিক্ষার কেন্দ্রে চরিত্র ও মূল্যবোধ
- **বাংলাদেশি সংস্কৃতি** — ভাষা, ঐতিহ্য ও সংস্কৃতির সংরক্ষণ`,
  },
  {
    slug: "about-us",
    lang: "ko",
    title: "학교 소개",
    content: `## 한국 최초의 방글라데시 학교

방글라데시 커뮤니티 스쿨 코리아(BCSK)는 대한민국에 거주하는 방글라데시 교민 자녀들을 위해 설립된 최초의 교육 기관입니다. 방글라데시인들이 한국에 30년 넘게 거주해 왔음에도 자녀들에게 모국의 교육 문화를 소개할 교육 기관이 없었습니다 — BCSK가 그 시작입니다.

방글라데시 국가교육과정(NCTB)에 따라 유치부부터 5학년까지 교육하며, 꾸란·이슬람학, 어린이 IELTS, 주산(아바쿠스), 토론 등 특별 과정을 운영합니다.

### BCSK를 선택하는 이유

- **최초의 방글라 학교** — 정체성에 뿌리를 둔 지적 성장
- **양질의 교육** — 혁신과 호기심을 장려하는 교육과정
- **인성 교육** — 배움의 중심에 있는 인격과 가치
- **방글라데시 문화** — 언어와 전통의 보존`,
  },

  /* ------------ Messages ------------ */
  {
    slug: "message-chairman",
    lang: "en",
    title: "Message from the Chairman",
    content: `**Dr. Kamrul Hasan** — *Chairman, Governing Body*

I am grateful to the Almighty Allah (SWT), whose infinite mercy has started the journey of the Bangladesh Community School, Korea.

Despite the presence of Bangladeshis in South Korea for over 30 years, no educational institution had been established to introduce our children to our local educational culture. The institution has started its journey with the aim of connecting the next generation with the mainstream education of the country — providing Bengali language instruction, cultural education, and religious training while maintaining academic excellence aligned with South Korea's educational standards.

We hope that today's little children will work as soldiers to build the desired golden Bangladesh of tomorrow. We also hope that our school will gradually be upgraded to Higher Secondary (12th) class, In Sha Allah.`,
  },
  {
    slug: "message-principal",
    lang: "en",
    title: "Message from the Principal",
    content: `**Prof. Dr. Manwar Hussain** — *Principal*
*Professor, Department of Materials Science & Chemical Engineering, Hanyang University (ERICA Campus); Ph.D., Osaka University*

It is my immense pleasure to welcome everyone to the first Bangladeshi community school in Korea.

Our mission is to provide quality education to the children of overseas Bangladeshis — preserving our mother language and Bangladeshi culture while nurturing moral development. We believe education through the mother language builds the strongest foundations, and our NCTB-aligned curriculum keeps our students connected to Bangladesh's mainstream education so they can transition smoothly whether their future lies in Korea, Bangladesh, or anywhere in the world.

I invite every Bangladeshi family in Korea to join our growing community of learners.`,
  },
  {
    slug: "education-process",
    lang: "en",
    title: "Education Process & System",
    content: `## How BCSK Teaches

BCSK runs **online live classes** over Zoom on weekends and weekday evenings, following the **updated NCTB curriculum** of Bangladesh from Pre-Primary through Class 5.

### The System

1. **Live interactive classes** — small groups led by qualified teachers, with attendance tracked every session.
2. **Recorded lessons** — every class is available for review in the student portal.
3. **Assignments & homework** — issued and submitted digitally, graded with feedback.
4. **Semester assessments** — two semesters per year (March–June, September–December) with result sheets and progress reports.
5. **Special programs** — Qur'an & Islamic Studies, IELTS for Kids by native speakers, Abacus mental arithmetic, and Debate Club.

### Languages of Instruction

Bangla is the primary medium, with Global English Teaching covering the four skills — speaking, reading, writing, and listening. Korean-language support materials help children bridge their school life in Korea.`,
  },
  {
    slug: "administration",
    lang: "en",
    title: "Administration",
    content: `## School Administration

The school is administered by its **Governing Body**, chaired by Dr. Kamrul Hasan, with Prof. Dr. Manwar Hussain serving as Principal and Member-Secretary.

The administration oversees:

- Academic planning and teacher recruitment
- Admissions and fee policy
- Community relations and events
- The school's development roadmap — including the goal of expanding to Higher Secondary level

**Office contacts:**
- Phone: +82 10-8948-3447 / +82 10-6893-6237
- Email: bcskr22@gmail.com`,
  },

  /* ------------ Admission section ------------ */
  {
    slug: "admission-process",
    lang: "en",
    title: "Admission Process",
    content: `## How to Apply

Admission to BCSK is open year-round for both **Regular Courses** (Pre-Primary – Class 5) and **Special Courses** (IELTS for Kids, Abacus, Qur'an, Hifz, Debate Club, Bangla Language).

### Steps

1. **Review** the class/course details and the tuition fee table.
2. **Apply online** — click *Apply Now*, choose Regular or Special course, and complete the application form with a passport-size photo (JPG/PNG, max 1 MB).
3. **Pay** the admission and semester fee — by **card** (processed securely by our payment gateway) or by **bank transfer** to our Hana Bank account, uploading your transfer receipt.
4. **Verification** — card payments are confirmed instantly; bank transfers are verified by our office within 1–2 working days.
5. **Confirmation** — you receive an admission confirmation email with the student's login credentials for the Classroom portal.

### Need help?

Call +82 10-6893-6237 or email bcskr22@gmail.com — or use the WhatsApp button at the top of the page.`,
  },
  {
    slug: "regular-course",
    lang: "en",
    title: "Regular Course",
    content: `## Regular Courses (Pre-Primary – Class 5)

Our regular program follows the updated **NCTB curriculum** of Bangladesh:

| Class | Subjects |
|---|---|
| Pre-Primary | Bangla & English (combined), Religious Studies |
| Class 1–2 | Bangla, English, Mathematics, Religious Studies |
| Class 3–5 | Bangla, English, Mathematics, Science, Bangladesh & Global Studies, Religious Studies |

Classes run online on weekends and weekday evenings. Each semester includes assessments, a result sheet, and a progress report. Religious Studies is offered in Islamic and Hindu tracks.

**Semesters:** Semester 1: March 1 – June 30 · Semester 2: September 1 – December 31`,
  },
  {
    slug: "special-course",
    lang: "en",
    title: "Special Courses",
    content: `## Special Courses

Open to both BCSK students and non-BCSK students (differentiated fees apply):

- **IELTS for Kids** — Listening, Speaking, Reading, Writing taught by native English speakers, Levels 1–9.
- **Abacus** — mental arithmetic from Level 0 to Level 7 with our interactive virtual abacus and games.
- **Qur'an & Islamic Studies (Deen)** — Tajweed-based recitation in separate boys'/girls' tracks, plus the KOIE program.
- **Hifz Program** — structured Qur'an memorization with per-surah progress tracking.
- **Debate Club** — argumentation and public speaking in Bangla and English.
- **Bangla Language** — for children growing up abroad and non-native speakers.

Apply via the *Apply Now* button — select **Special Course** and your program.`,
  },
  {
    slug: "quran-department",
    lang: "en",
    title: "Qur'an Department",
    content: `## Qur'an Department

The Qur'an Department is the heart of BCSK's Deen program, led by our Islamic Religion teacher, Khateeb Md. Ariful Islam.

### Programs

- **Qur'an Recitation & Tajweed (Boys)** — from Noorani Qaida to fluent recitation
- **Qur'an Recitation & Tajweed (Girls)** — girls-only classes with the same track
- **Hifz Program** — memorization with individual progress tracking
- **Ladies Qur'an Program** — for mothers and adult sisters, evening schedule
- **KOIE — Korea Online Islamic Education** — aqeedah, Hadith, Sahaba stories, daily duas, and Islamic manners

All classes are held live over Zoom. Enrolled students can track their Hifz progress surah-by-surah in the Classroom portal.`,
  },
  {
    slug: "re-admission",
    lang: "en",
    title: "Re-Admission",
    content: `## Re-Admission (Returning Students)

Current BCSK students re-enroll each semester through a simplified process:

1. Log into the **Classroom portal** and open **Re-Admission**.
2. Confirm your class for the new semester.
3. Pay the **semester fee only** — the admission fee is waived for continuing students per school policy.
4. Your enrollment is renewed on payment confirmation.

Students returning after a gap of one or more semesters should contact the office; re-admission fee policy may apply.`,
  },
  {
    slug: "brochure",
    lang: "en",
    title: "School Brochure",
    content: `## BCSK Brochure

Download our school brochure for a complete overview of programs, fees, and the admission process — perfect for sharing with other Bangladeshi families in Korea.

*The downloadable PDF brochure is managed from the Admin Panel. Current version: 2026.*`,
  },

  /* ------------ Academic ------------ */
  {
    slug: "book-list",
    lang: "en",
    title: "Book List",
    content: `## Book List (NCTB Textbooks)

All textbooks follow the National Curriculum and Textbook Board (NCTB) of Bangladesh. Digital copies are provided to enrolled students; printed books can be arranged through the school office.

| Class | Books |
|---|---|
| Pre-Primary | Amar Boi (Pre-Primary), English for Today (Intro), Islamic Studies primer |
| Class 1 | Amar Bangla Boi 1, English for Today 1, Elementary Mathematics 1, Religious Studies 1 |
| Class 2 | Amar Bangla Boi 2, English for Today 2, Elementary Mathematics 2, Religious Studies 2 |
| Class 3 | Amar Bangla Boi 3, English for Today 3, Elementary Mathematics 3, Science 3, BGS 3, Religious Studies 3 |
| Class 4 | Amar Bangla Boi 4, English for Today 4, Elementary Mathematics 4, Science 4, BGS 4, Religious Studies 4 |
| Class 5 | Amar Bangla Boi 5, English for Today 5, Elementary Mathematics 5, Science 5, BGS 5, Religious Studies 5 |

Abacus students additionally receive a Student Book and Work Book per level (see the Abacus page).`,
  },
  {
    slug: "syllabus",
    lang: "en",
    title: "Syllabus",
    content: `## Syllabus

Semester-wise syllabi are published for each class and subject, aligned to the NCTB curriculum (syllabus set updated 2022.09.01, revised 2026).

Enrolled students can download the detailed syllabus for each of their subjects from the **Classroom portal**. Guests can review the curriculum overview on the [Curriculum](/academic/curriculum) page.

Special course syllabi (Abacus levels 0–7, IELTS levels 1–9, Deen tracks) are listed on each course page.`,
  },
  {
    slug: "academic-calendar",
    lang: "en",
    title: "Academic Calendar",
    content: `## Academic Calendar 2026

| Date | Event |
|---|---|
| March 1 | Semester 1 begins |
| February 21 | Martyrs' Day & International Mother Language Day observance |
| March (Ramadan) | Ramadan seminar & community Iftar |
| April 14 | Pohela Boishakh — Bangla New Year celebration |
| June 15–25 | Semester 1 assessments |
| June 30 | Semester 1 ends; results published |
| July – August | Summer break; special courses continue |
| September 1 | Semester 2 begins |
| December 15 | Victory Day celebration |
| December 20–30 | Semester 2 assessments |
| December 31 | Semester 2 ends; results published |

*Dates are indicative and confirmed via Notices and the Events & News page.*`,
  },

  /* ------------ Legal ------------ */
  {
    slug: "privacy-policy",
    lang: "en",
    title: "Privacy Policy",
    content: `## Privacy Policy

Bangladesh Community School, Korea (BCSK) processes personal information in accordance with South Korea's **Personal Information Protection Act (PIPA)**.

### What we collect
Application data (child's name, date of birth, guardian details, contact information, photo), payment references, and learning records (attendance, grades, submissions).

### Parental consent
Because our students are minors, we collect and process a child's personal information **only with the consent of a parent or legal guardian**, captured at application time.

### How we use it
Solely for school operations: admissions, class delivery, assessment, communication, and legally required record-keeping. We never sell personal data.

### Payment data
Card payments are processed entirely by our licensed payment gateway. **BCSK never stores card numbers** — only a transaction reference and status.

### Retention & rights
Data is retained only as long as necessary for enrollment and legal obligations. Guardians may request access, correction, or deletion of their child's data by contacting bcskr22@gmail.com.`,
  },
  {
    slug: "refund-policy",
    lang: "en",
    title: "Refund Policy",
    content: `## Refund Policy

- **Admission fee** is non-refundable once the application is approved.
- **Semester fee**: refundable at 100% before the semester begins; 50% within the first two weeks of the semester; non-refundable thereafter.
- **Special course fees** follow the same schedule per course start date.
- Refunds for card payments are returned via the payment gateway to the original card; bank-transfer refunds are returned to the originating account within 7 working days of approval.

To request a refund, contact the office at bcskr22@gmail.com with your payment receipt number.`,
  },

  /* ------------ Community/background ------------ */
  {
    slug: "our-community",
    lang: "en",
    title: "Our Community",
    content: `## The Bangladeshi Community in Korea

Bangladeshis have lived, worked, and studied in South Korea for **over 30 years** — a vibrant community of professionals, researchers, students, and business owners contributing across Korean society.

BCSK was born from this community's deepest wish: that our children, growing up in Korea, remain connected to the language of their parents, the faith of their families, and the culture of Bangladesh — while thriving in Korean society.

The school is a genuinely community-run institution: our teachers, governing body, and volunteers all come from the community we serve.`,
  },
];

export async function seedContent(db: PrismaClient) {
  for (const p of pages) {
    await db.contentPage.upsert({
      where: { slug_lang: { slug: p.slug, lang: p.lang } },
      update: {},
      create: { slug: p.slug, lang: p.lang, title: p.title, content: p.content, status: "PUBLISHED" },
    });
  }
  console.log(`Seeded ${pages.length} content pages.`);
}
