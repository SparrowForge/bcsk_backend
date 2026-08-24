import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { DocumentService, type DocumentType } from "./document.service";
import { CurrentActor, Public, RequirePermission } from "@/common/decorators/actor.decorator";
import type { Actor } from "@/common/actor";

const idParam = z.coerce.number().int().positive();
const typeParam = z.enum(["certificate", "id-card", "result-sheet"]);

@Controller()
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  private send(res: Response, filename: string, pdf: Buffer) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdf);
  }

  /** A student's own documents. */
  @Get("documents/:type")
  async mine(@Param("type") raw: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const type = typeParam.parse(raw) as DocumentType;
    const { filename, pdf } = await this.documents.generate(actor, actor.userId, type);
    this.send(res, filename, pdf);
  }

  /** Staff generating a document for a given student. */
  @RequirePermission("reports:manage")
  @Get("admin/documents/:userId/:type")
  async forStudent(
    @Param("userId") rawId: string,
    @Param("type") rawType: string,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.documents.generate(
      actor,
      idParam.parse(rawId),
      typeParam.parse(rawType) as DocumentType,
    );
    this.send(res, filename, pdf);
  }

  /** Owner or staff — ownership is decided inside the service. */
  @Get("receipts/:id")
  async receipt(@Param("id") raw: string, @CurrentActor() actor: Actor, @Res() res: Response) {
    const { filename, pdf } = await this.documents.receipt(actor, idParam.parse(raw));
    this.send(res, filename, pdf);
  }

  @RequirePermission("payments:export")
  @Get("admin/payments-export")
  async csv(@Res() res: Response) {
    const body = await this.documents.paymentsCsv();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="bcsk-payments-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(body);
  }

  /** Public: anyone holding a printed document may check its serial. */
  @Public()
  @Get("verify/:serial")
  verify(@Param("serial") serial: string) {
    return this.documents.verify(serial);
  }
}
