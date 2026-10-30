import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, firstValueFrom, takeUntil } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Capa HTTP compartida por TODOS los servicios de dominio de `core/`
 * (por composición — se inyecta, no se extiende: no hay precedente de
 * herencia de servicios en este proyecto). Antes vivía duplicada como
 * métodos privados dentro de `DataService`; se extrajo acá para que cada
 * servicio de dominio nuevo la reutilice sin reinventar el manejo de
 * `HttpParams`/`FormData`/blobs.
 */
@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl;

  /**
   * Con `options.signal`, abortarla cancela la petición en vuelo (se rechaza con `EmptyError`): así un listado que se
   * vuelve a pedir al cambiar un filtro no deja la anterior viva ni su respuesta compite con la nueva.
   */
  get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, options?: { signal?: AbortSignal }): Promise<T> {
    let httpParams = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
    }
    const request = this.http.get<T>(`${this.base}${path}`, { params: httpParams });
    const signal = options?.signal;
    return firstValueFrom(signal ? request.pipe(takeUntil(aborted(signal))) : request);
  }

  /** Como `get`, pero devuelve también las cabeceras de la respuesta (p. ej. avisos de truncado). */
  async getWithHeaders<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<{ body: T; headers: HttpHeaders }> {
    let httpParams = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
    }
    const response = await firstValueFrom(this.http.get<T>(`${this.base}${path}`, { params: httpParams, observe: 'response' }));
    return { body: response.body as T, headers: response.headers };
  }

  /** Igual que `get`, pero cualquier error (404, red, lo que sea) se traga y devuelve `null` — para los `findX`/`currentX` que hoy hacen `try { return await get() } catch { return null }`. */
  async getOrNull<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T | null> {
    try {
      return await this.get<T>(path, params);
    } catch {
      return null;
    }
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, body));
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(`${this.base}${path}`, body));
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(`${this.base}${path}`, body));
  }

  delete<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`${this.base}${path}`, body !== undefined ? { body } : {}));
  }

  /** Subida multipart genérica — campo `file` + campos de texto opcionales, mismo contrato que `FileInterceptor('file')` en el backend. */
  uploadFile<T>(path: string, file: File, fields?: Record<string, string | undefined>): Promise<T> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (v !== undefined && v !== null && v !== '') formData.append(k, v);
    }
    return firstValueFrom(this.http.post<T>(`${this.base}${path}`, formData));
  }

  getBlob(path: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.base}${path}`, { responseType: 'blob' }));
  }

  postBlob(path: string, body: unknown): Promise<Blob> {
    return firstValueFrom(this.http.post(`${this.base}${path}`, body, { responseType: 'blob' }));
  }

  getText(path: string): Promise<string> {
    return firstValueFrom(this.http.get(`${this.base}${path}`, { responseType: 'text' }));
  }
}

/** Emite (y completa) cuando la señal se aborta; si ya lo estaba, al suscribirse. */
function aborted(signal: AbortSignal): Observable<void> {
  return new Observable<void>((subscriber) => {
    const fire = () => {
      subscriber.next();
      subscriber.complete();
    };
    if (signal.aborted) {
      fire();
      return undefined;
    }
    signal.addEventListener('abort', fire, { once: true });
    return () => signal.removeEventListener('abort', fire);
  });
}
