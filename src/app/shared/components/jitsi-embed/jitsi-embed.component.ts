import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { JitsiMeetExternalAPIInstance, loadJitsiExternalApi } from './jitsi-loader';

const JITSI_DOMAIN = 'meet.jit.si';

/**
 * Embed de Jitsi vía IFrame API — reemplaza la redirección de página
 * completa que hace el original React (`window.location.href =
 * 'https://meet.jit.si/...'`). Mantiene el estado de la app (signals,
 * sesión) sin recarga completa, y permite, a futuro, integrar el panel de
 * votación en la misma pantalla.
 *
 * Se monta siempre detrás de un `@defer` en el componente padre — el SDK
 * (`external_api.js`) no debe entrar en el bundle inicial del módulo de
 * juntas.
 */
@Component({
  selector: 'app-jitsi-embed',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './jitsi-embed.component.html',
  styleUrl: './jitsi-embed.component.scss',
})
export class JitsiEmbedComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) roomName!: string;
  @Input() displayName?: string;
  @Input() subject?: string;

  /** Emitido cuando la API de Jitsi confirma que el usuario entró realmente a la sala (no solo que se le permitió). */
  @Output() joined = new EventEmitter<void>();

  @ViewChild('container', { static: true }) containerRef!: ElementRef<HTMLDivElement>;

  loading = signal(true);
  error = signal<string | null>(null);

  private api: JitsiMeetExternalAPIInstance | null = null;

  async ngAfterViewInit(): Promise<void> {
    try {
      await loadJitsiExternalApi();
      this.mount();
    } catch (error) {
      console.error('Error cargando el SDK de Jitsi', error);
      this.error.set('No se pudo cargar la videollamada.');
      this.loading.set(false);
    }
  }

  private mount(): void {
    if (!window.JitsiMeetExternalAPI) {
      this.error.set('No se pudo cargar la videollamada.');
      this.loading.set(false);
      return;
    }
    this.api = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
      roomName: this.roomName,
      parentNode: this.containerRef.nativeElement,
      width: '100%',
      height: '100%',
      userInfo: this.displayName ? { displayName: this.displayName } : undefined,
      configOverwrite: this.subject ? { subject: this.subject } : undefined,
    });

    this.api.addEventListener('videoConferenceJoined', () => {
      this.loading.set(false);
      this.joined.emit();
    });
    // Por si el iframe tarda en emitir el evento de unión (red lenta): no
    // dejamos el spinner colgado indefinidamente si ya se montó el iframe.
    this.loading.set(false);
  }

  retry(): void {
    this.error.set(null);
    this.loading.set(true);
    void this.ngAfterViewInit();
  }

  ngOnDestroy(): void {
    this.api?.dispose();
  }
}
