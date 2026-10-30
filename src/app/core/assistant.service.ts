import { Injectable, inject } from "@angular/core";
import { ApiClientService } from "./api-client.service";
import { CommunityScopeService } from "./community-scope.service";

/** Superficie desde la que se pregunta; cada una tiene su propio historial. */
export type AssistantChannel = "intelligence" | "domo";

export interface AssistantEstate {
  id: string;
  name: string;
}

export interface AssistantAnswer {
  answer: string;
  conversationId: string | null;
  evidenceStatus: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/**
 * Cliente del asistente de Domora (RAG): lo usan Domora Intelligence y el
 * chat con Domo en Mensajes. El backend decide a qué comunidad puede acceder
 * el usuario; aquí solo se pide una finca de entre las suyas.
 */
@Injectable({ providedIn: "root" })
export class AssistantService {
  private api = inject(ApiClientService);
  private readonly communityScope = inject(CommunityScopeService);

  async listEstates(): Promise<AssistantEstate[]> {
    const estates = await this.api.get<AssistantEstate[]>("/assistant/estates");
    this.communityScope.remember(estates);
    return estates;
  }

  ask(body: {
    question: string;
    channel: AssistantChannel;
    estateId?: string;
    conversationId?: string;
  }): Promise<AssistantAnswer> {
    return this.api.post<AssistantAnswer>("/assistant/ask", body);
  }

  listMessages(
    conversationId: string,
    channel: AssistantChannel,
    estateId?: string,
  ): Promise<AssistantMessage[]> {
    return this.api.get<AssistantMessage[]>(
      `/assistant/conversations/${conversationId}/messages`,
      { channel, estateId },
    );
  }
}
