import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { ToolRegistryService } from './tool-registry.service';
import { assertToolPermission } from './permission.util';
import { validateToolInput } from './validate-tool-input.util';

/**
 * Point de passage unique pour exécuter un outil métier (AI-03) : recherche
 * dans le registre, vérification des permissions (mêmes règles que les
 * endpoints HTTP existants, voir permission.util.ts), validation de l'entrée
 * (même discipline que le ValidationPipe global, voir validate-tool-input.util.ts),
 * puis appel du handler. Journalise uniquement l'utilisateur, le nom de
 * l'outil, la durée et le succès/échec — jamais la réponse produite, jamais
 * les données métier renvoyées (voir AI-03 : « ne jamais journaliser de
 * réponse complète, de donnée métier ou de payload »).
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async execute(
    user: AuthenticatedUser,
    toolName: string,
    rawInput: unknown,
  ): Promise<unknown> {
    const startedAt = Date.now();
    try {
      const tool = this.toolRegistry.get(toolName);
      if (!tool) {
        throw new NotFoundException(`Outil "${toolName}" introuvable.`);
      }

      assertToolPermission(tool.permission, user);
      const input = await validateToolInput(tool.inputSchema, rawInput);
      const result = await tool.handler(user, input);

      this.logOutcome(user, toolName, startedAt, true);
      return result;
    } catch (err) {
      this.logOutcome(user, toolName, startedAt, false);
      throw err;
    }
  }

  private logOutcome(
    user: AuthenticatedUser,
    toolName: string,
    startedAt: number,
    success: boolean,
  ): void {
    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `Outil exécuté : ${JSON.stringify({
        userId: user.id,
        tool: toolName,
        durationMs,
        success,
      })}`,
    );
  }
}
