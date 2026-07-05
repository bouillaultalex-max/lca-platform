import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Module global : PrismaService est injectable dans n'importe quel module
 * métier sans réimporter PrismaModule partout (une seule connexion pour toute l'app).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
