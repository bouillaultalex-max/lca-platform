import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface LotCounter {
  lot: { count: (args: { where: { siteId: string } }) => Promise<number> };
}

/**
 * Génère le numéro de lot à la clôture d'un batch — convention interne confirmée :
 * 6 chiffres commençant par 455 (ex : `455XXX`), voir docs/regles-metier.md §4.
 *
 * TODO (placeholder temporaire) : l'algorithme exact (incrémentation, remise à zéro,
 * gestion des collisions...) n'a pas encore été fourni par l'utilisateur. L'implémentation
 * actuelle est un compteur séquentiel simple par site (455001, 455002...), isolée
 * derrière ce service pour être remplacée sans impacter le reste du MES le jour où
 * la règle réelle sera précisée. Ne gère pas les collisions concurrentes (acceptable
 * en V0.9 : 2 utilisateurs, faible volume) ni la remise à zéro périodique.
 */
@Injectable()
export class LotNumberGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    siteId: string,
    client: LotCounter = this.prisma,
  ): Promise<string> {
    const existingCount = await client.lot.count({ where: { siteId } });
    return `455${String(existingCount + 1).padStart(3, '0')}`;
  }
}
