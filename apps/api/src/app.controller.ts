import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService, HealthStatus } from './app.service';
import { Public } from './auth/public.decorator';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get('health')
  @ApiOperation({
    summary: "Vérifie que l'API et la connexion PostgreSQL fonctionnent.",
  })
  getHealth(): Promise<HealthStatus> {
    return this.appService.getHealth();
  }
}
