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
  ApiTags,
} from '@nestjs/swagger';
import { ExpectedRequirementsImportService } from './expected-requirements-import.service';
import { PreviewImportDto } from '../dto/preview-import.dto';
import { ConfirmExpectedRequirementsImportDto } from './dto/confirm-expected-requirements-import.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import {
  ExpectedRequirementsImportConfirmResult,
  ExpectedRequirementsImportPreviewResult,
} from './expected-requirements-import.types';
import { IMPORT_FILE_UPLOAD_OPTIONS } from '../import-file-upload.options';
import { ImportFileValidationService } from '../import-file-validation.service';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des imports (voir docs/regles-metier.md §1).
 */
@ApiTags('import-export/expected-requirements')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('import-export/expected-requirements')
export class ExpectedRequirementsImportController {
  constructor(
    private readonly expectedRequirementsImportService: ExpectedRequirementsImportService,
    private readonly importFileValidationService: ImportFileValidationService,
  ) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Prévisualise un import Besoins attendus OpenSi : mapping des colonnes, besoins proposés, erreurs ligne par ligne. Aucune écriture en base hormis le journal.',
  })
  @UseInterceptors(FileInterceptor('file', IMPORT_FILE_UPLOAD_OPTIONS))
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewImportDto,
  ): Promise<ExpectedRequirementsImportPreviewResult> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    await this.importFileValidationService.validate(file);
    return this.expectedRequirementsImportService.preview(
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
      'Confirme un import Besoins attendus précédemment prévisualisé : revalide intégralement côté serveur puis ajoute chaque ligne retenue (jamais de mise à jour) en une transaction.',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmExpectedRequirementsImportDto,
  ): Promise<ExpectedRequirementsImportConfirmResult> {
    return this.expectedRequirementsImportService.confirm(
      user.siteId,
      user.id,
      dto,
    );
  }
}
