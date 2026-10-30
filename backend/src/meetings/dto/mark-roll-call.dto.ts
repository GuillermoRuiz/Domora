import { IsUUID } from 'class-validator';

/** Pase de lista presencial — la gestora marca quién asiste por qué propiedad. Solo A/B (ver `@Roles` en el controller). */
export class MarkRollCallDto {
  @IsUUID()
  propertyId!: string;

  @IsUUID()
  userId!: string;
}
