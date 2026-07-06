import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateArticleDto } from './create-article.dto';

/**
 * Le type d'article (MATIERE_PREMIERE / PACKAGING / PRODUIT_FINI) n'est jamais
 * modifiable après création : il détermine la sémantique des relations existantes
 * (recettes, stock...). Pour changer de type, désactiver l'article et en créer un autre.
 */
export class UpdateArticleDto extends PartialType(
  OmitType(CreateArticleDto, ['type'] as const),
) {}
