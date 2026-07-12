import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { spaFallbackMiddleware } from './spa-fallback.middleware';

const PUBLIC_DIR = join(__dirname, '..', 'public');
const INDEX_HTML_PATH = join(PUBLIC_DIR, 'index.html');

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/catalog',
    headers: { accept: 'text/html,application/xhtml+xml' },
    ...overrides,
  } as Request;
}

function buildRes(): Response & { sendFile: jest.Mock } {
  return {
    sendFile: jest.fn((_path: string, cb: (err?: Error) => void) => cb()),
  } as unknown as Response & { sendFile: jest.Mock };
}

describe('spaFallbackMiddleware', () => {
  describe("quand le build frontend (dist/public/index.html) n'existe pas", () => {
    it('laisse toujours passer la requête (next) sans erreur', () => {
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.sendFile).not.toHaveBeenCalled();
    });
  });

  describe('quand le build frontend existe', () => {
    // `apps/api/public/` est un dossier suivi par git (placeholder `.gitkeep`,
    // repli en développement) : on ne le crée/supprime que s'il n'existait pas
    // déjà, pour ne jamais effacer ce placeholder au nettoyage.
    const publicDirPreexisted = existsSync(PUBLIC_DIR);

    beforeAll(() => {
      mkdirSync(PUBLIC_DIR, { recursive: true });
      writeFileSync(INDEX_HTML_PATH, '<!doctype html><title>test</title>');
    });

    afterAll(() => {
      if (publicDirPreexisted) {
        rmSync(INDEX_HTML_PATH, { force: true });
      } else {
        rmSync(PUBLIC_DIR, { recursive: true, force: true });
      }
    });

    it('sert index.html pour une navigation de page (Accept: text/html) sur une route partagée', () => {
      const req = buildReq({ path: '/catalog' });
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(res.sendFile).toHaveBeenCalledWith(
        INDEX_HTML_PATH,
        expect.any(Function),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('sert index.html même pour un endpoint API dont le chemin littéral est identique à une page React (/catalog/recipes)', () => {
      const req = buildReq({ path: '/catalog/recipes' });
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(res.sendFile).toHaveBeenCalledWith(
        INDEX_HTML_PATH,
        expect.any(Function),
      );
    });

    it("laisse passer un appel API réel (fetch, Accept sans 'html')", () => {
      const req = buildReq({
        path: '/catalog/recipes',
        headers: { accept: '*/*' },
      });
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('laisse passer une requête non-GET (POST) même avec Accept: html', () => {
      const req = buildReq({ method: 'POST', path: '/catalog/recipes' });
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('laisse passer une navigation de page vers /api/docs (Swagger)', () => {
      const req = buildReq({ path: '/api/docs' });
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('laisse passer une navigation de page vers /health', () => {
      const req = buildReq({ path: '/health' });
      const res = buildRes();
      const next = jest.fn();

      spaFallbackMiddleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.sendFile).not.toHaveBeenCalled();
    });
  });
});
