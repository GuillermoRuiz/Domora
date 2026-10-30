import { IsIn } from 'class-validator';
import type { PlanTier } from '../../prisma/client';

const PLANS: PlanTier[] = ['BASE', 'STANDARD', 'PREMIUM'];

export class ChangePlanDto {
  @IsIn(PLANS)
  plan!: PlanTier;
}
