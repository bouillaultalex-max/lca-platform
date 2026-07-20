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
import { ArticlesImportService } from './articles-import.service';
import { PreviewImportDto } from '../dto/preview-import.dto';
import { ConfirmArticlesImportDto } from './dto/confirm-articles-import.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import {
  ArticlesImportConfirmResult,
  ArticlesImportPreviewResult,
} from './articles-import.types';
import { IMPORT_FILE_UPLOAD_OPTIONS } from '../import-file-upload.options';
import { ImportFileValidationService } from '../import-file-validation.service';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des imports (voir docs/regles-metier.md §1).
 */
@ApiTags('import-export/articles')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('import-export/articles')
export class ArticlesImportController {
  constructor(
    private readonly articlesImportService: ArticlesImportService,
    private readonly importFileValidationService: ImportFileValidationService,
  ) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Prévisualise un import Articles OpenSi : mapping des colonnes, créations/mises à jour proposées, erreurs ligne par ligne. Aucune écriture en base hormis le journal.',
  })
  @UseInterceptors(FileInterceptor('file', IMPORT_FILE_UPLOAD_OPTIONS))
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewImportDto,
  ): Promise<ArticlesImportPreviewResult> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    await this.importFileValidationService.validate(file);
    return this.articlesImportService.preview(
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
      'Confirme un import Articles précédemment prévisualisé : revalide intégralement côté serveur puis écrit en une transaction.',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmArticlesImportDto,
  ): Promise<ArticlesImportConfirmResult> {
    return this.articlesImportService.confirm(user.siteId, user.id, dto);
  }
}
