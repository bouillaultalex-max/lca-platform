import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBatchStopDto } from './dto/create-batch-stop.dto';
import { EndBatchStopDto } from './dto/end-batch-stop.dto';
import {
  Batch,
  BatchStatus,
  BatchStop,
} from '../../../generated/prisma/client';

@Injectable()
export class BatchStopsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByBatch(siteId: string, batchId: string): Promise<BatchStop[]> {
    await this.getBatch(siteId, batchId);
    return this.prisma.batchStop.findMany({
      where: { batchId },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** Ouvre un arrêt. Un seul arrêt peut être ouvert à la fois pour un même batch. */
  async start(
    siteId: string,
    batchId: string,
    dto: CreateBatchStopDto,
  ): Promise<BatchStop> {
    const batch = await this.getBatch(siteId, batchId);
    if (batch.status !== BatchStatus.EN_COURS) {
      throw new BadRequestException(
        'Un arrêt ne peut être enregistré que sur un batch en cours.',
      );
    }

    const openStop = await this.prisma.batchStop.findFirst({
      where: { batchId, endedAt: null },
    });
    if (openStop) {
      throw new BadRequestException(
        'Un arrêt est déjà en cours pour ce batch ; clôturez-le avant d’en ouvrir un nouveau.',
      );
    }

    return this.prisma.batchStop.create({
      data: { batchId, reason: dto.reason, startedAt: new Date(dto.startedAt) },
    });
  }

  /** Clôture un arrêt et calcule sa durée en minutes. */
  async end(
    siteId: string,
    stopId: string,
    dto: EndBatchStopDto,
  ): Promise<BatchStop> {
    const stop = await this.prisma.batchStop.findFirst({
      where: { id: stopId, batch: { siteId } },
    });
    if (!stop) {
      throw new NotFoundException(`Arrêt ${stopId} introuvable.`);
    }
    if (stop.endedAt !== null) {
      throw new BadRequestException('Cet arrêt est déjà clôturé.');
    }

    const endedAt = new Date(dto.endedAt);
    if (endedAt < stop.startedAt) {
      throw new BadRequestException(
        'La date de fin ne peut pas être antérieure à la date de début.',
      );
    }
    const durationMinutes = Math.round(
      (endedAt.getTime() - stop.startedAt.getTime()) / 60000,
    );

    return this.prisma.batchStop.update({
      where: { id: stopId },
      data: { endedAt, durationMinutes },
    });
  }

  private async getBatch(siteId: string, batchId: string): Promise<Batch> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
    });
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} introuvable.`);
    }
    return batch;
  }
}
