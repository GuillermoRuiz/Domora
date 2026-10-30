import { Module } from '@nestjs/common';
import { VerifactuService } from './verifactu.service';
import { VerifactuSoapClient } from './verifactu-soap.client';
import { VerifactuSubmissionService } from './verifactu-submission.service';

@Module({
  providers: [
    VerifactuService,
    VerifactuSoapClient,
    VerifactuSubmissionService,
  ],
  exports: [VerifactuService, VerifactuSubmissionService],
})
export class VerifactuModule {}
