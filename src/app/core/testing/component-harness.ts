import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, type Routes } from '@angular/router';
import { AuthService, type AuthenticatedUser } from '../auth.service';

export { API, makeUser } from './data-service-harness';

/**
 * Harness compartido para probar componentes con render real
 * (`TestBed.createComponent` + `fixture.detectChanges()`), en paralelo al
 * de los servicios de dominio de `core/`. Ninguno se mockea a propósito:
 * siguen siendo los reales, así que sus peticiones caen en
 * `HttpTestingController` igual que en los tests de servicio.
 *
 * `AuthService` se mockea por defecto (lo que un componente no debería
 * tener que resolver de verdad) — pero para el flujo de autenticación en
 * sí (login/registro/invitaciones) hace falta lo contrario: `opts.realAuth`
 * deja el `AuthService` real, con sus propias peticiones cayendo también
 * en `HttpTestingController`. `AuthService` ya tiene su batería de tests
 * directos (auth.service.spec.ts); acá se prueba que el COMPONENTE lo use
 * bien, no que el servicio funcione.
 *
 * Zoneless (sin zone.js): `fixture.detectChanges()` NO se dispara solo al
 * cambiar una señal. Hay que llamarlo a mano tras cada acción que cambie
 * estado — o usar `fixture.autoDetectChanges()` una vez al principio del
 * test si se prefiere no repetirlo.
 *
 * ⚠️ Formularios con [(ngModel)]: entre el PRIMER `detectChanges()` y
 * cualquier simulación de escritura (`typeInto`/eventos de `input`), hace
 * falta que pase un tick real. Confirmado con un repro mínimo ajeno a
 * cualquier componente de la app: en este runner (zoneless + Vitest +
 * jsdom), si `setupComponent()` + `detectChanges()` se llaman DIRECTO
 * dentro del cuerpo de un `it()` sin ningún `await` de por medio, el
 * registro de FormsModule queda a medio asentar y los eventos `input`
 * posteriores no le llegan a `NgModel` — pase lo que pase con
 * `TestBed.tick()` o `fixture.autoDetectChanges()` después, no alcanza.
 * Con `beforeEach()` el problema no aparece (el propio ciclo de hooks de
 * Vitest ya da ese respiro entre medio). Si hace falta armar la fixture a
 * mano dentro de cada test (p. ej. porque cada uno necesita
 * `ActivatedRoute`/query params distintos), agregar un
 * `await settle()` justo después del primer `detectChanges()`, ANTES de
 * tocar cualquier campo del formulario — ver login.component.spec.ts.
 */
export interface ComponentHarness<T> {
  fixture: import('@angular/core/testing').ComponentFixture<T>;
  component: T;
  http: HttpTestingController;
  auth: AuthService;
  readonly el: HTMLElement;
  /** No-op si se usó `realAuth: true` — el usuario real lo fija el propio AuthService al hacer login/etc. */
  setCurrentUser: (user: AuthenticatedUser | null) => void;
}

type SetupOpts = { user?: AuthenticatedUser | null; realAuth?: boolean; providers?: unknown[]; routes?: Routes };

/**
 * Variante asíncrona de `setupComponent` para componentes con bloques
 * `@defer` (p. ej. la sala de espera de las juntas, que carga el embed de
 * Jitsi diferido): en ellos `TestBed` exige `await TestBed.compileComponents()`
 * ANTES de `createComponent`, y `setupComponent` crea el componente de forma
 * síncrona, así que no puede intercalarlo. Misma configuración, mismo
 * resultado.
 */
export async function setupComponentAsync<T>(componentType: Type<T>, opts: SetupOpts = {}): Promise<ComponentHarness<T>> {
  return buildHarness(componentType, opts, true) as Promise<ComponentHarness<T>>;
}

export function setupComponent<T>(componentType: Type<T>, opts: SetupOpts = {}): ComponentHarness<T> {
  return buildHarness(componentType, opts, false) as ComponentHarness<T>;
}

function buildHarness<T>(
  componentType: Type<T>,
  opts: SetupOpts,
  compileFirst: boolean,
): ComponentHarness<T> | Promise<ComponentHarness<T>> {
  let currentUser = opts.user ?? null;
  TestBed.configureTestingModule({
    imports: [componentType],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter(opts.routes ?? []),
      ...(opts.realAuth
        ? []
        : [
            {
              provide: AuthService,
              useValue: {
                currentUser: () => currentUser,
                isAuthenticated: () => currentUser !== null,
                // Función plana, no `vi.fn`: este fichero también entra en el type-check de la app. Los specs que lo verifican hacen `vi.spyOn`.
                reloadSession: () => Promise.resolve(),
              },
            },
          ]),
      ...(opts.providers ?? []),
    ],
  });

  const create = (): ComponentHarness<T> => {
    const fixture = TestBed.createComponent(componentType);
    const http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(AuthService);

    return {
      fixture,
      component: fixture.componentInstance,
      http,
      auth,
      get el(): HTMLElement {
        return fixture.nativeElement as HTMLElement;
      },
      setCurrentUser: (user: AuthenticatedUser | null) => {
        currentUser = user;
      },
    };
  };

  return compileFirst ? TestBed.compileComponents().then(create) : create();
}

/** Deja pasar un tick real — para promesas encadenadas (ver el mismo gotcha en data-service-harness.ts). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/**
 * Simula tipear en un <input>/<textarea> ligado por [(ngModel)]: pone el
 * valor y dispara el evento `input` nativo.
 *
 * ⚠️ Confirmado con un repro mínimo (sin componentes de la app de por
 * medio): en este entorno de test (Vitest + jsdom, build zoneless) el
 * evento `input` nativo NO propaga a través de `DefaultValueAccessor` de
 * FormsModule — ni con `TestBed.tick()`, ni con `fixture.autoDetectChanges()`
 * después. Es una limitación del entorno, no un error de la app: la
 * dirección modelo→vista (`[ngModel]="campo"`, asignar `component.campo` y
 * llamar a `detectChanges()`) sí funciona, igual que cualquier otro
 * `[binding]` normal (ver btn.component.spec.ts). Para formularios con
 * `[(ngModel)]`, asignar el campo del componente DIRECTAMENTE en vez de
 * usar este helper — se deja acá por si una futura versión del runner lo
 * arregla, pero hoy no es fiable para ngModel.
 */
export function typeInto(el: HTMLElement, selector: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`typeInto: no se encontró "${selector}"`);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

/**
 * Envía un <form (ngSubmit)="..."> haciendo click en su botón submit — NO
 * disparando `form.dispatchEvent(new Event('submit'))` a mano. Ese Event
 * plano nace con `cancelable: false`, así que si el manejador de Angular
 * llama a `preventDefault()` no hace nada: jsdom sigue con la navegación
 * por defecto del formulario ("Not implemented: navigation to another
 * Document") y el submit real puede no llegar a dispararse. Un click de
 * verdad sobre el botón usa el algoritmo de envío nativo del navegador,
 * que sí genera un evento cancelable de forma correcta.
 */
export function submitForm(el: HTMLElement, formSelector = 'form'): void {
  const button = el.querySelector<HTMLButtonElement>(`${formSelector} button[type="submit"]`);
  if (!button) throw new Error(`submitForm: no se encontró un submit dentro de "${formSelector}"`);
  button.click();
}
