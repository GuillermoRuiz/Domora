import { IsIn } from 'class-validator';

const RESOLUTIONS = ['contacted', 'dismissed'] as const;

export class ResolveEstateOnboardingRequestDto {
  @IsIn(RESOLUTIONS)
  status!: (typeof RESOLUTIONS)[number];
}
