import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { buildHelmetOptions, shouldExposeSwagger } from './../src/main';

describe('En-têtes de sécurité HTTP — SEC-04 (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Reproduit exactement la configuration appliquée dans main.ts::bootstrap().
    app.use(helmet(buildHelmetOptions(shouldExposeSwagger(process.env.NODE_ENV))));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/health (GET) porte les en-têtes de sécurité attendus', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');

    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it("HSTS n'est pas activé (déploiement HTTPS non confirmé en V0.9)", async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('une route publique représentative (POST /auth/login) porte les mêmes en-têtes', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'inexistant@example.com', password: 'peu-importe' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
