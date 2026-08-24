import { Injectable } from "@nestjs/common";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { PrismaService } from "@/database/prisma.service";
import { notFound } from "@/common/errors/app-error";
import { toPage, toPrismaPage, type Page, type PageRequest } from "@/common/pagination/cursor";
import type { Lang } from "@/common/constants";

/**
 * Public site content: CMS pages, news, gallery, the teacher directory and the fee table.
 *
 * A service takes plain arguments and returns plain data. It knows nothing about HTTP, which
 * is what lets the same method serve a web page, a mobile screen and a test.
 */

/* SEC-6: markdown is admin-authored and rendered as HTML, so it must be sanitised.
   `marked` passes raw HTML through by default — a <script> in a CMS page would otherwise
   execute on the public homepage. */
const ALLOWED_TAGS = [
  "h1","h2","h3","h4","h5","h6","p","br","hr","strong","em","del","blockquote",
  "ul","ol","li","a","code","pre","table","thead","tbody","tr","th","td","img","span","div",
];
const ALLOWED_ATTR = ["href", "title", "alt", "src", "colspan", "rowspan", "class", "id"];

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|\/|#)/i,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["style", "srcset", "formaction", "form"],
  });
}

@Injectable()
export class CmsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A published page in the requested language, falling back to English. */
  async getPage(slug: string, lang: Lang) {
    const page =
      (await this.prisma.contentPage.findFirst({ where: { slug, lang, status: "PUBLISHED" } })) ??
      (await this.prisma.contentPage.findFirst({ where: { slug, lang: "en", status: "PUBLISHED" } }));
    if (!page) throw notFound("Page");
    return {
      slug: page.slug,
      lang: page.lang,
      title: page.title,
      html: renderMarkdown(page.content),
      updatedAt: page.updatedAt,
    };
  }

  async listNews(req: PageRequest, type?: string): Promise<Page<{ id: number; title: string; type: string; date: Date; imageUrl: string | null; body: string }>> {
    const rows = await this.prisma.eventNews.findMany({
      where: { published: true, ...(type ? { type } : {}) },
      orderBy: { id: "desc" },
      select: { id: true, title: true, type: true, date: true, imageUrl: true, body: true },
      ...toPrismaPage(req),
    });
    return toPage(rows, req);
  }

  async getNewsItem(id: number) {
    const item = await this.prisma.eventNews.findFirst({ where: { id, published: true } });
    if (!item) throw notFound("News item");
    return { ...item, html: renderMarkdown(item.body) };
  }

  /** Teachers who have opted into the public directory. */
  async listPublicTeachers() {
    const teachers = await this.prisma.teacherProfile.findMany({
      where: { isPublic: true },
      orderBy: { displayOrder: "asc" },
      include: { user: { select: { name: true } } },
    });
    // Shaped explicitly: a teacher's email and login id must not leak into a public payload.
    return teachers.map((t) => ({
      teacherId: t.teacherId,
      name: t.user.name,
      designation: t.designation,
      subjects: t.subjects,
      bio: t.bio,
      photoUrl: t.photoUrl,
    }));
  }

  /**
   * Governing body and regional representatives.
   *
   * Contact details are included deliberately: these are published community contacts, and
   * the public site has always listed them so families can reach a representative. This is
   * a considered exposure, not an oversight — contrast `listPublicTeachers`, which shapes
   * staff contact details out.
   */
  async listGoverningMembers(kind: "GOVERNING" | "REGIONAL") {
    return this.prisma.governingMember.findMany({
      where: { kind },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true, name: true, role: true, organization: true,
        region: true, phone: true, email: true, photoUrl: true, bio: true,
      },
    });
  }

  /** The published fee table. Amounts are authoritative here and nowhere else (SEC-3). */
  async listFees() {
    return this.prisma.feeConfig.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
    });
  }

  async listGalleryAlbums() {
    return this.prisma.galleryAlbum.findMany({ include: { items: true } });
  }
}
