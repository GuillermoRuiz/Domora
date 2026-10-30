import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../icon/icon.component";
import { BtnComponent } from "../btn/btn.component";
import { AvatarComponent } from "../avatar/avatar.component";
import {
  AssistantChannel,
  AssistantEstate,
  AssistantService,
} from "../../../core/assistant.service";
import { AuthService } from "../../../core/auth.service";

import { SelectDropdownDirective } from '../dropdown/select-dropdown.directive';
interface ChatLine {
  role: "user" | "assistant";
  content: string;
}

const GENERIC_ERROR =
  "No he podido responder ahora mismo. Inténtalo de nuevo en unos instantes.";

/**
 * Chat con el asistente de Domora (RAG). Compartido por Domora Intelligence
 * (`channel="intelligence"`) y por el hilo de Domo en Mensajes
 * (`channel="domo"`): misma UI y mismo backend, distinto historial.
 */
@Component({
  selector: "app-assistant-chat",
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, AvatarComponent, SelectDropdownDirective],
  templateUrl: "./assistant-chat.component.html",
  styleUrl: "./assistant-chat.component.scss",
})
export class AssistantChatComponent implements OnInit {
  private assistant = inject(AssistantService);
  private auth = inject(AuthService);
  private injector = inject(Injector);
  private messageList =
    viewChild.required<ElementRef<HTMLDivElement>>("messageList");
  private composer =
    viewChild.required<ElementRef<HTMLTextAreaElement>>("composer");

  channel = input.required<AssistantChannel>();
  assistantName = input("Domo");
  showEstateSelector = input(true);
  avatarSrc = input("");
  /** Si se indica, el chat queda fijado a esa finca (p. ej. dentro de su ficha) y no muestra selector. */
  fixedEstateId = input<string | undefined>(undefined);
  welcome = input("Pregúntame lo que necesites saber sobre tu comunidad.");

  estates = signal<AssistantEstate[]>([]);
  estateId = signal<string | undefined>(undefined);
  lines = signal<ChatLine[]>([]);
  text = signal("");
  sending = signal(false);
  loading = signal(true);
  error = signal<string | null>(null);

  private conversationId: string | null = null;

  canSend = computed(() => !this.sending() && this.text().trim().length >= 2);

  constructor() {
    // La ficha puede cambiar de finca sin recrear el componente.
    effect(() => {
      const fixed = this.fixedEstateId();
      untracked(() => {
        if (!fixed || fixed === this.estateId() || this.loading()) return;
        void this.onEstateChange(fixed);
      });
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const fixed = this.fixedEstateId();
      if (fixed) {
        this.estateId.set(fixed);
      } else {
        const estates = await this.assistant.listEstates();
        this.estates.set(estates);
        this.estateId.set(estates[0]?.id);
      }
      await this.restoreConversation();
    } catch (error) {
      console.error("Error cargando el asistente", error);
      this.error.set(GENERIC_ERROR);
    } finally {
      this.loading.set(false);
      this.scrollToLatest();
    }
  }

  async onEstateChange(estateId: string): Promise<void> {
    this.estateId.set(estateId);
    this.lines.set([]);
    this.error.set(null);
    await this.restoreConversation();
    this.scrollToLatest();
  }

  updateDraft(value: string): void {
    this.text.set(value);
    const field = this.composer().nativeElement;
    // Medir desde la altura mínima permite crecer y encogerse al editar o pegar texto.
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    if (!event.repeat) void this.send();
  }

  async send(): Promise<void> {
    const question = this.text().trim();
    if (!this.canSend()) return;

    this.text.set("");
    const field = this.composer().nativeElement;
    field.style.height = "";
    field.scrollTop = 0;
    field.focus();
    this.error.set(null);
    this.lines.update((l) => [...l, { role: "user", content: question }]);
    this.sending.set(true);
    this.scrollToLatest();
    try {
      const reply = await this.assistant.ask({
        question,
        channel: this.channel(),
        estateId: this.estateId(),
        conversationId: this.conversationId ?? undefined,
      });
      this.conversationId = reply.conversationId;
      this.storeConversationId(reply.conversationId);
      this.lines.update((l) => [
        ...l,
        { role: "assistant", content: reply.answer },
      ]);
    } catch (error) {
      console.error("Error preguntando al asistente", error);
      this.error.set(GENERIC_ERROR);
    } finally {
      this.sending.set(false);
      this.scrollToLatest();
    }
  }

  private scrollToLatest(): void {
    // Esperar al render evita medir el historial antes de añadir la nueva burbuja.
    afterNextRender(
      {
        earlyRead: () => this.messageList().nativeElement.scrollHeight,
        write: (height) => {
          this.messageList().nativeElement.scrollTop = height;
        },
      },
      { injector: this.injector },
    );
  }

  /** El backend devuelve las fuentes en negrita markdown; aquí se pintan como texto plano. */
  plain(content: string): string {
    return content.replace(/\*\*/g, "");
  }

  private async restoreConversation(): Promise<void> {
    this.conversationId = this.readConversationId();
    if (!this.conversationId) return;
    try {
      const messages = await this.assistant.listMessages(
        this.conversationId,
        this.channel(),
        this.estateId(),
      );
      this.lines.set(
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
    } catch {
      // Conversación caducada o de otra finca: se empieza una nueva.
      this.conversationId = null;
      this.storeConversationId(null);
    }
  }

  // El id de conversación solo es una comodidad por navegador: si falta, se abre otra.
  private storageKey(): string {
    return `domora.assistant.${this.channel()}.${this.auth.currentUser()?.id ?? ""}.${this.estateId() ?? "global"}`;
  }

  private readConversationId(): string | null {
    try {
      return localStorage.getItem(this.storageKey());
    } catch {
      return null;
    }
  }

  private storeConversationId(id: string | null): void {
    try {
      if (id) localStorage.setItem(this.storageKey(), id);
      else localStorage.removeItem(this.storageKey());
    } catch {
      // Sin almacenamiento disponible: la conversación sigue en memoria.
    }
  }
}
