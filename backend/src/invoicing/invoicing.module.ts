import { Module } from '@nestjs/common';
import { InvoicePdfService } from './invoice-pdf.service';

@Module({
  providers: [InvoicePdfService],
  exports: [InvoicePdfService],
})
export class InvoicingModule {}
