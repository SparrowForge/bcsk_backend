/**
 * Academic > All General Classes: the class pages and their books, as the school drew them in
 * "Academic Curriculum Page Design" (Oct 2026). Images are the mockup crops bundled with the
 * frontend under /images/academic/, standing in until the office uploads real photos.
 *
 * Safe to re-run: a class is matched by slug and its descriptive fields refreshed, but its
 * subjects are written only while it has none, so books edited in the admin panel survive.
 *
 *   npm run db:seed-academic            # dry run - prints what it would write
 *   npm run db:seed-academic -- --apply
 */
import { PrismaClient } from "@prisma/client";

type Subject = {
  title: string;
  category: "MAIN" | "RELATED" | "HOMEWORK";
  description: string;
  outcomes: string[];
  color: string;
  cover: string;
};

const img = (name: string) => `/images/academic/${name}.jpg`;

const S = {
  banglaMain: {
    title: "Bangla Main Book", category: "MAIN", color: "pink", cover: "book-bangla-main",
    description: "Builds reading, writing and comprehension skills in Bangla through simple, fun and age-appropriate lessons.",
    outcomes: ["Letter recognition and sounds", "Word building and vocabulary", "Simple reading and writing", "Moral values and good habits"],
  },
  banglaWork: {
    title: "Bangla Work Book", category: "HOMEWORK", color: "pink", cover: "book-bangla-work",
    description: "Strengthens reading, writing and comprehension skills in Bangla through practical exercises and activities.",
    outcomes: ["Writing practice and sentence formation", "Vocabulary building", "Reading comprehension", "Handwriting improvement"],
  },
  gk: {
    title: "General Knowledge Book", category: "RELATED", color: "purple", cover: "book-general-knowledge",
    description: "Expands general knowledge, builds curiosity and develops awareness about the world around us.",
    outcomes: ["Our country and world", "Nature and environment", "Science and technology", "Everyday life and good habits"],
  },
  englishMain: {
    title: "English Main Book", category: "MAIN", color: "blue", cover: "book-english-main",
    description: "Develops listening, speaking, reading and writing skills in English through fun and interactive activities.",
    outcomes: ["Alphabet and phonics", "Basic vocabulary and sentences", "Listening and speaking", "Early reading and writing"],
  },
  englishWork: {
    title: "English Work Book", category: "HOMEWORK", color: "blue", cover: "book-english-work",
    description: "Strengthens English language skills through practice exercises and engaging activities.",
    outcomes: ["Vocabulary and grammar", "Reading comprehension", "Writing practice", "Listening and speaking"],
  },
  spelling: {
    title: "Spelling Success Book", category: "RELATED", color: "teal", cover: "book-spelling-success",
    description: "Builds spelling skills and improves word recognition through fun and systematic practice.",
    outcomes: ["Word families and patterns", "Correct spelling", "Vocabulary building", "Writing practice"],
  },
  advance: {
    title: "Advance Learner", category: "RELATED", color: "yellow", cover: "book-advance-learner",
    description: "Develops higher-order thinking, problem-solving and independent learning skills through challenging activities.",
    outcomes: ["Critical thinking", "Creative problem solving", "Independent learning", "Project-based activities"],
  },
  mathsMain: {
    title: "Mathematics Main Book", category: "MAIN", color: "orange", cover: "book-maths-main",
    description: "Builds number sense, problem-solving skills and logical thinking through simple and practical activities.",
    outcomes: ["Number recognition and counting", "Basic addition and subtraction", "Shapes and patterns", "Everyday math concepts"],
  },
  mathsWork: {
    title: "Mathematics Work Book", category: "HOMEWORK", color: "orange", cover: "book-maths-work",
    description: "Reinforces math concepts through focused practice, exercises and real-life problem solving.",
    outcomes: ["Number practice and operations", "Shapes and measurement", "Word problems", "Logical thinking and reasoning"],
  },
  science: {
    title: "General Science Book", category: "MAIN", color: "green", cover: "book-general-science",
    description: "Explores the natural world, living things and our environment through hands-on and curious learning.",
    outcomes: ["Living things and their needs", "Plants, animals and environment", "Matter and energy", "Health and safety"],
  },
  bdGlobal: {
    title: "Bangladesh & Global Studies", category: "MAIN", color: "indigo", cover: "book-bangladesh-global",
    description: "Builds awareness of our country, the world and important social issues for responsible citizenship.",
    outcomes: ["Bangladesh and its people", "Global communities and cultures", "Environment and sustainability"],
  },
  islamic: {
    title: "Islamic Religion Book", category: "MAIN", color: "green", cover: "book-islamic-religion",
    description: "Teaches the basic teachings of Islam, good manners and moral values in a simple and easy way.",
    outcomes: ["Quran and Hadith (age-appropriate)", "Salah and daily prayers", "Islamic manners", "Stories of good people"],
  },
  islamicWork: {
    title: "Islamic Religion Work Book", category: "HOMEWORK", color: "green", cover: "book-islamic-work",
    description: "Provides practice activities to reinforce Islamic teachings and good manners.",
    outcomes: ["Quran and Hadith practice", "Salah and daily prayers", "Manners and behaviour", "Activity exercises"],
  },
  qaida: {
    title: "Qaida & Quran Book", category: "RELATED", color: "purple", cover: "book-qaida-quran",
    description: "Helps children learn to read the Quran with proper pronunciation and correct Arabic letters.",
    outcomes: ["Arabic letter recognition", "Pronunciation practice", "Word and short sentence reading", "Tajweed basics"],
  },
  dua: {
    title: "Dua Pori Book", category: "RELATED", color: "teal", cover: "book-dua-pori",
    description: "Introduces important daily duas in a simple way to help children connect with Allah in their daily lives.",
    outcomes: ["Daily duas (morning, evening, before sleep, etc.)", "Dua with meaning", "Good manners and etiquette", "Memorization through repetition"],
  },
  debate: {
    title: "BCSK's Debate Book", category: "RELATED", color: "blue", cover: "book-debate",
    description: "Develops speaking, listening, critical thinking and confidence through simple debate topics and activities.",
    outcomes: ["Logical thinking", "Public speaking", "Research and argumentation", "Teamwork and respect"],
  },
  ict: {
    title: "Information & Communication Technology (ICT)", category: "MAIN", color: "teal", cover: "book-ict",
    description: "Introduces the basics of computers, internet and digital tools for a safer and smarter future.",
    outcomes: ["Computer basics and software", "Internet and online safety", "Digital skills and productivity", "Responsible use of technology"],
  },
} satisfies Record<string, Subject>;

