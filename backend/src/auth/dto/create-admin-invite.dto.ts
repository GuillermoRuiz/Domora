import { IsUUID } from 'class-validator';

export class CreateAdminInviteDto {
  @IsUUID()
  administratorId!: string;
}
