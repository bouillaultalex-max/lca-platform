import { PartialType } from '@nestjs/swagger';
import { CreateArticleDto } from './create-article.dto';

/**
 * Le type d'article (MATIERE_PREMIERE / PACKAGING / PRODUIT_FINI) n'est modifiable
 * que si l'article n'a encore jamais été utilisé (aucune recette, aucun stock, aucune
 * généalogie) — voir ArticlesService.update(). Sinon, désactiver l'article et en créer
 * un autre.
 */
export class UpdateArticleDto extends PartialType(CreateArticleDto) {}
