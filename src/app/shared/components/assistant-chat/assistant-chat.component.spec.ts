import {
  API,
  setupComponent,
  settle,
  makeUser,
} from "../../../core/testing/component-harness";
import { AssistantChatComponent } from "./assistant-chat.component";

const ESTATES = [
  { id: "e1", name: "Residencial Sol" },
  { id: "e2", name: "Edificio Luna" },
];

async function mount(channel: "domo" | "intelligence", estates = ESTATES) {
  const h = setupComponent(AssistantChatComponent, { user: makeUser() });
  h.fixture.componentRef.setInput("channel", channel);
  h.fixture.detectChanges();
  await settle();
  h.http.expectOne(`${API}/assistant/estates`).flush(estates);
  await settle();
  h.fixture.detectChanges();
  return h;
}

function type(h: Awaited<ReturnType<typeof mount>>, value: string) {
  const input = h.el.querySelector("textarea") as HTMLTextAreaElement;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  h.fixture.detectChanges();
}

describe("AssistantChatComponent", () => {
  beforeEach(() => localStorage.clear());

  it("con varias comunidades muestra el selector", async () => {
    const h = await mount("domo");
    expect(h.el.querySelector("select")).not.toBeNull();
  });

  it("con una sola comunidad no muestra el selector", async () => {
    const h = await mount("domo", [ESTATES[0]]);
    expect(h.el.querySelector("select")).toBeNull();
  });

  it("oculta el selector cuando el contenedor ya fija la comunidad", async () => {
    const h = setupComponent(AssistantChatComponent, { user: makeUser() });
    h.fixture.componentRef.setInput("channel", "domo");
    h.fixture.componentRef.setInput("showEstateSelector", false);
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/assistant/estates`).flush(ESTATES);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector("select")).toBeNull();
  });

  it("permite saltos de línea y envía el texto completo con Enter", async () => {
    const h = await mount("domo");
    type(h, "Primera línea");
    const input = h.el.querySelector("textarea") as HTMLTextAreaElement;
    const lineBreak = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(lineBreak);
    expect(lineBreak.defaultPrevented).toBe(false);
    h.http.expectNone(`${API}/assistant/ask`);

    type(h, "Primera línea\nSegunda línea");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const req = h.http.expectOne(`${API}/assistant/ask`);
    expect(req.request.body.question).toBe("Primera línea\nSegunda línea");
    req.flush({
      answer: "Respuesta",
      conversationId: null,
      evidenceStatus: "sufficient",
    });
    await settle();
    h.fixture.detectChanges();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("no envía al confirmar caracteres con un teclado de composición ni duplica envíos", async () => {
    const h = await mount("domo");
    type(h, "Consulta multilínea");
    const input = h.el.querySelector("textarea") as HTMLTextAreaElement;
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
    h.http.expectNone(`${API}/assistant/ask`);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    const req = h.http.expectOne(`${API}/assistant/ask`);
    type(h, "Siguiente consulta");
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    h.http.expectNone(`${API}/assistant/ask`);
    expect(input.value).toBe("Siguiente consulta");
    req.flush({
      answer: "Respuesta",
      conversationId: null,
      evidenceStatus: "sufficient",
    });
    await settle();
  });

  it("envía la pregunta con su canal y comunidad, y pinta la respuesta sin markdown", async () => {
    const h = await mount("domo");
    type(h, "¿Puedo poner un toldo?");
    await settle();

    (h.el.querySelector("app-btn button") as HTMLButtonElement).click();
    const req = h.http.expectOne(`${API}/assistant/ask`);
    expect(req.request.body).toEqual({
      question: "¿Puedo poner un toldo?",
      channel: "domo",
      estateId: "e1",
      conversationId: undefined,
    });
    req.flush({
      answer: "Necesitas autorización.\n**Fuentes:** LPH art. 7.",
      conversationId: "conv-9",
      evidenceStatus: "sufficient",
    });
    await settle();
    h.fixture.detectChanges();

    const bubbles = Array.from(
      h.el.querySelectorAll(".assistant-line__bubble"),
    ).map((b) => b.textContent);
    expect(bubbles).toContain("¿Puedo poner un toldo?");
    expect(
      bubbles.some(
        (b) => b?.includes("Fuentes: LPH art. 7.") && !b.includes("**"),
      ),
    ).toBe(true);
    expect(
      localStorage.getItem("domora.assistant.domo." + makeUser().id + ".e1"),
    ).toBe("conv-9");
  });

  it("recupera el historial guardado de la conversación", async () => {
    localStorage.setItem(
      "domora.assistant.intelligence." + makeUser().id + ".e1",
      "conv-1",
    );
    const h = setupComponent(AssistantChatComponent, { user: makeUser() });
    h.fixture.componentRef.setInput("channel", "intelligence");
    h.fixture.detectChanges();
    await settle();
    h.http.expectOne(`${API}/assistant/estates`).flush(ESTATES);
    await settle();
    h.http
      .expectOne(
        (r: any) =>
          r.url === `${API}/assistant/conversations/conv-1/messages` &&
          r.params.get("channel") === "intelligence" &&
          r.params.get("estateId") === "e1",
      )
      .flush([
        { role: "user", content: "Hola previa", createdAt: "2026-01-01" },
      ]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain("Hola previa");
  });

  it("si el asistente falla, muestra un error genérico", async () => {
    const h = await mount("domo");
    type(h, "una pregunta");
    await settle();
    (h.el.querySelector("app-btn button") as HTMLButtonElement).click();
    h.http
      .expectOne(`${API}/assistant/ask`)
      .flush({ message: "x" }, { status: 502, statusText: "Bad Gateway" });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain(
      "No he podido responder",
    );
  });

  it("desplaza el historial al final después de pintar el mensaje enviado y la respuesta", async () => {
    const h = await mount("domo");
    const messages = h.el.querySelector(
      ".assistant-chat__messages",
    ) as HTMLElement;
    // jsdom no calcula alturas: simulamos un historial que supera el área visible.
    Object.defineProperty(messages, "scrollHeight", {
      get: () =>
        messages.querySelectorAll(".assistant-line").length * 200 +
        (messages.textContent?.length ?? 0),
    });
    h.component.text.set("¿Cuál es el gasto de mi comunidad?");
    h.fixture.detectChanges();
    (h.el.querySelector("app-btn button") as HTMLButtonElement).click();
    await settle();
    h.fixture.detectChanges();
    expect(messages.scrollTop).toBe(messages.scrollHeight);

    const sentHeight = messages.scrollHeight;
    h.http.expectOne(`${API}/assistant/ask`).flush({
      answer:
        "Esta es la respuesta de Domo.\n\n📚 Fuente: Cuentas de la comunidad",
      conversationId: "conv-scroll",
      evidenceStatus: "sufficient",
    });
    await settle();
    h.fixture.detectChanges();
    expect(messages.scrollTop).toBe(messages.scrollHeight);
    expect(messages.scrollTop).toBeGreaterThan(0);
    expect(
      messages.querySelector(".assistant-line__bubble--typing"),
    ).toBeNull();
    expect(messages.textContent).toContain("Esta es la respuesta de Domo.");
    expect(messages.scrollHeight).toBeGreaterThan(sentHeight);
  });
});
