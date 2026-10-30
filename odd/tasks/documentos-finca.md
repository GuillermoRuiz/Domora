# Pestaña «Documentos» de la finca (rol B) — biblioteca tipo SharePoint

Objetivo: una pestaña visible «Documentos» en `b/estates/:id` para consultar y gestionar todos los documentos de la finca en carpetas, con documentos subidos por la gestora y generados por la aplicación (actas), y con visibilidad configurable para los propietarios.
Rama: `feat/estate-documents` (desde `main` tras las PR 39 y 40, sin push). Tests: `npx ng test --no-watch` (front), `npm test` en `backend/` (Jest; integración contra Postgres). Entrega: commits por unidad, sin push.
ESTADO: IMPLEMENTADO (L7), sin push. Pendiente solo comprobar la vista previa de PDF en un Chrome real tras nginx.

## Specs (provisionales hasta resolver las decisiones)

- **S1** Pestaña visible «Documentos» en el detalle de finca (rol B), que sustituye a la pestaña antigua oculta `?tab=documents` sin romper sus enlaces.
- **S2** Biblioteca por carpetas al estilo SharePoint: árbol de carpetas, ruta (migas de pan), lista con columnas (Nombre, Tipo, Visible para, Origen, Modificado, Tamaño), búsqueda y filtros, vista previa (PDF e imagen) y acciones (subir, descargar, renombrar, mover, cambiar visibilidad, eliminar a una papelera).
- **S3** Los documentos los suben los administradores de fincas (rol A/B) o los genera la aplicación (actas firmadas en primer lugar).
- **S4** Visibilidad configurable para los propietarios, con carpetas públicas para ellos («¿quizás generar carpetas publicas para los propietarios?», L1): ver D1–D2.
- **S5** Los propietarios (rol C) ven solo lo que les corresponde, organizado por carpetas, en «Mi comunidad» y en la ficha de su propiedad.
- **S7** Seguro por defecto (D5, L3): «El nivel por defecto debe ser el mas restrictivo para que sea mas seguro. A partir de ahi será necesario habilitar la visibilidad o el acceso de los documentos según aplica cada caso». Todo documento y toda carpeta nacen como «Solo gestora»; la gestora los abre explícitamente.
- **S6** Seguridad: la autorización sigue centralizada en `RagAuthorizationService` (`authorized_document_ids`), las descargas quedan registradas en `data_access_log` y la subida comprueba el contenido real del fichero (no solo el tipo declarado).

## Situación actual (mapa del código, 2026-10-22)

| Tema | Hoy | Consecuencia para el plan |
|---|---|---|
| Pestaña | `documents` es una pestaña antigua **oculta** (`estate-navigation.service.ts:12`), solo por enlace `?tab=documents`; la tarjeta «Documentos esenciales» remite a ella | Hay que hacerla visible y mantener los enlaces existentes (alertas, actividad, tareas) |
| Modelo `Document` | `estateId`, `title`, `type` (texto libre), `date`, `size` (texto), `s3Key`, `targetPropertyId` | No hay carpetas, tipo MIME, tamaño en bytes, autor, borrado lógico ni versiones |
| Visibilidad | Solo `targetPropertyId`: null = toda la finca; con valor = esa propiedad | No hay «solo gestora» ni «junta»: hoy **todo** documento de la finca lo ve cualquier propietario |
| Gestión | No hay endpoint para editar ni borrar documentos | Hay que crear renombrar, mover, visibilidad y papelera |
| Almacenamiento | Disco local (`STORAGE_DIR`), descarga a través de Nest, 10 MB, solo tipo MIME declarado | Suficiente para empezar; S3 y URLs firmadas quedan fuera |
| Documentos generados | Acta PDF por versión (`meetings/{id}/acta/acta-vN.pdf`), acta firmada `.docx` (`actaS3Key`), convocatoria y certificado de deuda bajo demanda. Desde la PR 40 el acta tiene origen (`actaOrigin`: `generated` o `uploaded`, con `actaUpload*` y SHA-256) y la convocatoria puede redactarse a mano | Ninguno crea una fila `Document`: no aparecen en la lista de documentos. T3 debe cubrir los dos orígenes del acta |
| Lecturas y avisos | `ResourceRead` marca «nuevo»; aviso derivado «Nuevo documento disponible»; no hay categoría de notificación `document` | Reutilizar lecturas; añadir aviso al publicar |
| Auditoría | Las descargas de documentos **no** se registran en `data_access_log` | Añadirlo |
| RAG | Indexación manual de PDF (`assistant/documents/:id/index`), ACL por `targetPropertyId` | La ACL debe ampliarse con la nueva visibilidad (fase posterior) |

