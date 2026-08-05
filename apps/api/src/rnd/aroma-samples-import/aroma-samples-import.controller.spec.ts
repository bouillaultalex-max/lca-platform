import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AromaSamplesImportController } from './aroma-samples-import.controller';
import { AromaSamplesImportService } from './aroma-samples-import.service';
import { ImportFileValidationService } from '../../import-export/import-file-validation.service';
import { UserRole } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { ConfirmAromaSamplesImportDto } from './dto/confirm-aroma-samples-import.dto';
import { PreviewAromaSamplesImportDto } from './dto/preview-aroma-samples-import.dto';
import {
  AromaSamplesImportConfirmResult,
  AromaSamplesImportPreviewResult,
} from './aroma-samples-import.types';

/**
 * Vérifie uniquement le routage : `AromaSamplesImportService` et
 * `ImportFileValidationService` sont mockés (même patron que
 * `app.controller.spec.ts`, seul précédent de test de contrôleur du projet). Les
 * guards (`JwtAuthGuard`, `RolesGuard`...) sont enregistrés globalement (voir
 * `AuthModule`) et testés séparément (`roles.guard.spec.ts`) — appeler les méthodes
 * du contrôleur directement ne les traverse pas, ce qui est le comportement attendu
 * ici : on ne teste que la délégation vers le service, jamais l'autorisation.
 */
