import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { StockModule } from './stock/stock.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    // Sert le build React (apps/web) en production/déploiement Docker : le dossier
    // "public" est vide en développement local (le frontend tourne alors séparément
    // via Vite sur son propre port). Les routes API sont exclues pour ne jamais être
    // masquées par le renvoi de index.html (repli SPA de ServeStaticModule).
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: [
        '/auth/{*path}',
        '/catalog/{*path}',
        '/stock/{*path}',
        '/health',
        '/api/{*path}',
      ],
    }),
    PrismaModule,
    AuthModule,
    CatalogModule,
    StockModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