## Análisis de mercado

**España (software para administradores de fincas).** La mayoría ofrece un portal o app del propietario con documentación por comunidad y acceso a actas sin pedirlas al administrador: ADCOMUNIDAD organiza la documentación por propiedades, propietarios e inquilinos; Fincfy da espacios privados para documentación y recibos; ArtecoFincas separa panel de administrador y portal del propietario; FincasBox y Fynkus tienen app del propietario con los documentos que comparte el administrador. Las fuentes públicas son fichas comerciales y no describen el modelo de permisos: **no hay un referente español con carpetas y audiencias documentadas**, lo que es una oportunidad de diferenciación.

**EE. UU. (gestión de comunidades, HOA).** Es donde el modelo está más maduro:
- **Vantaca**: biblioteca por carpetas con nivel de acceso por carpeta (carpetas públicas para todos los propietarios, carpetas de junta solo para la junta); las subcarpetas heredan el nivel de su padre salvo que se cambie; la junta puede subir pero no borrar (lo hace la gestora); los documentos de proveedores son internos.
- **TownSq**: en diciembre de 2024 sustituyó «categorías» por carpetas y subcarpetas; permisos por carpeta para grupos concretos; el propietario ve por defecto todo lo que tiene permitido, con filtros como «Governing Docs».
- **AppFolio**: comparte documentos de la comunidad (estatutos, actas, directorios) en el portal, documentos solo para la junta y envío masivo de documentos por correo; se pueden «dejar de compartir».
- **ManageCasa**: compartir un archivo o una carpeta entera con contactos concretos; compartir la carpeta comparte todo su contenido.
- Guía sectorial: tres niveles habituales de acceso (propietarios, comisiones, junta).

**SharePoint (referencia de interacción).** Árbol de carpetas, migas de pan, columnas de metadatos, vista previa, mover/copiar, papelera de reciclaje, historial de versiones y herencia de permisos desde la carpeta.

**Lo que adoptamos:** carpetas con **visibilidad por carpeta heredada** (Vantaca, TownSq, SharePoint), plantilla de carpetas por defecto, nivel «junta» además de «propietarios» y «solo gestora», papelera en lugar de borrado definitivo, vista previa, y aviso a los propietarios al publicar (AppFolio). **Lo que no adoptamos por ahora:** comentarios de los vecinos sobre documentos (TownSq), espacio personal «Mis documentos» del propietario, firma electrónica y versiones.

**Marco legal (a confirmar con el texto del BOE antes de citarlo en la interfaz):**
- LPH art. 19: el secretario (a menudo el administrador) custodia el libro de actas y debe conservar **cinco años** las convocatorias, comunicaciones, apoderamientos y demás documentos relevantes de las juntas; el acta se cierra con las firmas del presidente y del secretario en un máximo de diez días naturales.
- AEPD: publicar datos personales (p. ej. deudores) solo es defendible ante propietarios, nunca ante terceros, y con notificación personal previa; hay sanciones de 10.000 y 15.000 € a comunidades por exponer actas con nombres en zonas comunes. Un portal restringido a propietarios autenticados es el canal adecuado, pero **inquilinos y terceros no deben ver las actas** y conviene avisar al publicar documentos que contengan datos personales.
- El registro RGPD del proyecto ya fija «Actas y documentos de junta: vida de la comunidad» (`doc/compliance/rgpd.md`): las actas no deben poder borrarse definitivamente.

## Diseño propuesto

**Modelo de datos (aditivo):**
- `DocumentFolder`: `estateId`, `parentId`, `name`, `visibility` (ver D1), `systemKey` (carpetas de la plantilla, no borrables), `sortOrder`, `createdByUserId`, `deletedAt`.
- `Document` gana: `folderId`, `visibility` (null = hereda de la carpeta), `mimeType`, `sizeBytes`, `uploadedByUserId`, `source` (`upload` | `generated`), `sourceRef` (p. ej. el id de la junta), `description`, `publishedAt`, `deletedAt` (papelera).
- `targetPropertyId` se mantiene como la visibilidad «solo una propiedad».
- Migración de datos: los documentos existentes se reparten por tipo en las carpetas de la plantilla, conservando su visibilidad efectiva actual (riesgo 1: hay que verificarla en una base de prueba).

