import { setupComponent } from "../../../core/testing/component-harness";
import { EstateFacadeThumbnailComponent } from "./estate-facade-thumbnail.component";

describe("EstateFacadeThumbnailComponent", () => {
  it("fallback sin URL y ante error; nueva URL recupera la imagen", () => {
    const h = setupComponent(EstateFacadeThumbnailComponent);
    h.fixture.detectChanges();
    expect(h.el.querySelector("img")).toBeNull();
    const photo =
      "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral=1907401VK4810H";
    h.fixture.componentRef.setInput("url", photo);
    h.fixture.detectChanges();
    expect(h.el.querySelector("img")?.getAttribute("src")).toBe(photo);
    expect(h.el.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    h.el.querySelector("img")!.dispatchEvent(new Event("error"));
    h.fixture.detectChanges();
    expect(h.el.querySelector("img")).toBeNull();
    expect(h.el.querySelector(".facade-fallback")).not.toBeNull();
    h.fixture.componentRef.setInput("url", photo + "&v=2");
    h.fixture.detectChanges();
    expect(h.el.querySelector("img")).not.toBeNull();
  });

  describe("foto subida por la gestora", () => {
    const CATASTRO =
      "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral=1907401VK4810H";
    const photoUrl = (id: string) => `http://localhost:3000/api/v1/estates/${id}/photo`;

    let created: string[];
    let revoked: string[];
    beforeEach(() => {
      created = [];
      revoked = [];
      let n = 0;
      vi.spyOn(URL, "createObjectURL").mockImplementation(() => { const url = `blob:foto-${++n}`; created.push(url); return url; });
      vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revoked.push(url); });
    });

    function mount(inputs: Record<string, unknown>) {
      const h = setupComponent(EstateFacadeThumbnailComponent);
      for (const [k, v] of Object.entries(inputs)) h.fixture.componentRef.setInput(k, v);
      h.fixture.detectChanges();
      return h;
    }
    const answer = async (h: ReturnType<typeof mount>, id = "e1") => {
      h.http.expectOne((r) => r.url.startsWith(photoUrl(id))).flush(new Blob(["x"], { type: "image/png" }));
      await new Promise((resolve) => setTimeout(resolve));
      h.fixture.detectChanges();
    };

    it("pide la foto con la sesión y la versión, y manda sobre la fachada del Catastro", async () => {
      const h = mount({ url: CATASTRO, estateId: "e1", photoVersion: "2026-10-17T10:00:00.000Z" });
      const req = h.http.expectOne((r) => r.url.startsWith(photoUrl("e1")));
      expect(req.request.urlWithParams).toBe(`${photoUrl("e1")}?v=2026-10-17T10%3A00%3A00.000Z`);
      req.flush(new Blob(["x"], { type: "image/png" }));
      await new Promise((resolve) => setTimeout(resolve));
      h.fixture.detectChanges();
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe("blob:foto-1");
      h.http.verify();
    });

    it("mientras llega la foto subida no enseña la del Catastro un instante para luego cambiarla", async () => {
      const h = mount({ url: CATASTRO, estateId: "e1", photoVersion: "v1" });
      expect(h.el.querySelector("img")).toBeNull();
      expect(h.el.querySelector(".facade-fallback")).not.toBeNull();
      await answer(h);
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe("blob:foto-1");
    });

    it("si la foto subida no se puede pedir, vuelve a la fachada del Catastro", async () => {
      const h = mount({ url: CATASTRO, estateId: "e1", photoVersion: "v1" });
      h.http.expectOne((r) => r.url.startsWith(photoUrl("e1"))).flush(new Blob([""]), { status: 404, statusText: "Not Found" });
      await new Promise((resolve) => setTimeout(resolve));
      h.fixture.detectChanges();
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe(CATASTRO);
    });

    it("si la imagen subida no se pinta, cae a la del Catastro; y si esa tampoco, al icono", async () => {
      const h = mount({ url: CATASTRO, estateId: "e1", photoVersion: "v1" });
      await answer(h);
      h.el.querySelector("img")!.dispatchEvent(new Event("error"));
      h.fixture.detectChanges();
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe(CATASTRO);
      h.el.querySelector("img")!.dispatchEvent(new Event("error"));
      h.fixture.detectChanges();
      expect(h.el.querySelector("img")).toBeNull();
      expect(h.el.querySelector(".facade-fallback")).not.toBeNull();
    });

    it("sin versión de foto subida no se pide nada y se usa el Catastro", () => {
      const h = mount({ url: CATASTRO, estateId: "e1", photoVersion: null });
      h.http.expectNone(() => true);
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe(CATASTRO);
    });

    it("sin id de finca tampoco se pide nada, aunque haya versión", () => {
      const h = mount({ url: CATASTRO, photoVersion: "v1" });
      h.http.expectNone(() => true);
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe(CATASTRO);
    });

    it("al cambiar la versión pide la nueva y libera la anterior; al quitar la foto vuelve al Catastro", async () => {
      const h = mount({ url: CATASTRO, estateId: "e1", photoVersion: "v1" });
      await answer(h);
      h.fixture.componentRef.setInput("photoVersion", "v2");
      h.fixture.detectChanges();
      expect(revoked).toContain("blob:foto-1");
      await answer(h);
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe("blob:foto-2");

      h.fixture.componentRef.setInput("photoVersion", null);
      h.fixture.detectChanges();
      expect(revoked).toContain("blob:foto-2");
      expect(h.el.querySelector("img")?.getAttribute("src")).toBe(CATASTRO);
    });

    it("sin foto subida ni Catastro muestra el icono", () => {
      const h = mount({ estateId: "e1", photoVersion: null });
      expect(h.el.querySelector(".facade-fallback")).not.toBeNull();
    });
  });
});
