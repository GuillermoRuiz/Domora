import { IsIn } from 'class-validator';
import { IssueStatus } from '../../prisma/client';

const ISSUE_STATUSES: IssueStatus[] = [
  'Abierta',
  'EnReparacion',
  'PendienteProveedor',
  'Resuelta',
  'Cerrada',
];

export class UpdateIssueStatusDto {
  @IsIn(ISSUE_STATUSES)
  status!: IssueStatus;
}
