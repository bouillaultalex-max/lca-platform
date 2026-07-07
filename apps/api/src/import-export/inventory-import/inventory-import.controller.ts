import {
  BadRequestException,
  Body,
  Controller,
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
import { InventoryImportService } from './inventory-import.service';
import { PreviewImportDto } from '../dto/preview-import.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { InventoryImportPreviewResult } from './inventory-import.types';
import { IMPORT_FILE_UPLOAD_OPTIONS } from '../import-file-upload.options';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des imports (voir docs/regles-metier.md §1).
 * Import volontairement partiel : voir InventoryImportService.
 */
@ApiTags('import-export/inventory')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('import-export/inventory')
export class InventoryImportController {
  constructor(
    private readonly inventoryImportService: InventoryImportService,
  ) {}

  @Post('preview')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Prévisualise un import Inventaire OpenSi : mapping des colonnes et détection structurelle (lot fournisseur ou quantité globale). Aucune validation de contenu, aucune écriture hormis le journal.',
  })
  @UseInterceptors(FileInterceptor('file', IMPORT_FILE_UPLOAD_OPTIONS))
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PreviewImportDto,
  ): Promise<InventoryImportPreviewResult> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    return this.inventoryImportService.preview(
      user.siteId,
      user.id,
      file,
      dto.mappingCorrections ?? [],
    );
  }

  @Post('confirm')
  @ApiOperation({
    summary:
      "Non implémenté : en attente d'un fichier réel OpenSi pour définir la stratégie de réconciliation d'inventaire. Renvoie systématiquement 501, quel que soit le corps de la requête.",
  })
  confirm(): never {
    return this.inventoryImportService.confirm();
  }
}
