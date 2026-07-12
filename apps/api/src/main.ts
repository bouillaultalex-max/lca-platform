import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { spaFallbackMiddleware } from './spa-fallback.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`API démarrée sur http://localhost:${port}`, 'Bootstrap');
  Logger.log(
    `Documentation Swagger sur http://localhost:${port}/api/docs`,
    'Bootstrap',
  );
}
bootstrap().catch((error: unknown) => {
  Logger.error(
    "Échec du démarrage de l'API",
    error instanceof Error ? error.stack : String(error),
    'Bootstrap',
  );
  process.exit(1);
});