**Plantilla de carpetas por finca (propuesta, ver D3):** Documentación legal (escritura, estatutos, CIF) · Actas y juntas · Contabilidad y presupuestos · Seguros · Contratos y mantenimiento · Certificados e inspecciones · Interno de la gestora.

**Documentos generados:** al firmarse el acta, se crea una fila `Document` en «Actas y juntas» que apunta al fichero ya guardado (sin copiarlo), con `source = generated`, enlazada a la junta y no editable ni borrable desde la biblioteca. Las convocatorias y los certificados de deuda quedan fuera de la primera fase: el certificado es personal y no debe acabar en una carpeta común.

**Interfaz (rol B):** árbol a la izquierda, migas de pan, tabla con selección múltiple, zona para arrastrar y soltar varios ficheros, panel de vista previa, menú «⋯» por documento (descargar, renombrar, mover, visibilidad, eliminar), filtros (tipo, visibilidad, origen, fecha), papelera y un modo **«Ver como propietario»** para comprobar qué ve un vecino antes de publicar.

**Propietarios (rol C):** sección de documentos por carpetas en «Mi comunidad», solo con lo visible para su perfil, con la marca de «nuevo» actual y aviso al publicarse algo en una carpeta pública.

## Tareas

| ID | S | Unidad | Estado (ruta: inline) |
|---|---|---|---|
| T1 | S2,S4,S7 | Backend: `DocumentFolder`, campos nuevos de `Document` (visibilidad por defecto «Solo gestora»), migración y reparto de los documentos existentes en carpetas según D5 (verificado en una base de prueba) | Hecha · 823c8cb |
| T2 | S2,S4,S6 | Backend: API de carpetas y documentos (listar por carpeta con búsqueda, subida múltiple, renombrar, mover, visibilidad, papelera y restaurar); `RagAuthorizationService` con la nueva visibilidad; auditoría de descargas; comprobación del contenido real del fichero | Hecha · 252ecc3 |
| T3 | S3 | Backend: actas firmadas → `Document` en «Actas y juntas», tanto generadas en Domora como subidas por la gestora (`actaOrigin`, PR 40), apuntando a su fichero sin copiarlo; también las firmadas antes, por migración | Hecha · 5589c17 |
| T4 | S1,S2 | Frontend B: pestaña visible «Documentos» (sustituye a la antigua y conserva `?tab=documents`), árbol, tabla, subida, vista previa y acciones | Hecha · 3519125 + fdcb170 (filtros) |
| T5 | S4,S7 | Frontend B: visibilidad por carpeta y por documento, «Visibilidad propia», «Ver como propietario», aviso de datos personales al publicar y aviso de documentos pendientes de revisar tras la migración | Hecha · 3519125 (+ a080966 conteos) |
| T6 | S5 | Frontend C: documentos por carpetas en «Mi comunidad» y en la ficha de la propiedad | Hecha · ba831f3 + fdcb170 (carpeta en «Mi comunidad») |
| T7 | S5 | Avisos: categoría `document` y notificación al publicar en carpetas visibles para propietarios | Hecha · 1a3e432 (back) + 4570279 (front) |
| T8 | — | Demo: carpetas y documentos de ejemplo con visibilidades explícitas y aserción de cifras (mantener lo que ven hoy los propietarios demo); la tarjeta «Documentos esenciales» enlaza a la nueva pestaña | Hecha · 128bf86 |
| T9 | — | Verificación (unitarios, integración, e2e, navegador en claro, oscuro y móvil), verificador independiente y documentación | Hecha · 7e85a6f, fdcb170 (correcciones del verificador) |

**Fuera de alcance (fases posteriores):** versiones de un documento, indexación automática en el asistente (RAG) al publicar, S3 con URLs firmadas, comentarios de vecinos, avisos de caducidad (pólizas, certificados), convocatorias y otros documentos generados, firma electrónica.

## Decisiones pendientes