function abacus(level: number): Subject {
  return {
    title: `BCSK's Abacus Smart Book, Level-${level}`,
    category: "RELATED",
    color: "indigo",
    cover: "book-abacus",
    ...(level === 0
      ? {
          description: "Introduces abacus and builds basic calculation skills through fun and easy activities.",
          outcomes: ["Number recognition", "Basic addition and subtraction", "Mental calculation", "Focus and concentration"],
        }
      : {
          description: "Builds advanced abacus skills and improves speed and accuracy in mental math.",
          outcomes: ["Larger numbers", "Addition, subtraction, multiplication", "Mental math practice", "Confidence and concentration"],
        }),
  };
}

const STRONGER = "Building stronger skills for a brighter tomorrow";
const HIGHLIGHTS = ["Stronger Literacy Skills", "Math Concepts", "Critical Thinking & Problem Solving", "Good Manners & Values", "Social & Emotional Growth"];

const CLASSES: {
  slug: string; name: string; ageRange: string; color: string; summary: string; tagline: string;
  intro: string; highlights: string[]; card: string; subjects: Subject[];
}[] = [
  {
    slug: "pre-primary", name: "Pre-Primary", ageRange: "Age 3-5", color: "green", card: "class-pre-primary",
    summary: "Play, explore and learn! Our pre-primary program builds confidence, creativity and essential life skills through fun and engaging activities.",
    tagline: "A strong foundation for a brighter future",
    intro: "Our Pre-Primary program provides a nurturing and engaging learning environment where young learners build essential skills, develop good habits, and gain confidence. We focus on language development, early literacy, numeracy, Islamic values, and social-emotional growth through interactive and play-based learning activities.",
    highlights: ["Early Literacy & Language Skills", "Basic Math Concepts", "Islamic Values & Good Habits", "Social & Emotional Development", "Creativity & Exploration", "Play-Based Learning"],
    subjects: [
      S.banglaMain, S.banglaWork,
      { ...S.englishMain, description: "Introduces English in a friendly and interactive way, focusing on listening, speaking, reading and basic writing." },
      {
        ...S.englishWork,
        description: "Provides practice activities to build reading, writing and communication skills in English.",
        outcomes: ["Letter and word practice", "Sentence formation", "Reading comprehension", "Handwriting and spelling"],
      },
      S.mathsMain, S.mathsWork, S.islamic,
      { ...S.qaida, title: "Qaida Book" },
      S.dua,
    ],
  },
  {
    slug: "class-1", name: "Class 1", ageRange: "Age 6-7", color: "blue", card: "class-1",
    summary: "We focus on building basic skills, good habits and a strong academic foundation for young learners.",
    tagline: "Building strong foundations for a brighter future",
    intro: "Our Class 1 program helps young learners build essential skills in reading, writing, math and character development. We focus on creative learning, interactive activities and a balanced curriculum to boost confidence, curiosity and a love for learning.",
    highlights: ["Strong Literacy Skills", "Math Concepts", "Critical Thinking & Problem Solving", "Good Manners & Values", "Social & Emotional Growth"],
    subjects: [S.banglaMain, S.banglaWork, S.gk, S.englishMain, S.englishWork, S.spelling, S.mathsMain, S.mathsWork, S.islamic, S.islamicWork, S.qaida, S.dua, abacus(0), abacus(1), S.debate],
  },
  {
    slug: "class-2", name: "Class 2", ageRange: "Age 7-8", color: "purple", card: "class-2",
    summary: "We encourage curiosity, independent thinking and steady progress in all subject areas.",
    tagline: STRONGER,
    intro: "Our Class 2 program builds on early learning and helps children develop stronger academic skills, higher confidence and good character. We focus on reading, writing, problem solving, creativity and social-emotional growth through interactive and enjoyable learning activities.",
    highlights: ["Stronger Literacy Skills", "Math Confidence", "Critical Thinking & Problem Solving", "Good Manners & Values", "Social & Emotional Growth"],
    subjects: [S.banglaMain, S.banglaWork, S.gk, S.englishMain, S.englishWork, S.spelling, S.mathsMain, S.mathsWork, S.islamic, S.islamicWork, S.qaida, S.dua, abacus(0), abacus(1), S.debate],
  },
  {
    slug: "class-3", name: "Class 3", ageRange: "Age 8-9", color: "orange", card: "class-3",
    summary: "We build critical thinking, problem-solving skills and confidence for greater academic success.",
    tagline: STRONGER,
    intro: "Our Class 3 program builds on early learning and helps children develop stronger academic skills, higher confidence and good character. We focus on reading, writing, problem solving, creativity and social-emotional growth through interactive and enjoyable learning activities.",
    highlights: HIGHLIGHTS,
    subjects: [S.banglaMain, S.gk, S.englishMain, S.spelling, S.advance, S.mathsMain, S.science, S.bdGlobal, S.islamic, S.qaida, S.dua, abacus(2), abacus(3), S.debate],
  },
  {
    slug: "class-4", name: "Class 4", ageRange: "Age 9-10", color: "teal", card: "class-4",
    summary: "We develop analytical thinking, creativity and teamwork skills to prepare for future challenges.",
    tagline: STRONGER,
    intro: "Our Class 4 program builds on earlier learning and helps children strengthen their academic skills, develop critical thinking, and gain confidence. We focus on reading, writing, problem solving, creativity and character building through interactive and enjoyable learning activities.",
    highlights: HIGHLIGHTS,
    subjects: [S.banglaMain, S.gk, S.englishMain, S.spelling, S.advance, S.mathsMain, S.science, S.islamic, S.qaida, S.dua, abacus(4), abacus(5), S.debate],
  },
  {
    slug: "class-5", name: "Class 5", ageRange: "Age 10-11", color: "red", card: "class-5",
    summary: "We strengthen leadership, communication and advanced learning skills for higher achievement.",
    tagline: STRONGER,
    intro: "Our Class 5 program builds on earlier learning and helps children develop stronger academic skills, higher confidence and good character. We focus on reading, writing, problem solving, critical thinking, creativity and responsible citizenship through interactive and engaging learning activities.",
    highlights: HIGHLIGHTS,
    subjects: [
      {
        ...S.banglaMain,
        description: "Builds reading, writing and comprehension skills in Bangla through interesting texts and activities.",
        outcomes: ["Letter recognition and sounds", "Reading comprehension", "Vocabulary building", "Creative writing and expression"],
      },
      { ...S.gk, outcomes: ["Our country and world", "Science and technology", "Current affairs and global issues", "Thinking and problem solving"] },
      { ...S.englishMain, outcomes: ["Alphabet and phonics", "Reading comprehension", "Vocabulary building", "Writing and communication"] },
      S.spelling, S.advance, S.mathsMain, S.science, S.islamic, S.qaida, S.dua, S.debate,
    ],
  },
  {
    slug: "class-6", name: "Class 6", ageRange: "Age 12", color: "indigo", card: "class-6",
    summary: "We build confidence, leadership and advanced learning skills to prepare students for higher education and beyond.",
    tagline: STRONGER,
    intro: "Our Class 6 program builds on earlier learning and helps children develop advanced academic skills, higher thinking, and strong character. We focus on reading, writing, problem solving, critical thinking, creativity and responsibility through interactive and engaging learning activities.",
    highlights: HIGHLIGHTS,
    subjects: [
      {
        ...S.banglaMain,
        description: "Builds reading, writing and comprehension skills in Bangla through literature, grammar and creative activities.",
        outcomes: ["Letter recognition and fluency", "Reading comprehension", "Writing skills and grammar", "Vocabulary building"],
      },
      { ...S.gk, outcomes: ["Our country and world", "Science and technology", "Current affairs and global issues", "Thinking and problem solving"] },
      { ...S.englishMain, outcomes: ["Alphabet and phonics", "Reading comprehension", "Vocabulary building", "Writing and communication"] },
      S.advance, S.mathsMain, S.science, S.islamic,
      { ...S.qaida, title: "Quran Book", color: "pink", cover: "book-quran" },
      S.debate, S.ict,
    ],
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    for (const [i, c] of CLASSES.entries()) {
      const data = {
        name: c.name, ageRange: c.ageRange, color: c.color, summary: c.summary, tagline: c.tagline,
        intro: c.intro, highlights: c.highlights, cardImageUrl: img(c.card),
        bannerImageUrl: img("class-banner"), displayOrder: (i + 1) * 10,
      };
      const existing = await prisma.academicClass.findUnique({
        where: { slug: c.slug },
        include: { _count: { select: { subjects: true } } },
      });
      const writeSubjects = !existing || existing._count.subjects === 0;
      console.log(
        `${existing ? "update" : "create"} ${c.slug}` +
          (writeSubjects ? ` + ${c.subjects.length} subjects` : ` (keeps its ${existing!._count.subjects} subjects)`),
      );
      if (!apply) continue;
      const row = await prisma.academicClass.upsert({ where: { slug: c.slug }, create: { slug: c.slug, ...data }, update: data });
      if (writeSubjects) {
        await prisma.classSubject.createMany({
          data: c.subjects.map((s, n) => ({
            classId: row.id,
            title: s.title,
            category: s.category,
            description: s.description,
            outcomes: s.outcomes,
            color: s.color,
            coverImageUrl: img(s.cover),
            displayOrder: (n + 1) * 10,
          })),
        });
      }
    }
    if (!apply) console.log("\nDry run. Re-run with --apply to write.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
