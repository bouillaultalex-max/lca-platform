import { Module } from '@nestjs/common';
import { ArticlesController } from './articles/articles.controller';
import { ArticlesService } from './articles/articles.service';
import { MachinesController } from './machines/machines.controller';
import { MachinesService } from './machines/machines.service';
import { RecipesController } from './recipes/recipes.controller';
import { RecipesService } from './recipes/recipes.service';

@Module({
  controllers: [ArticlesController, MachinesController, RecipesController],
  providers: [ArticlesService, MachinesService, RecipesService],
})
export class CatalogModule {}
