import { Module } from '@nestjs/common';
import { StockLotsController } from './stock-lots/stock-lots.controller';
import { StockLotsService } from './stock-lots/stock-lots.service';
import { StockItemsController } from './stock-items/stock-items.controller';
import { StockItemsService } from './stock-items/stock-items.service';
import { StockMovementsController } from './stock-movements/stock-movements.controller';
import { StockMovementsService } from './stock-movements/stock-movements.service';
import { StockFifoService } from './stock-fifo/stock-fifo.service';

@Module({
  controllers: [
    StockLotsController,
    StockItemsController,
    StockMovementsController,
  ],
  providers: [
    StockLotsService,
    StockItemsService,
    StockMovementsService,
    StockFifoService,
  ],
  // StockFifoService : injecté par `production` pour la déduction de stock à la
  // clôture d'un batch. StockLotsService : réutilisé par `import-export` (Import
  // Stocks) pour réceptionner chaque ligne valide via receive(), sans dupliquer
  // sa logique (voir docs/adr). StockItemsService : réutilisé par `assistant`
  // (outils stock.getArticleAvailability / stock.listLowStockItems, voir AI-03).
  exports: [StockFifoService, StockLotsService, StockItemsService],
})
export class StockModule {}
