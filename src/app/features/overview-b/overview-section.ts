import { signal } from '@angular/core';

/**
 * Estado de carga de una sección de la vista general. Cada sección pide lo suyo de forma
 * independiente: si una falla, las demás se siguen viendo. Una respuesta tardía de una
 * selección anterior se descarta (gana siempre la última petición).
 */
export class OverviewSection<T> {
  readonly data = signal<T | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);
  private latest = 0;

  constructor(private readonly fetch: (estateId: string | null) => Promise<T>) {}

  async load(estateId: string | null): Promise<void> {
    const request = ++this.latest;
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await this.fetch(estateId);
      if (request === this.latest) this.data.set(result);
    } catch (error) {
      console.error('Error cargando una sección de la vista general', error);
      if (request === this.latest) this.error.set(true);
    } finally {
      if (request === this.latest) this.loading.set(false);
    }
  }
}
