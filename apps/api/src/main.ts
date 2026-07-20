import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet, { type HelmetOptions } from 'helmet';
import { AppModule } from './app.module';
import { spaFallbackMiddleware } from './spa-fallback.middleware';

// Swagger documente les routes de l'API (schémas, auth) : exposer /api/docs en
// production reviendrait à publier cette cartographie sans raison opérationnelle.
export function shouldExposeSwagger(nodeEnv: string | undefined): boolean {
  return nodeEnv !== 'production';
}

// Calibrée sur le build réel du frontend (apps/web/dist, voir SEC-04) : un seul
// bundle JS et une seule feuille de style, tous deux servis en même origine que
// l'API (architecture mono-origine, voir CLAUDE.md), sans script/style inline,
// sans police ni image externe, sans appel réseau hors origine (tous les appels
// de apps/web/src/api/client.ts sont des chemins relatifs). Aucune de ces
// directives n'a donc besoin de 'unsafe-inline', 'unsafe-eval', ni d'une origine
// tierce — `useDefaults: false` pour que la liste ci-dessous soit la politique
// complète et explicite, sans directive implicite ajoutée par Helmet.
//
// `swaggerEnabled` ne relâche que `styleSrc`/`imgSrc` : la page Swagger UI
// (swagger-ui-dist, servie hors production — voir shouldExposeSwagger / SEC-03)
// embarque deux blocs <style> inline dans son HTML statique et charge à l'exécution
// des icônes SVG en URI `data:` (générées par son bundle JS, invisibles dans le
// HTML statique — constaté en testant réellement /api/docs dans un navigateur).
// Ni l'un ni l'autre n'est sous notre contrôle ni modifiable ici (hors périmètre
// SEC-04). Swagger ne charge en revanche aucun script inline (ses <script>
// pointent vers des fichiers JS servis en même origine), donc scriptSrc reste
// 'self' strict dans tous les environnements.
//
// `scriptSrcAttr: ["'none'"]` reprend la valeur par défaut de Helmet (seule
// directive par défaut omise par `useDefaults: false`) : aucun gestionnaire
// d'événement inline (onclick=...) n'existe dans le frontend ni dans Swagger,
// donc coût nul aujourd'hui ; explicite pour ne pas dépendre du repli en
// cascade sur scriptSrc si celui-ci était assoupli plus tard pour une autre
// raison (ex. ajout d'un CDN de script).
export function buildHelmetOptions(swaggerEnabled: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: swaggerEnabled ? ["'self'", "'unsafe-inline'"] : ["'self'"],
        imgSrc: swaggerEnabled ? ["'self'", 'data:'] : ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Le déploiement HTTPS n'est pas encore défini en V0.9 (voir docs/roadmap.md) :
    // forcer HSTS maintenant risquerait de verrouiller un accès HTTP encore utilisé,
    // pour un gain nul tant qu'aucune terminaison TLS n'est en place. À activer
    // explicitement une fois le déploiement HTTPS décidé.
    hsts: false,
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const swaggerEnabled = shouldExposeSwagger(process.env.NODE_ENV);

  // Doit être appliqué au plus tôt, avant tout autre middleware ou route, pour
  // que les en-têtes de sécurité couvrent toutes les réponses (API et frontend
  // statique servi par ServeStaticModule).
  app.use(helmet(buildHelmetOptions(swaggerEnabled)));

  // Doit être enregistré avant ServeStaticModule (initialisé plus tard, lors de
  // app.listen()) pour intercepter en priorité toute navigation de page — voir
  // spa-fallback.middleware.ts pour le détail du problème résolu.
  app.use(spaFallbackMiddleware);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('LCA-MES API')
      .setDescription(
        'API de gestion de production du laboratoire LCA Distribution (Maison Fuel)',
      )
      .setVersion('0.9.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`API démarrée sur http://localhost:${port}`, 'Bootstrap');
  if (swaggerEnabled) {
    Logger.log(
      `Documentation Swagger sur http://localhost:${port}/api/docs`,
      'Bootstrap',
    );
  }
}
// Exécuté uniquement lorsque ce fichier est lancé directement (`node dist/src/main`),
// jamais lors d'un import (ex: le test de `shouldExposeSwagger` ci-dessous) — évite
// tout démarrage réel de l'application (connexion DB, écoute du port) pendant les tests.
if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    Logger.error(
      "Échec du démarrage de l'API",
      error instanceof Error ? error.stack : String(error),
      'Bootstrap',
    );
    process.exit(1);
  });
}
