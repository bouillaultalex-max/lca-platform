import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ImportLog,
  ImportStatus,
  ImportType,
  Prisma,
} from '../../../generated/prisma/client';

export interface ImportErrorDetail {
  line: number;
  message: string;
}

/**
 * Journal partagé par tous les types d'import OpenSi (voir docs/regles-metier.md §7) :
 * une prévisualisation crée systématiquement une entrée (même si l'utilisateur
 * abandonne ensuite), la confirmation la fait simplement passer à VALIDE.
 */
@Injectable()
export class ImportLogsService {
  constructor(private readonly prisma: PrismaService) {}

  createPreview(
    siteId: string,
    userId: string,
    type: ImportType,
    fileName: string,
    processedLines: number,
    errorDetails: ImportErrorDetail[],
  ): Promise<ImportLog> {
    return this.prisma.importLog.create({
      data: {
        siteId,
        userId,
        type,
        fileName,
        status: ImportStatus.PREVISUALISE,
        processedLines,
        errorCount: errorDetails.length,
        errorDetails:
          errorDetails.length > 0
            ? (errorDetails as unknown as Prisma.InputJsonValue)
            : undefined,
      },
    });
  }

  async markValidated(siteId: string, importLogId: string): Promise<ImportLog> {
    const importLog = await this.prisma.importLog.findFirst({
      where: { id: importLogId, siteId },
    });
    if (!importLog) {
      throw new NotFoundException(
        `Historique d'import ${importLogId} introuvable.`,
      );
    }

    return this.prisma.importLog.update({
      where: { id: importLogId },
      data: { status: ImportStatus.VALIDE },
    });
  }

  findAll(siteId: string, type?: ImportType): Promise<ImportLog[]> {
    return this.prisma.importLog.findMany({
      where: { siteId, ...(type ? { type } : {}) },
      orderBy: { importedAt: 'desc' },
    });
  }
}
