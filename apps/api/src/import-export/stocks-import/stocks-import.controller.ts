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
import { StocksImportService } from './stocks-import.service';
import { PreviewImportDto } from '../dto/preview-import.dto';
import { ConfirmStocksImportDto } from './dto/confirm-stocks-import.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import {
  StocksImportConfirmResult,
  StocksImportPreviewResult,
} from './stocks-import.types';
import { IMPORT_FILE_UPLOAD_OPTIONS } from '../import-file-upload.options';
import { ImportFileValidationService } from '../import-file-validation.service';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des imports (voir docs/regles-metier.md §1).
 */
@ApiTags('import-export/stocks')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('import-export/stocks')
export class StocksImportController {
  constructor(
    private readonly stocksImportService: StocksImportService,
    private readonly importFileValidationService: ImportFileValidationService,
  ) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Prévisualise un import Stocks OpenSi : mapping des colonnes, réceptions proposées, avertissements de doublon, erreurs ligne par ligne. Aucune écriture en base hormis le journal.',
  })
  @UseInterceptors(FileInterceptor('file', IMPORT_FILE_UPLOAD_OPTIONS))
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewImportDto,
  ): Promise<StocksImportPreviewResult> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    await this.importFileValidationService.validate(file);
    return this.stocksImportService.preview(
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
      'Confirme un import Stocks précédemment prévisualisé : revalide intégralement côté serveur puis réceptionne chaque ligne retenue en une transaction.',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmStocksImportDto,
  ): Promise<StocksImportConfirmResult> {
    return this.stocksImportService.confirm(user.siteId, user.id, dto);
  }
}
