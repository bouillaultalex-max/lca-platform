import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService, HealthStatus } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  const healthStatus: HealthStatus = {
    status: 'ok',
    database: 'connected',
    timestamp: '2026-07-05T00:00:00.000Z',
  };
  const appServiceMock = {
    getHealth: jest.fn().mockResolvedValue(healthStatus),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: appServiceMock }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('délègue à AppService.getHealth()', async () => {
      await expect(appController.getHealth()).resolves.toEqual(healthStatus);
    });
  });
});
