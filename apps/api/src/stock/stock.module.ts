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
  // StockFifoService sera injecté par le futur module `production` (Jalon 2/3)
  // pour la déduction de stock à la clôture d'un batch.
  exports: [StockFifoService],
})
export class StockModule {}