describe('AromaSamplesImportController', () => {
  let controller: AromaSamplesImportController;
  let service: { preview: jest.Mock; confirm: jest.Mock };
  let importFileValidationService: { validate: jest.Mock };

  const user: AuthenticatedUser = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Alex Bouillault',
    email: 'alex@example.test',
    role: UserRole.RESPONSABLE_ADJOINT,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
  };

  const file = (): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake'),
      originalname: 'aromatheque.xlsx',
    }) as Express.Multer.File;

  beforeEach(async () => {
    service = {
      preview: jest.fn(),
      confirm: jest.fn(),
    };
    importFileValidationService = {
      validate: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AromaSamplesImportController],
      providers: [
        { provide: AromaSamplesImportService, useValue: service },
        {
          provide: ImportFileValidationService,
          useValue: importFileValidationService,
        },
      ],
    }).compile();

    controller = module.get(AromaSamplesImportController);
  });

  describe('preview', () => {
    it('appelle AromaSamplesImportService.preview avec le fichier et les corrections de mapping', async () => {
      const previewResult: AromaSamplesImportPreviewResult = {
        importLogId: 'import-log-1',
        mapping: {
          fields: [],
          ignoredColumns: [],
          missingRequiredFields: [],
          hints: [],
        },
        mappingComplete: true,
        rows: [],
        toCreate: 0,
        toUpdate: 0,
        unchanged: 0,
        warnings: [],
        errors: [],
      };
      service.preview.mockResolvedValue(previewResult);
      const dto: PreviewAromaSamplesImportDto = {
        mappingCorrections: [{ fieldKey: 'legacyId', columnName: 'EF-0378' }],
      };
      const uploadedFile = file();

      const result = await controller.preview(user, uploadedFile, dto);

      expect(service.preview).toHaveBeenCalledTimes(1);
      expect(service.preview).toHaveBeenCalledWith(
        'site-1',
        'user-1',
        uploadedFile,
        dto.mappingCorrections,
      );
      // Aucune transformation métier : le contrôleur retourne exactement ce que le
      // service a renvoyé.
      expect(result).toBe(previewResult);
    });

    it('prend siteId depuis le contexte utilisateur authentifié, jamais du corps de la requête', async () => {
      service.preview.mockResolvedValue({
        importLogId: 'import-log-1',
        mapping: {
          fields: [],
          ignoredColumns: [],
          missingRequiredFields: [],
          hints: [],
        },
        mappingComplete: false,
      });

      await controller.preview(user, file(), {});

      const [siteIdArg] = service.preview.mock.calls[0] as [string];
      expect(siteIdArg).toBe(user.siteId);
    });

    it('prend userId depuis le contexte utilisateur authentifié, jamais du corps de la requête', async () => {
      service.preview.mockResolvedValue({
        importLogId: 'import-log-1',
        mapping: {
          fields: [],
          ignoredColumns: [],
          missingRequiredFields: [],
          hints: [],
        },
        mappingComplete: false,
      });

      await controller.preview(user, file(), {});

      const [, userIdArg] = service.preview.mock.calls[0] as [string, string];
      expect(userIdArg).toBe(user.id);
    });

    it("passe un tableau vide de corrections de mapping quand aucune n'est fournie", async () => {
      service.preview.mockResolvedValue({
        importLogId: 'import-log-1',
        mapping: {
          fields: [],
          ignoredColumns: [],
          missingRequiredFields: [],
          hints: [],
        },
        mappingComplete: false,
      });

      await controller.preview(user, file(), {});

      expect(service.preview).toHaveBeenCalledWith(
        'site-1',
        'user-1',
        expect.anything(),
        [],
      );
    });

    it('valide le contenu réel du fichier avant tout appel au service', async () => {
      service.preview.mockResolvedValue({
        importLogId: 'import-log-1',
        mapping: {
          fields: [],
          ignoredColumns: [],
          missingRequiredFields: [],
          hints: [],
        },
        mappingComplete: false,
      });
      const calls: string[] = [];
      importFileValidationService.validate.mockImplementation(() => {
        calls.push('validate');
        return Promise.resolve();
      });
      service.preview.mockImplementation(() => {
        calls.push('preview');
        return Promise.resolve({
          importLogId: 'import-log-1',
          mapping: {
            fields: [],
            ignoredColumns: [],
            missingRequiredFields: [],
            hints: [],
          },
          mappingComplete: false,
        });
      });

      await controller.preview(user, file(), {});

      expect(calls).toEqual(['validate', 'preview']);
    });

    it("lève BadRequestException et n'appelle ni la validation ni le service quand aucun fichier n'est reçu", async () => {
      await expect(
        controller.preview(
          user,
          undefined as unknown as Express.Multer.File,
          {},
        ),
      ).rejects.toThrow(BadRequestException);

      expect(importFileValidationService.validate).not.toHaveBeenCalled();
      expect(service.preview).not.toHaveBeenCalled();
    });

    it('propage sans la modifier une erreur levée par le service', async () => {
      const error = new BadRequestException('Le fichier envoyé est vide.');
      service.preview.mockRejectedValue(error);

      await expect(controller.preview(user, file(), {})).rejects.toBe(error);
    });

    it('propage sans la modifier une erreur levée par la validation du fichier', async () => {
      const error = new BadRequestException(
        'Le contenu du fichier ne correspond pas à un fichier Excel (.xlsx) valide.',
      );
      importFileValidationService.validate.mockRejectedValue(error);

      await expect(controller.preview(user, file(), {})).rejects.toBe(error);
      expect(service.preview).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    const dto: ConfirmAromaSamplesImportDto = {
      importLogId: 'import-log-1',
      rows: [
        {
          line: 2,
          legacyId: 'EF-0378-001',
          supplierNameRaw: 'Fournisseur X',
          productName: 'Vanille Bourbon',
          category: 'Vanille',
        },
      ],
    };

    it('appelle AromaSamplesImportService.confirm avec siteId/userId du contexte et le DTO reçu', async () => {
      const confirmResult: AromaSamplesImportConfirmResult = {
        importLogId: 'import-log-1',
        created: 1,
        updated: 0,
        unchanged: 0,
        errors: [],
      };
      service.confirm.mockResolvedValue(confirmResult);

      const result = await controller.confirm(user, dto);

      expect(service.confirm).toHaveBeenCalledTimes(1);
      expect(service.confirm).toHaveBeenCalledWith('site-1', 'user-1', dto);
      // Aucune transformation métier : le contrôleur retourne exactement ce que le
      // service a renvoyé (pas de recalcul de hash, pas d'écriture Prisma directe).
      expect(result).toBe(confirmResult);
    });

    it('propage sans la modifier une erreur levée par le service', async () => {
      const error = new BadRequestException(
        'Les lignes soumises ne correspondent plus à la prévisualisation.',
      );
      service.confirm.mockRejectedValue(error);

      await expect(controller.confirm(user, dto)).rejects.toBe(error);
    });
  });
});
