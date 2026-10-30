import { Injectable, computed, inject } from '@angular/core';
import { Role } from './models';
import { AuthService } from './auth.service';
import { DespachoContextService } from './despacho-context.service';

/**
 * TenantContextService
 *
 * Centraliza la identidad del tenant (gestora administradora) del usuario en
 * sesión. Desde la Fase 11 el tenant se DERIVA de la sesión autenticada
 * (AuthService.currentUser().administratorId) — el enforcement real es
 * server-side (el backend filtra por el JWT); este servicio solo evita que la
 * capa de presentación cruce tenants por error (guards de ruta, etc.).
 */
@Injectable({ providedIn: 'root' })
export class TenantContextService {
  private auth = inject(AuthService);
  private despacho = inject(DespachoContextService);

  /**
   * Id del tenant (gestora) activo — derivado de la sesión.
   * - Rol B → administratorId del usuario autenticado.
   * - Rol A → el despacho elegido en DespachoContextService, o null si no hay ninguno.
   * - Rol C → null (el backend acota por membresías del usuario).
   */
  currentAdministratorId = computed<string | null>(() => {
    const user = this.auth.currentUser();
    if (user?.role === 'A') return this.despacho.selected()?.id ?? null;
    return user?.administratorId ?? null;
  });

  /**
   * Filtro `?administratorId=` para las listas de fincas (`GET /estates`, `/estates/overview` y su
   * exportación): solo el rol A con un despacho elegido lo envía. B y C nunca — el backend ya los
   * acota por su sesión.
   */
  estateListFilter(): { administratorId?: string } {
    if (this.auth.currentUser()?.role !== 'A') return {};
    const id = this.despacho.selected()?.id;
    return id ? { administratorId: id } : {};
  }

  /** Fincas accesibles para el usuario en sesión, según el JWT. */
  accessibleEstateIds = computed<string[]>(
    () => this.auth.currentUser()?.estateIds ?? [],
  );

  /**
   * Verifica que un recurso pertenece al tenant activo. El backend ya aplica
   * el filtrado real; aquí solo se comprueba coherencia de UI.
   */
  canAccess(resourceAdministratorId: string | null | undefined): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (user.role === 'A') return true;
    if (resourceAdministratorId == null) return true;
    const current = this.currentAdministratorId();
    // Rol C: sin tenant propio — el backend acota por membresías.
    if (current === null) return true;
    return current === resourceAdministratorId;
  }

  /** Igual que canAccess pero lanza si está denegado. */
  assertAccess(resourceAdministratorId: string | null | undefined, resourceLabel: string): void {
    if (!this.canAccess(resourceAdministratorId)) {
      throw new TenantAccessDeniedError(
        `Acceso denegado a ${resourceLabel}: pertenece a otro tenant.`,
      );
    }
  }

  /** ¿Puede el usuario en sesión ver esta finca? (según estateIds del JWT). */
  canAccessEstate(estateId: string): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (user.role === 'A') return true;
    return this.accessibleEstateIds().includes(estateId);
  }

  /**
   * No-op de compatibilidad: el tenant ya se deriva de la sesión autenticada,
   * no se "bootstrapea" desde el rol.
   */
  bootstrapFromRole(_role: Role): void {
    // Intencionadamente vacío — el tenant es un computed sobre AuthService.
  }
}

/**
 * Error lanzado cuando un componente intenta acceder a un recurso fuera del
 * tenant activo. Capturado por el guard de ruta.
 */
export class TenantAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantAccessDeniedError';
  }
}
