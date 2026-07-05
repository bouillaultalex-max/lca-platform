import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Enveloppe NestJS autour du client Prisma généré.
 *
 * Depuis Prisma 7, `PrismaClient` ne lit plus `DATABASE_URL` implicitement :
 * un "driver adapter" doit être fourni explicitement (ici `@prisma/adapter-pg`).
 * Gère aussi l'ouverture/fermeture de la connexion avec le cycle de vie du module
 * Nest, pour éviter les connexions orphelines lors des rechargements en
 * développement et garantir un arrêt propre en production.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaPg(configService.getOrThrow<string>('DATABASE_URL')),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connexion PostgreSQL établie');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
