import { Injectable, Logger } from '@nestjs/common';
import type { ToolDefinition } from './tool.types';

/**
 * Registre des outils métier disponibles pour l'assistant. Volontairement vide
 * en AI-02 (aucun outil Stock/Production/Traceability/Dashboard/Imports —
 * voir docs/roadmap.md) : cette classe ne fait qu'exister, pour que l'ajout du
 * premier outil réel (AI-03) n'exige aucune modification de l'orchestrateur
 * (`AssistantService`) ni du contrôleur.
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Un outil nommé "${tool.name}" est déjà enregistré.`);
    }
    this.tools.set(tool.name, tool);
    this.logger.log(`Outil enregistré : ${tool.name}`);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}
