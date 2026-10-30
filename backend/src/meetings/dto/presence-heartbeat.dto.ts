import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Heartbeat de presencia — sustituye `channel.track()` de un canal realtime. */
export class PresenceHeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  floor?: string;
}
