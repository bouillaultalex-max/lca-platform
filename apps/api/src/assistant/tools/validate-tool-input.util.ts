import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

/**
 * Valide l'entrée d'un outil contre son `inputSchema` (voir tool.types.ts),
 * avec exactement la même discipline que le `ValidationPipe` global des
 * endpoints HTTP (`whitelist: true, forbidNonWhitelisted: true`, voir main.ts) :
 * tout champ non déclaré est rejeté, jamais silencieusement ignoré. Aucun
 * appel Prisma ici — validation pure.
 */
export async function validateToolInput<T>(
  schema: (new () => T) | undefined,
  rawInput: unknown,
): Promise<T> {
  if (!schema) {
    return {} as T;
  }

  const instance = plainToInstance(schema, rawInput ?? {}) as object;
  const errors = await validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  if (errors.length > 0) {
    const message = errors
      .flatMap((error) => Object.values(error.constraints ?? {}))
      .join(' ');
    throw new BadRequestException(message || 'Paramètres invalides.');
  }

  return instance as T;
}
