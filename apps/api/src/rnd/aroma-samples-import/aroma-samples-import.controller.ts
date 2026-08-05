import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AromaSamplesImportService } from './aroma-samples-import.service';
import { PreviewAromaSamplesImportDto } from './dto/preview-aroma-samples-import.dto';
import { ConfirmAromaSamplesImportDto } from './dto/confirm-aroma-samples-import.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import {
  AromaSamplesImportConfirmResult,
  AromaSamplesImportPreviewResult,
} from './aroma-samples-import.types';
import { IMPORT_FILE_UPLOAD_OPTIONS } from '../../import-export/import-file-upload.options';
import { ImportFileValidationService } from '../../import-export/import-file-validation.service';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des imports (voir docs/regles-metier.md
 * §1) : `@Roles(...FULL_ACCESS_ROLES)` restreint l'accès à
 * RESPONSABLE_LABORATOIRE/RESPONSABLE_ADJOINT. `siteId`/`userId` viennent toujours de
 * `@CurrentUser()` (JWT), jamais du corps de la requête — aucun des deux DTO ne porte
 * ces champs (voir RD-01C-3). Toute la logique métier (parsing, classification,
 * empreinte, transaction) reste dans `AromaSamplesImportService` ; ce contrôleur ne
 * fait que router et retourner le résultat du service tel quel.
 */
@ApiTags('rnd/aroma-samples-import')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('rnd/aroma-samples/import')
export class AromaSamplesImportController {
  constructor(
    private readonly aromaSamplesImportService: AromaSamplesImportService,
    private readonly importFileValidationService: ImportFileValidationService,
  ) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Prévisualise un import Aromathèque : mapping des colonnes, classification création/mise à jour/inchangé, avertissements de doublon potentiel, erreurs ligne par ligne. Aucune écriture en base hormis le journal (empreinte previewHash comprise).',
  })
  @ApiResponse({ status: 200, description: 'Résultat de la prévisualisation.' })
  @ApiResponse({
    status: 400,
    description:
      'Fichier absent, illisible, de format non supporté, ou contenu ne correspondant pas au format déclaré.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Rôle insuffisant (réservé à RESPONSABLE_LABORATOIRE / RESPONSABLE_ADJOINT).',
  })
  @UseInterceptors(FileInterceptor('file', IMPORT_FILE_UPLOAD_OPTIONS))
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewAromaSamplesImportDto,
  ): Promise<AromaSamplesImportPreviewResult> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    await this.importFileValidationService.validate(file);
    return this.aromaSamplesImportService.preview(
      user.siteId,
      user.id,
      file,
      dto.mappingCorrections ?? [],
    );
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirme un import Aromathèque précédemment prévisualisé : revalide intégralement côté serveur, vérifie l’empreinte previewHash, reclassifie contre l’état actuel de la base, puis écrit en une transaction.',
  })
  @ApiResponse({ status: 200, description: 'Résultat de la confirmation.' })
  @ApiResponse({
    status: 400,
    description:
      'Import introuvable pour ce site, déjà confirmé, empreinte absente, ou lignes soumises altérées par rapport à la prévisualisation.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Rôle insuffisant (réservé à RESPONSABLE_LABORATOIRE / RESPONSABLE_ADJOINT).',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmAromaSamplesImportDto,
  ): Promise<AromaSamplesImportConfirmResult> {
    return this.aromaSamplesImportService.confirm(user.siteId, user.id, dto);
  }
}
