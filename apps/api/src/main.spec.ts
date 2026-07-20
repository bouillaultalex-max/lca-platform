import type { ContentSecurityPolicyOptions } from 'helmet';
import { buildHelmetOptions, shouldExposeSwagger } from './main';

describe('main.ts — shouldExposeSwagger', () => {
  it("retourne false si NODE_ENV vaut 'production'", () => {
    expect(shouldExposeSwagger('production')).toBe(false);
  });

  it("retourne true pour 'development'", () => {
    expect(shouldExposeSwagger('development')).toBe(true);
  });

  it("retourne true pour 'test'", () => {
    expect(shouldExposeSwagger('test')).toBe(true);
  });

  it('retourne true si NODE_ENV est absent (undefined)', () => {
    expect(shouldExposeSwagger(undefined)).toBe(true);
  });
});

function getDirectives(swaggerEnabled: boolean) {
  const csp = buildHelmetOptions(swaggerEnabled)
    .contentSecurityPolicy as ContentSecurityPolicyOptions;
  return csp.directives as Record<string, string[]>;
}

describe('main.ts — buildHelmetOptions', () => {
  it('désactive HSTS (déploiement HTTPS non confirmé en V0.9)', () => {
    expect(buildHelmetOptions(false).hsts).toBe(false);
    expect(buildHelmetOptions(true).hsts).toBe(false);
  });

  it('policy stricte (sans Swagger) : aucune directive ne tolère unsafe-inline/data:', () => {
    const directives = getDirectives(false);
    expect(directives.defaultSrc).toEqual(["'self'"]);
    expect(directives.scriptSrc).toEqual(["'self'"]);
    expect(directives.scriptSrcAttr).toEqual(["'none'"]);
    expect(directives.styleSrc).toEqual(["'self'"]);
    expect(directives.imgSrc).toEqual(["'self'"]);
    expect(directives.connectSrc).toEqual(["'self'"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
    expect(directives.frameAncestors).toEqual(["'self'"]);
  });

  it('policy Swagger (dev/test) : relâche uniquement styleSrc et imgSrc, jamais scriptSrc/scriptSrcAttr', () => {
    const directives = getDirectives(true);
    expect(directives.styleSrc).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.imgSrc).toEqual(["'self'", 'data:']);
    expect(directives.scriptSrc).toEqual(["'self'"]);
    expect(directives.scriptSrcAttr).toEqual(["'none'"]);
    expect(directives.connectSrc).toEqual(["'self'"]);
  });
});