- **D1 — Niveles de visibilidad. RESUELTA (L2):** «Si me parecen unos niveles correctos». Cuatro niveles — «Solo gestora», «Junta de gobierno» (presidente y vicepresidentes vigentes, que ya existen en `EstateOfficeTerm`), «Todos los propietarios» y «Una propiedad» (el `targetPropertyId` actual). Inquilinos fuera por ahora (AEPD: las actas no son para terceros).
- **D2 — Dónde se fija la visibilidad. RESUELTA (L3):** por carpeta, heredada por subcarpetas y documentos, con la opción de cambiarla en un documento concreto; los documentos con visibilidad propia se marcan en la lista («Visibilidad propia»).
- **D3 — Plantilla de carpetas. RESUELTA (L3):** Documentación legal · Actas y juntas · Contabilidad y presupuestos · Seguros · Contratos y mantenimiento · Certificados e inspecciones · Interno de la gestora, en todas las fincas; carpetas de sistema no borrables (sí renombrables) y subcarpetas libres. Por S7, todas nacen «Solo gestora».
- **D4 — Publicación de documentos generados. RESUELTA (L3):** el acta firmada entra en «Actas y juntas» como «Solo gestora» y pasa a «Todos los propietarios» (visibilidad propia del documento) cuando se envía a los vecinos (`sendActaNotice`). Enviar el acta es el acto explícito que la abre, coherente con S7.
- **D5 — Documentos existentes. RESUELTA (L3):** «no permitir ver a todo propietario». Al migrar, los documentos sin propiedad dejan de ser visibles para los propietarios y quedan como «Solo gestora».
  - Confirmado (L4): «Si fue de forma explicita es correcto mantener esa visibilidad». Los documentos dirigidos a una propiedad concreta (`targetPropertyId`) conservan el nivel «Una propiedad».
  - Consecuencia: **desde el despliegue, los propietarios dejan de ver los documentos comunitarios existentes** («Documentos recientes» y el KPI «Documentos nuevos» de «Mi comunidad» quedarán vacíos) hasta que la gestora los abra. La pestaña mostrará un aviso con el número de documentos que esperan revisión.
  - La demo debe abrir explícitamente los documentos que hoy ven los propietarios demo, o sus cifras (`OWNER_PANEL_FIGURES`) cambian.

## Fuentes

