import { IsEmail, IsIn } from 'class-validator';

/** Firma de quien está conectado: no lleva email, firma él mismo. */
export class SignActaAsSelfDto {
  @IsIn(['presidente', 'secretario'])
  role!: 'presidente' | 'secretario';
}

export class SignActaDto {
  @IsIn(['presidente', 'secretario'])
  role!: 'presidente' | 'secretario';

  /**
   * La gestora ELIGE qué `User` firma cada rol por su email — `Meeting.signerRole`/
   * `signerName` son texto libre de la convocatoria, sin FK a un `User`, así
   * que no hay forma de inferirlo automáticamente. Resuelto por email (no
   * por selector de directorio), mismo criterio que `representativeEmail`
   * en `CreateVoteDelegationDto` — evita exponer el directorio completo de
   * la finca solo para elegir dos firmantes.
   */
  @IsEmail()
  signerEmail!: string;
}
