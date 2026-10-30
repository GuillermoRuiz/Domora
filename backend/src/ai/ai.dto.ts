import { IsUUID } from 'class-validator';

export class InvoiceLinkDto {
  @IsUUID() invoiceId!: string;
}
