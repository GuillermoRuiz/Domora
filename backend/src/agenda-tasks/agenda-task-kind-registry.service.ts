import { BadRequestException, Injectable } from '@nestjs/common';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import type { DtoClass, TaskKindDefinition } from './agenda-task-kind.types';

/** Valida `data` contra un DTO: sin campos de más, tipos exactos. Devuelve el objeto limpio. */
export function validateDto<T extends object>(
  cls: DtoClass<T>,
  data: unknown,
  label: string,
): T {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new BadRequestException(`${label}: se esperaba un objeto.`);
  }
  const instance = plainToInstance(cls, data);
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new BadRequestException(`${label}: ${describe(errors)}`);
  }
  return instanceToPlain(instance) as T;
}

function describe(errors: ValidationError[]): string {
  return errors
    .flatMap((e) =>
      e.constraints
        ? Object.values(e.constraints)
        : describe(e.children ?? []).split('; '),
    )
    .join('; ');
}

/**
 * Catálogo de tipos de tarea humana. Vive en el módulo de la agenda pero no
 * conoce ninguno: los módulos de dominio (incidencias, juntas…) registran los
 * suyos al arrancar, así que la agenda no depende de ellos. Un tipo sin
 * registrar no se puede abrir ni resolver.
 */
@Injectable()
export class AgendaTaskKindRegistry {
  private readonly kinds = new Map<string, TaskKindDefinition>();

  register<P extends object, R extends object, Ref extends object>(
    definition: TaskKindDefinition<P, R, Ref>,
  ): void {
    if (this.kinds.has(definition.kind)) {
      throw new Error(`Tipo de tarea duplicado: ${definition.kind}.`);
    }
    this.kinds.set(definition.kind, definition);
  }

  has(kind: string): boolean {
    return this.kinds.has(kind);
  }

  get(kind: string): TaskKindDefinition {
    const definition = this.kinds.get(kind);
    if (!definition) {
      throw new BadRequestException(`Tipo de tarea desconocido: ${kind}.`);
    }
    return definition;
  }

  validatePayload(kind: string, data: unknown): object {
    return validateDto(this.get(kind).payload, data, `payload de ${kind}`);
  }

  validateResolution(kind: string, data: unknown): object {
    return validateDto(
      this.get(kind).resolution,
      data,
      `resolución de ${kind}`,
    );
  }

  validateResultRef(kind: string, data: unknown): object {
    return validateDto(this.get(kind).resultRef, data, `resultRef de ${kind}`);
  }
}
