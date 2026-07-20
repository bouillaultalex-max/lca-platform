import { shouldExposeSwagger } from './main';

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