- Software español: [Estrategias de Inversión — guía](https://www.estrategiasdeinversion.com/actualidad/noticias/empresas/guia-completa-sobre-software-de-administracion-n-819113), [ADCOMUNIDAD](https://www.softwaredoit.es/adcomunidad/adcomunidad.html), [Fincfy](https://www.softwaredoit.es/fincfy/fincfy.html), [FincasBox](https://www.comparasoftware.com/fincasbox), [ArtecoFincas](https://www.comparasoftware.com/arteco-fincas), [Fynkus (Capterra)](https://www.capterra.es/software/1030858/fynkus), [Fynkus (nota de prensa)](https://officialpress.es/fynkus-la-primera-aplicacion-movil-dirigida-a-propietarios-para-gestionar-su-comunidad-de-vecinos/)
- Mercado HOA: [Vantaca — biblioteca y seguridad](https://support.vantaca.com/hc/en-us/articles/360017422972-Association-Document-Library-and-Security), [Vantaca Home — Documents](https://support.vantaca.com/hc/en-us/articles/21898344403995-Vantaca-Home-Documents-Page), [Westward360 sobre Vantaca](https://westward360.com/knowledge-base/vantaca-home-documents-page/), [TownSq — carpetas (dic. 2024)](https://www.townsq.io/new-releases-and-updates/unlock-effortless-file-management-with-our-revamped-documents-feature), [TownSq — documentos](https://www.townsq.io/solutions/community-features/community-documents), [AppFolio HOA — comunicación](https://www.appfolio.com/markets/hoa/communication), [ManageCasa — ficheros](https://help.managecasa.com/hc/en-us/articles/31787104167963-Manage-Files-and-Documents), [Fast.io — portal documental HOA](https://fast.io/resources/hoa-document-portal/)
- Legal: [LPH art. 19 (Iberley)](https://iberley.es/legislacion/articulo-19-ley-propiedad-horizontal), [LPH art. 19 (Conceptos Jurídicos)](https://www.conceptosjuridicos.com/articulos/ley-de-propiedad-horizontal-articulo-19/), [AEPD — resolución PS/00104/2017](https://www.aepd.es/es/documento/00104-2017.pdf), [Idealista — multas a comunidades](https://www.idealista.com/news/node/789879)

## Log

- L1 (2026-10-22): "Traza un plan para agregar una nueva pestaña al detalle de las fincas donde se podrán consultar todo tipo de documentos. Un estilo similar al Sharepoint. Los documentos podrán ser subidos por los administradores de fincas o podrán generarse internamente por la aplicación como en el caso de las actas. Los documentos se podrán gestionar para configurar la visibilidad de cara a los propietarios ¿quizás generar carpetas publicas para los propietarios? Haz un analisis profundo de otras soluciones que haya en el mercado y que se podrán tener en cuenta para esta aplicación"
- Análisis: mapa del código (explorador, verificado: la pestaña `documents` está oculta) e investigación web. Algunas páginas de ayuda (Vantaca, ManageCasa) devolvieron 403 al consultarlas directamente; su contenido procede de los resúmenes del buscador y de la base de conocimiento de Westward360.
- L2 (2026-10-22): "D1. Si me parecen unos niveles correctos".
- L3 (2026-10-22): "Aplica las recomendaciones de D2, D3 y D4. En el caso de D5, no permitir ver a todo propietario. El nivel por defecto debe ser el mas restrictivo para que sea mas seguro. A partir de ahi será necesario habilitar la visibilidad o el acceso de los documentos según aplica cada caso".
- L4 (2026-10-22): "2. Si fue de forma explicita es correcto mantener esa visibilidad".
- L5 (2026-10-22): "Abre una nueva rama". Rama `feat/estate-documents` desde `origin/main` (incluye las PR 39 «Datos generales» y 40 «juntas: acta subida»); el plan se trajo con cherry-pick. La PR 40 añade el acta subida (`actaOrigin`, `actaUpload*`): T3 ajustada.
- L6 (2026-10-22): "Implementa todo el plan paso a paso". Decisiones de implementación:
  - La visibilidad efectiva se guarda en cada documento (`effectiveVisibility`) y se recalcula al cambiar carpetas o documentos; así todas las consultas usan un `where` simple.
  - Un único servicio (`DocumentAccessService`) construye ese filtro por usuario y lo usan las 6 consultas que hoy repiten la regla a mano (descarga y asistente, listado, avisos y actividad, KPI de «Mi comunidad»).
  - «Propietarios» = miembros vinculados con rol Propietario o Representante (D1: sin inquilinos); «Junta» = cargo vigente (`EstateOfficeTerm`) del usuario en esa finca.
  - Los documentos comunitarios que pasan a «Solo gestora» por la migración quedan marcados como pendientes de revisión para el aviso de la pestaña.
- T2 (2026-10-22): la regla de visibilidad se aplica ahora en descarga y asistente, listado, avisos (gestora y propietario), actividad, KPI de «Mi comunidad», enlaces de tareas y tarjeta de documentos esenciales; un test guardián (`document-reads.guard.spec.ts`) falla si aparece una lectura de documentos sin revisar. Las descargas se auditan y se sirven con su tipo real (`nosniff`); la subida comprueba el contenido del fichero. La clasificación del asistente (RAG) sale de la visibilidad efectiva: solo «Todos los propietarios» es comunitario. Limitación pendiente: un documento ya indexado que cambia de visibilidad conserva su clasificación anterior en el asistente hasta reindexarlo.
- T4–T8 (2026-10-22/23): pestaña de la gestora, biblioteca del propietario, avisos y demo hechos; el demo archiva cada documento en su carpeta con visibilidad explícita (si no, el valor restrictivo dejaba al propietario demo sin documentos). Navegador: claro, oscuro y móvil sin errores ni scroll horizontal (se corrigieron nombres partidos en móvil, Esc en diálogos y la opción heredada en documentos de la raíz).
- T9 (2026-10-23): frontend 2879/2879 y build; backend 2617 + seed 44/44 (BD aislada `domora_demo_test`). Verificador independiente: sin fugas de documentos; un bloqueante corregido (7e85a6f: el listado antiguo devolvía la fila completa con campos internos a los propietarios; ahora campos explícitos, con test) y dos requisitos incompletos completados (fdcb170: filtros de S2; carpeta de cada documento en «Mi comunidad» para S5). `folderId` mal formado ahora da 400. Avisos sin corregir: limpieza del fichero si falla la transacción de subida, el aviso de carpeta no limpia «pendiente de revisar» en subcarpetas, posible doble aviso (notificación + alerta derivada). CSP: el iframe `blob:` ya no se bloquea (comprobado en aislado); falta ver el PDF renderizado en un Chrome real (el Chromium sin interfaz no trae visor). Un «Unhandled Rejection» en `account-menu.component.spec.ts`, spec que esta rama no toca.
