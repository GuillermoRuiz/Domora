/**
 * Carga perezosa del SDK público de Jitsi (`external_api.js`) — solo se
 * pide la primera vez que se entra efectivamente a una sala, nunca en el
 * bundle inicial del módulo de juntas (de ahí que `JitsiEmbedComponent`
 * viva detrás de un bloque `@defer`). La promesa se cachea a nivel de
 * módulo para que entrar/salir de varias salas en la misma sesión no
 * vuelva a inyectar el `<script>`.
 */

const SCRIPT_URL = 'https://meet.jit.si/external_api.js';

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (domain: string, options: Record<string, unknown>) => JitsiMeetExternalAPIInstance;
  }
}

export interface JitsiMeetExternalAPIInstance {
  addEventListener(event: string, handler: (...args: unknown[]) => void): void;
  dispose(): void;
}

let loadPromise: Promise<void> | null = null;

export function loadJitsiExternalApi(): Promise<void> {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null; // permite reintentar en la siguiente llamada
      reject(new Error('No se pudo cargar el SDK de Jitsi.'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
