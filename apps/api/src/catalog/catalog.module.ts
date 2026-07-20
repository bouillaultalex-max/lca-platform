import { Module } from '@nestjs/common';
import { ArticlesController } from './articles/articles.controller';
import { ArticlesService } from './articles/articles.service';
import { MachinesController } from './machines/machines.controller';
import { MachinesService } from './machines/machines.service';
import { SuppliersController } from './suppliers/suppliers.controller';
import { SuppliersService } from './suppliers/suppliers.service';
import { MarketsController } from './markets/markets.controller';
import { MarketsService } from './markets/markets.service';
import { ProductFamiliesController } from './product-families/product-families.controller';
import { ProductFamiliesService } from './product-families/product-families.service';
import { RecipesController } from './recipes/recipes.controller';
import { RecipesService } from './recipes/recipes.service';
import { RecipeDraftsController } from './recipes/drafts/recipe-drafts.controller';
import { RecipeDraftsService } from './recipes/drafts/recipe-drafts.service';

@Module({
  controllers: [
    ArticlesController,
    MachinesController,
    SuppliersController,
    MarketsController,
    ProductFamiliesController,
    // RecipeDraftsController AVANT RecipesController : sa route littérale
    // "catalog/recipes/drafts" doit être testée avant la route paramétrée
    // "catalog/recipes/:id" de RecipesController, sinon Express/Nest interprète
    // "drafts" comme un :id et le routage échoue (404 au lieu du bon contrôleur).
    RecipeDraftsController,
    RecipesController,
  ],
  providers: [
    ArticlesService,
    MachinesService,
    SuppliersService,
    MarketsService,
    ProductFamiliesService,
    RecipesService,
    RecipeDraftsService,
  ],
})
export class CatalogModule {}
