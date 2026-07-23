import { BadRequestException } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { validateToolInput } from './validate-tool-input.util';

class SampleInput {
  @IsString()
  query!: string;

  @IsInt()
  @Min(1)
  limit!: number;
}

describe('validateToolInput', () => {
  it("renvoie un objet vide si l'outil ne déclare aucun schéma", async () => {
    const result = await validateToolInput(undefined, { anything: 'ignored' });

    expect(result).toEqual({});
  });

  it('accepte une entrée valide et renvoie une instance typée', async () => {
    const result = await validateToolInput(SampleInput, {
      query: 'flacon',
      limit: 5,
    });

    expect(result).toBeInstanceOf(SampleInput);
    expect(result.query).toBe('flacon');
    expect(result.limit).toBe(5);
  });

  it('refuse une entrée avec un champ manquant ou du mauvais type', async () => {
    await expect(
      validateToolInput(SampleInput, { query: 'flacon', limit: 'cinq' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse une entrée contenant un champ non déclaré (whitelist stricte, comme le ValidationPipe HTTP)', async () => {
    await expect(
      validateToolInput(SampleInput, {
        query: 'flacon',
        limit: 5,
        champInattendu: 'x',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse une entrée absente si le schéma exige des champs', async () => {
    await expect(validateToolInput(SampleInput, undefined)).rejects.toThrow(
      BadRequestException,
    );
  });
});
