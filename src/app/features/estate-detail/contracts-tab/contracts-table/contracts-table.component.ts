import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import type { EstateContract } from '../../../../core/models';
import { AvatarComponent } from '../../../../shared/components/avatar/avatar.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { StatusPillComponent } from '../../../../shared/components/status-pill/status-pill.component';
import {
  RENEWAL_LABEL, STATUS_PILL, amountText, canCancel, canEdit, canRenew, categoryColor, contractAlert, formatDate, type AlertTone,
} from '../contracts-model';

interface RowView {
  contract: EstateContract;
  start: string;
  end: string;
  /** Tono del vencimiento: rojo/ámbar cuando se acerca, neutro el resto. */
  endTone: AlertTone;
  renewal: string;
  amount: { main: string; sub: string | null };
  pill: { text: string; tone: 'positive' | 'warning' | 'danger' | 'neutral' };
  alert: { text: string; tone: AlertTone };
  color: string;
  cancelled: boolean;
}

/**
 * Tabla de contratos del panel (columnas del mockup): contrato y categoría, proveedor con iniciales,
 * inicio, vencimiento, renovación, importe anual y mensual, estado, alerta y acción. En pantallas
 * estrechas cada fila pasa a ser una tarjeta (cada celda lleva su `data-label`).
 */
@Component({
  selector: 'app-contracts-table',
  standalone: true,
  imports: [AvatarComponent, IconComponent, StatusPillComponent],
  templateUrl: './contracts-table.component.html',
  styleUrl: './contracts-table.component.scss',
})
export class ContractsTableComponent {
  readonly contracts = input.required<EstateContract[]>();
  /** «Ver»: abre el detalle del contrato. */
  readonly view = output<EstateContract>();
  /** Acciones del menú «⋯» (D1). */
  readonly edit = output<EstateContract>();
  readonly renew = output<EstateContract>();
  readonly cancel = output<EstateContract>();
  readonly openSupplier = output<EstateContract>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Contrato con el menú abierto y dónde pintarlo (fijo, para que el scroll de la tabla no lo recorte). */
  readonly menu = signal<{ contract: EstateContract; top: number; left: number } | null>(null);
  readonly menuItems = computed(() => {
    const c = this.menu()?.contract;
    if (!c) return [];
    return [
      ...(canEdit(c) ? [{ id: 'edit', label: 'Editar' }] : []),
      ...(canRenew(c) ? [{ id: 'renew', label: 'Renovar' }] : []),
      ...(canCancel(c) ? [{ id: 'cancel', label: 'Cancelar contrato', danger: true }] : []),
      { id: 'supplier', label: 'Ver proveedor' },
    ] as { id: 'edit' | 'renew' | 'cancel' | 'supplier'; label: string; danger?: boolean }[];
  });

  toggleMenu(contract: EstateContract, event: MouseEvent): void {
    event.stopPropagation();
    if (this.menu()?.contract.id === contract.id) {
      this.menu.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Alineado a la derecha del botón; si no cabe debajo, se abre hacia arriba.
    const height = 4 * 40 + 12;
    const top = rect.bottom + height > window.innerHeight ? Math.max(8, rect.top - height) : rect.bottom + 4;
    this.menu.set({ contract, top, left: Math.max(8, rect.right - 200) });
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLButtonElement>('.menu button')?.focus());
  }

  choose(item: 'edit' | 'renew' | 'cancel' | 'supplier'): void {
    const contract = this.menu()?.contract;
    this.menu.set(null);
    if (!contract) return;
    if (item === 'edit') this.edit.emit(contract);
    else if (item === 'renew') this.renew.emit(contract);
    else if (item === 'cancel') this.cancel.emit(contract);
    else this.openSupplier.emit(contract);
  }

  onMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.menu button'));
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(event.target as HTMLButtonElement);
    const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  }

  @HostListener('document:click') onOutside(): void { this.menu.set(null); }
  @HostListener('document:keydown.escape') onEscape(): void { this.menu.set(null); }
  @HostListener('window:resize') onResize(): void { this.menu.set(null); }

  readonly rows = computed<RowView[]>(() =>
    this.contracts().map((c) => {
      const alert = contractAlert(c);
      return {
        contract: c,
        start: formatDate(c.startDate),
        end: c.endDate ? formatDate(c.endDate) : 'Indefinido',
        endTone: c.status === 'Cancelado' ? 'neutral' : alert.tone,
        renewal: RENEWAL_LABEL[c.renewalType] ?? c.renewalType,
        amount: amountText(c),
        pill: STATUS_PILL[c.status],
        alert,
        color: categoryColor(c.supplier.category),
        cancelled: c.status === 'Cancelado',
      };
    }),
  );
}
