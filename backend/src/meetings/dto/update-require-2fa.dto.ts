import { IsBoolean } from 'class-validator';

export class UpdateRequire2faDto {
  @IsBoolean()
  require2faForVoting!: boolean;
}
