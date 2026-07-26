import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantService } from '../src/assistant/assistant.service';
import { ASSISTANT_THROTTLE_LIMIT } from '../src/assistant/assistant-throttle.constants';
import type { AssistantSseEvent } from '../src/assistant/types/assistant-sse-event';
import { UserRole } from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface ThrottlerErrorBody {
  statusCode: number;
  message: string;
}

/**
 * Tests dédiés à la limitation de débit sur POST /assistant/messages (AI-08).
 * `AssistantService` est remplacé par un espion déterministe : seul le
 * comportement du garde (`AssistantThrottlerGuard`) est sous test ici, jamais
 * `EchoAiProvider` ni un appel réseau réel — la logique de conversation
 * elle-même reste couverte par assistant.service.spec.ts.
 *
 * Utilise directement les valeurs réelles de production (5 messages / 60 s,
 * voir assistant-throttle.constants.ts), sans les raccourcir : chaque
 * scénario emploie un utilisateur distinct pour repartir d'un compteur à
 * zéro (le tracker est `user.id`, voir assistant-throttler.guard.ts), sans
 * jamais attendre l'expiration d'une fenêtre.
 */
describe('Assistant — limitation de débit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let streamMessageMock: jest.Mock;

  const password = 'MotDePasseTest123!';
  const emailA = 'e2e-assistant-throttle-a@lca-mes.local';
  const emailB = 'e2e-assistant-throttle-b@lca-mes.local';
  let tokenA = '';
  let tokenB = '';

  beforeAll(async () => {
    streamMessageMock = jest.fn(function* (): Generator<AssistantSseEvent> {
      yield { type: 'conversation', conversationId: 'e2e-fake-conversation' };
      yield { type: 'chunk', delta: 'ok' };
      yield { type: 'done' };
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AssistantService)
      .useValue({ streamMessage: streamMessageMock })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const site =
      (await prisma.site.findFirst()) ??
      (await prisma.site.create({ data: { name: 'Site de test e2e' } }));
    const passwordHash = await bcrypt.hash(password, 4); // coût réduit : uniquement pour accélérer les tests

    for (const email of [emailA, emailB]) {
      await prisma.user.upsert({
        where: { email },
        update: { passwordHash, active: true },
        create: {
          siteId: site.id,
          fullName: `Utilisateur Test E2E Assistant (${email})`,
          email,
          passwordHash,
          role: UserRole.RESPONSABLE_LABORATOIRE,
        },
      });
    }

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailA, password });
    tokenA = (loginA.body as LoginResponseBody).accessToken;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailB, password });
    tokenB = (loginB.body as LoginResponseBody).accessToken;
  });

  afterEach(() => {
    streamMessageMock.mockClear();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { email: { in: [emailA, emailB] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('exige une authentification (401 sans jeton, jamais transmis à AssistantService)', async () => {
    await request(app.getHttpServer())
      .post('/assistant/messages')
      .send({ content: 'Bonjour' })
      .expect(401);

    expect(streamMessageMock).not.toHaveBeenCalled();
  });

  it(
    `autorise les ${ASSISTANT_THROTTLE_LIMIT} premières requêtes d'un utilisateur, bloque la ` +
      `${ASSISTANT_THROTTLE_LIMIT + 1}e (429) sans jamais appeler AssistantService pour elle, ` +
      'et laisse un second utilisateur intact malgré la même adresse IP de test',
    async () => {
      for (let attempt = 1; attempt <= ASSISTANT_THROTTLE_LIMIT; attempt += 1) {
        await request(app.getHttpServer())
          .post('/assistant/messages')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ content: `Message ${attempt}` })
          .expect(200);
      }
      expect(streamMessageMock).toHaveBeenCalledTimes(ASSISTANT_THROTTLE_LIMIT);

      const blockedResponse = await request(app.getHttpServer())
        .post('/assistant/messages')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Message en trop' })
        .expect(429);

      const body = blockedResponse.body as ThrottlerErrorBody;
      expect(body.statusCode).toBe(429);
      expect(body.message).toContain('Too Many Requests');
      // La requête bloquée n'a jamais atteint AssistantService (toujours 5, pas 6).
      expect(streamMessageMock).toHaveBeenCalledTimes(ASSISTANT_THROTTLE_LIMIT);

      // Même client de test (donc même adresse IP) mais utilisateur distinct :
      // son quota est intact, la requête est donc autorisée — preuve que le
      // tracker est bien `user.id`, pas l'IP.
      await request(app.getHttpServer())
        .post('/assistant/messages')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'Bonjour depuis un autre utilisateur' })
        .expect(200);
      expect(streamMessageMock).toHaveBeenCalledTimes(
        ASSISTANT_THROTTLE_LIMIT + 1,
      );
    },
  );
});
