import { Component, input, output } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AccountingEstate } from '../../../core/models';
import { AccountingFacadeThumbnailComponent } from './accounting-facade-thumbnail.component';

export type AccountingSortColumn =
  | 'name'
  | 'balance'
  | 'reserve'
  | 'delinquency';

@Component({
  selector: 'app-accounting-overview-views',
  standalone: true,
  imports: [CurrencyPipe, AccountingFacadeThumbnailComponent],
  templateUrl: './accounting-overview-views.component.html',
  styleUrl: './accounting-overview-views.component.scss',
})
export class AccountingOverviewViewsComponent {
  readonly items = input.required<AccountingEstate[]>();
  readonly view = input<'table' | 'cards'>('table');
  readonly sortColumn = input<AccountingSortColumn>('name');
  readonly direction = input<'asc' | 'desc'>('asc');
  readonly sort = output<AccountingSortColumn>();
  readonly openEstate = output<AccountingEstate>();
  readonly columns: { id: AccountingSortColumn; label: string }[] = [
    { id: 'name', label: 'Comunidad' },
    { id: 'balance', label: 'Saldo actual' },
    { id: 'reserve', label: 'Fondo de reserva' },
    { id: 'delinquency', label: 'Morosidad' },
  ];

  address(estate: AccountingEstate): string {
    return (
      [
        [estate.address, estate.streetNumber].filter(Boolean).join(' '),
        estate.location,
      ]
        .filter(Boolean)
        .join(', ') || estate.type
    );
  }

  ariaSort(column: AccountingSortColumn): 'none' | 'ascending' | 'descending' {
    return this.sortColumn() !== column
      ? 'none'
      : this.direction() === 'asc'
        ? 'ascending'
        : 'descending';
  }
}
