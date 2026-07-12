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
import { BatchingModule } from './batching/batching.module';
import { ProductionModule } from './production/production.module';
import { ImportExportModule } from './import-export/import-export.module';
import { FeedbackModule } from './feedback/feedback.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    // Sert le build React (apps/web) en production/déploiement Docker : le dossier
    // "public" est vide en développement local (le frontend tourne alors séparément
    // via Vite sur son propre port).
    //
    // La désambiguïsation "navigation de page vs appel API" pour les chemins
    // partagés (ex: /catalog, /dashboard, /catalog/recipes) est gérée en amont par
    // spaFallbackMiddleware (voir main.ts), via l'en-tête `Accept`. Cette liste
    // `exclude` n'a donc plus qu'un rôle : garantir qu'un vrai appel API (fetch,
    // Accept sans `html`) atteint bien Nest plutôt que le repli SPA de
    // ServeStaticModule. Convention appliquée uniformément à tous les modules :
    // `/prefix/*path` (sans accolades) exige au moins un caractère après le `/` —
    // `isRouteExcluded` teste le chemin avec un "/" ajouté à la fin, et un motif
    // `{*path}` (avec accolades, zéro-ou-plusieurs) matcherait alors à tort le
    // chemin nu `/prefix` lui-même, cassant le SPA sur les pages React qui portent
    // ce même nom. Exception : `/feedback` et `/health` exposent aussi une route
    // littérale à la racine (sans sous-chemin) et sont donc exclus explicitement
    // en plus de leur variante `*path`.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: [
        '/auth/*path',
        '/catalog/*path',
        '/stock/*path',
        '/batching/*path',
        '/production/*path',
        '/import-export/*path',
        '/feedback',
        '/feedback/*path',
        '/dashboard/*path',
        '/health',
        '/api/*path',
      ],
    }),
    PrismaModule,
    AuthModule,
    CatalogModule,
    StockModule,
    BatchingModule,
    ProductionModule,
    ImportExportModule,
    FeedbackModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
