import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreatedUserResult,
  UserAdminService,
  UserAdminView,
} from './user-admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../current-user.decorator';
import { RequireSystemAdmin } from '../require-system-admin.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Administration des comptes utilisateurs — réservée aux administrateurs système
 * (voir décision Jalon 2.5 : `isSystemAdmin` orthogonal au rôle métier `role`).
 */
@ApiTags('auth/users')
@ApiBearerAuth()
@RequireSystemAdmin()
@Controller('auth/users')
export class UserAdminController {
  constructor(private readonly userAdminService: UserAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Liste les comptes utilisateurs du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<UserAdminView[]> {
    return this.userAdminService.findAll(user.siteId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Crée un compte utilisateur avec un mot de passe temporaire (changement obligatoire à la première connexion).',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUserDto,
  ): Promise<CreatedUserResult> {
    return this.userAdminService.create(user.siteId, dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifie un compte utilisateur existant.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserAdminView> {
    return this.userAdminService.update(user.siteId, id, dto, user.id);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive un compte (l'utilisateur ne peut plus se connecter, aucune suppression physique).",
  })
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserAdminView> {
    return this.userAdminService.deactivate(user.siteId, id, user.id);
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Réactive un compte désactivé.' })
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserAdminView> {
    return this.userAdminService.reactivate(user.siteId, id, user.id);
  }

  @Post(':id/reset-password')
  @ApiOperation({
    summary:
      'Réinitialise le mot de passe (nouveau mot de passe temporaire, changement obligatoire au prochain login).',
  })
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ temporaryPassword: string }> {
    return this.userAdminService.resetPassword(user.siteId, id, user.id);
  }
}
