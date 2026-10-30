import { IsIn } from 'class-validator';
import type { MeetingStatus } from '../../prisma/client';

/**
 * Solo los dos estados terminales: `convocada` es el estado inicial (lo
 * fija el alta) y nunca se vuelve a él — por eso no se acepta aquí.
 */
const CLOSING_STATUSES: MeetingStatus[] = ['celebrada', 'cancelada'];

export class UpdateMeetingStatusDto {
  @IsIn(CLOSING_STATUSES)
  status!: Extract<MeetingStatus, 'celebrada' | 'cancelada'>;
}
