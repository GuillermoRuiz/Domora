# Pestaña Datos generales (rol B) — panel según mockup

Objetivo: reconstruir la pestaña «Datos generales» de `b/estates/:id` como el mockup (tarjetas por tema, cada una con su «Editar»), aprovechando lo que ya existe.
Rama: `feat/general-data-panel` (desde `main`, sin push). Tests: `npx ng test --no-watch` (front); backend con `DATABASE_URL` de la BD de pruebas. Entrega: commits por unidad, sin push.
ESTADO: IMPLEMENTADO Y VERIFICADO (L10).

## Specs (provisionales: nada está aprobado todavía)

- S1: Buscador «Buscar en datos generales (campos, notas, documentos…)» que filtra las tarjetas en el cliente.
- S2: Tarjetas del mockup: Datos de la comunidad, Dirección y ubicación, Contactos clave, Datos fiscales / administrativos, Cuenta bancaria, Documentos esenciales, Presidente y cargos, Administrador asignado, Referencia catastral, Coeficientes, Seguros básicos y Observaciones. SOLO LECTURA (D6, L6): «No existe edición desde esta pestaña. Solo se visualizarán los datos». Sin botones «Editar», «Añadir», «Subir» ni «Cambiar»; los datos se mantienen en sus módulos de origen.
- S3: La tarjeta «Acreedor SEPA» actual se conserva (reubicada); el IBAN SEPA sigue cifrado y enmascarado.
- S4: Lo derivable no se guarda: nº de propiedades, coeficientes (suma, mayor, menor), m² construidos, ejercicio fiscal, cuenta contable, entidad bancaria (por el IBAN) y administrador.
- S5: Cambios de esquema aditivos y opcionales; hay que aplicar la migración (`prisma migrate deploy`) en la BD de desarrollo.
- S7 (Q1, L7): «Si, se editarán desde ese menú. Agregalos»: los campos nuevos de `Estate` (`yearBuilt`, `mainUse`, `internalRef`, `taxRegime`, `applicableLaw`, `notes`) se editan en el modal «Editar finca» del menú «Acciones»; la pestaña solo los muestra.
- S6 (D2, L4): «Incluyelo de ese modo en el plan»: mapa embebido de OpenStreetMap en «Dirección y ubicación».
  - S6.1 Coordenadas de la finca guardadas en `Estate` (latitud, longitud y su origen), obtenidas en el backend al guardar la dirección o la referencia catastral: primero del Catastro por la referencia catastral de la parcela; si no hay referencia o no responde, de Nominatim por la dirección (máx. 1 petición/s, identificando la aplicación, sin usos masivos). Nunca desde el navegador.
  - S6.2 Mapa con Leaflet y teselas de OpenStreetMap, cargado solo en esta pestaña, con la atribución «© OpenStreetMap» visible.
  - S6.3 Proveedor de teselas configurable (URL y atribución) para cambiar a un proveedor basado en OSM (MapTiler, Stadia, Carto…) sin tocar código.
  - S6.4 CSP de `nginx.conf`: añadir el servidor de teselas a `img-src`.
  - S6.5 Política de privacidad: mencionar que el mapa carga imágenes de un tercero (ve la IP del navegador; no usa cookies).
  - S6.6 Sin coordenadas, la tarjeta muestra la dirección y el enlace «Ver en mapa» (openstreetmap.org por dirección), sin mapa.
  - S6.7 Modo demo: sin llamadas al Catastro ni a Nominatim (las coordenadas de las fincas demo vienen en el seed).

## Brecha respecto a lo que hay hoy

Hoy: una tarjeta con 9 campos (nombre, tipo, dirección, localidad, CIF, ref. catastral, fondo de reserva, IBAN, descripción) + `SepaTabComponent`; editar abre el modal general de la finca.

| Tarjeta | Ya existe | Falta |
|---|---|---|
| Buscador | — | Filtro cliente sobre el texto de las tarjetas |
| Datos de la comunidad | nombre, tipo, descripción, nº de propiedades (derivable) | `yearBuilt`, `mainUse`, `internalRef`; el estado sale de la cabecera |
| Dirección y ubicación | dirección, CP, población, provincia | Coordenadas (no se guardan hoy; el Catastro tampoco las extrae) y mapa embebido (S6) |
| Contactos clave | — | Modelo nuevo |
| Datos fiscales | CIF, `FiscalYear`, plan contable | `taxRegime`, `applicableLaw` (LPH por defecto); idioma descartado (propuesto) |
| Cuenta bancaria | `Estate.iban`, `BankAccount`, IBAN SEPA cifrado | Entidad deducida del IBAN, titular = la comunidad |
| Presidente y cargos | firmas de acta presidente/secretario (`Meeting`) | Modelo nuevo con fechas de cargo |
| Administrador asignado | `Administrator` (nombre, contacto, teléfono, correo) | Solo lectura; sin «Cambiar» (es del rol A) |
| Documentos esenciales | `Document` (tipo libre), subida y descarga en `documentos-tab` | Catálogo de tipos (Escritura, Estatutos, CIF, IBI, Póliza) y listado fijado |
| Referencia catastral | `cadastralReference` (parcela, 14 car.) | Superficie de parcela (del Catastro); la construida se suma de `Property.builtAreaM2` |
| Coeficientes | `Property.coefficient` (LPH art. 5) | Resumen derivado |
| Seguros básicos | proveedores «Seguros», `SupplierDocument` tipo Seguro | Modelo ligero (tipo, aseguradora, nº póliza, renovación) |
| Observaciones | `description` (600 car., se ve en el Resumen) | Campo `notes` aparte |

## Tareas

| ID | S | Unidad | Ruta | Estado | Commit |
|---|---|---|---|---|---|
| G1 | S2,S5 | Campos de datos generales en `Estate` + migración + DTO | inline | hecho | 6d5350a |
| G2 | S4 | `GET estates/:id/general-overview` (incluye la parte de backend de G5) | inline | hecho | 60b1ced |
| G3 | S2 | Marca «contacto clave» por persona y propiedad + `PUT key-contacts` | inline | hecho | 32d8b6f |
| G4 | S2 | `contractNumber` en contratos (backend y formulario) | inline | hecho | 63c684b |
| G5 | S2 | Tipos de documento esencial (frontend; backend en G2) | inline | hecho | 1181f77 |
| G6 | — | Fase demo F6 con aserción de cifras | inline | hecho | 2b67ee4 |
| G13 | S6.1,S6.7 | Ubicación: Catastro `Consulta_CPMRC` + WFS de parcelas, Nominatim de respaldo | inline | hecho | b59e1ab, ca003ac |
| G14 | S6.2–S6.6 | Mapa Leaflet, teselas configurables, CSP, privacidad | inline | hecho | 79de6a0 |
| G7–G9, G11 | S1–S4 | Pestaña de solo lectura con 12 tarjetas y buscador | inline | hecho | 1c982f6 |
| G10 | S2 | Diálogo «Contactos clave» en el menú de cada propiedad | inline | hecho | 46ee25a |
| G15 | S7 | Campos nuevos en «Editar finca» | inline | hecho | 66b911e |
| G12 | S3,S5 | Documentación, verificación y correcciones | inline + verificador independiente | hecho | 2515408, 2e6bcae, e28790c, af6d5e6 |

## Decisiones pendientes (por petición del usuario: se resuelven más adelante)

- **D1 — Contactos clave y Presidente y cargos. RESUELTA (L5):** «PAra los cargos los puedes derivar de los mandatos. En cuanto a los contactos será aquellos que sean marcados como favoritos en el listado de propiedades.» Cargos = mandatos vigentes (`EstateOfficeTerm`). Contactos clave = los marcados como favoritos en el listado de Propiedades (no hay tabla `EstateContact`). El favorito es una persona de la propiedad (Q2).
- **D2 — Mapa. RESUELTA (L4):** mapa embebido de OpenStreetMap con coordenadas del Catastro (Nominatim de respaldo) y proveedor de teselas configurable. Ver S6, G13 y G14.
- **D3 — Alcance de los datos fiscales. RESUELTA (L5):** «Me parece correcta la decisión»: añadir solo `taxRegime` y `applicableLaw` (LPH por defecto); año fiscal y cuenta contable derivados; sin «Idioma de comunicación».
- **D4 — Seguros. RESUELTA (L6):** «Lo cerramos de ese modo»: un seguro es un `SupplierContract` con un proveedor de categoría «Seguros» (la aseguradora). Tipo = `serviceType`; vigencia y renovación = fechas y `renewalType`; prima = `costAmount`/`costFrequency`; póliza en PDF = documento del contrato; se añade `contractNumber` (nº de póliza); cobertura en `notes` por ahora. No confundir con `SupplierDocumentType.Seguro`, que es el seguro del propio proveedor.
- **D5 — Administrador asignado. RESUELTA (L6):** «Confirmado, solo lectura».
- **D6 — Edición. RESUELTA (L6):** «No existe edición desde esta pestaña. Solo se visualizarán los datos».

## Dudas abiertas

- **Q1 — Dónde se editan los campos nuevos de la finca. RESUELTA (L7):** «Si, se editarán desde ese menú. Agregalos»: en el modal «Editar finca» del menú «Acciones» (`estate-detail.component`, `openEditEstate`).
- **Q2 — Favorito (D1). RESUELTA (L8):** «Sobre favoritos se refiere a una persona de la propiedad, no la propiedad». Se marca a una persona concreta (titular con cuenta o titular importado sin cuenta) dentro de su propiedad; la tarjeta «Contactos clave» muestra a esa persona con su propiedad, teléfono y correo. Si la misma persona está marcada en dos propiedades de la finca, aparece una vez.


## Log

- L1 (2026-10-17): "Analiza la imagen y teniendo en cuenta las funcionalidades actuales de la aplicación, traza un plan pormenorizado que ayude a ir creando cada uno de los componentes que se deberían crear para el panel de datos generales de una finca para un administrador de fincas (rol b)" (mockup «Residencial Plaza» con buscador y 12 tarjetas).
- L2 (2026-10-17): "De momento deja estas decisiones pendientes de resolver mas adelante. Documentalas por si es necesario recuperarlas en el futuro" (en respuesta a la pregunta de D1: unificar contactos y cargos).
- Nota (código actual): `GeneralTabComponent` (`estate-detail/general-tab/`) pinta 9 campos de `Estate` y monta `app-sepa-tab`; la foto de la finca ya se sube desde «Editar finca» (commits `fca476a`, `d0cb12f`); la pestaña de Proveedores ya sigue el patrón panel + modales (`proveedores-panel.md`), que sirve de referencia de estructura (componentes por tarjeta, spec por componente, datos de demo con aserción).
- L3 (2026-10-21): análisis al retomar. Ninguna unidad empezada (no existen `yearBuilt`, `notes`, `EstateContact`, `EstateInsurance`; la pestaña sigue con 9 campos). Los cargos ya existen (`odd/tasks/cargos-comunidad.md`, PR 38), lo que cambia la recomendación de D1. Los botones sueltos de la cabecera del mockup siguen en el menú «Acciones» (`acciones-finca-menu.md`).
- L4 (2026-10-21): "D2. Es posible llevar a cabo la integración con OpenStreetMaps?" → análisis (geocodificación, teselas, CSP, privacidad) y recomendación de mapa embebido con coordenadas del Catastro. Respuesta del usuario: "Incluyelo de ese modo en el plan". D2 resuelta; añadidas S6, G13 y G14.
- L5 (2026-10-21): "D1. PAra los cargos los puedes derivar de los mandatos. En cuanto a los contactos será aquellos que sean marcados como favoritos en el listado de propiedades. D3. Me parece correcta la decisión. D4. Estoy valorando extraer esta información del módulo de proveedores o contatos ya que un seguro tendrá un contrato o un proveedor (aseguradora). Ayudame a tomar una decisión en este sentido para saber cual encaja mejor a nivel funcional"
- L6 (2026-10-21): "D4: Lo cerramos de ese modo / D5: Confirmado, solo lectura / D6: No existe edición desde esta pestaña. Solo se visualizarán los datos"
- L7 (2026-10-21): "Si, se editarán desde ese menú. Agregalos" (Q1). Añadidas S7 y G15.
- L8 (2026-10-21): "Quería que los agregaras al plan. Sobre favoritos se refiere a una persona de la propiedad, no la propiedad" (Q1 era solo para el plan; Q2 resuelta).
- L9 (2026-10-21): "Arranca el plan al completo".
- L10 (2026-10-21): plan implementado en `feat/general-data-panel`.
  - Decisiones de implementación: un único endpoint de lectura (`general-overview`); la pestaña es de solo lectura salvo la tarjeta SEPA, que se conserva tal cual (S3 es anterior a D6 y su formulario es el único sitio para configurar el acreedor); los contactos clave se marcan con una opción «Contactos clave» que abre un diálogo con un interruptor por titular (cubre el selector de copropiedad), en vez de dos opciones sueltas; «Editar»/enlace a Propiedades sustituidos por un texto de ayuda y «Ver historial de cargos» (D6); la ubicación se recalcula solo si la dirección o la referencia cambian de verdad, y las fincas antiguas se ubican la primera vez que se abre la pestaña; `Referrer-Policy: no-referrer` global se mantiene y solo las teselas envían el origen (política de teselas de OSM).
  - Verificación: backend 2549 tests (los 5 de `manager-performance` fallaron solo en paralelo con el verificador y pasan aislados), frontend 2795 (el `NG0205` de `layout` ya existía), `ng build` sin errores (aviso de presupuesto del SCSS del mapa por la hoja de Leaflet), semilla demo completa en una BD temporal con la aserción de F6 superada, navegador en oscuro, claro y móvil (sin desbordamiento), teselas con `Referer` de origen. RED observado en backend (DTO, contactos clave, `general-overview`, `contractNumber`, ubicación, notas para rol C) y en «Editar finca»; el resto del frontend se escribió con su spec.
  - Verificador independiente: 1 bloqueante corregido (2e6bcae: los propietarios recibían `notes` e `internalRef` por `GET /estates`, `GET /estates/:id` y la ficha de propiedad). Avisos corregidos: texto de privacidad, normativa vaciada que volvía a la LPH, `role` del mapa, búsqueda sobre etiquetas visibles. Avisos pendientes: las coordenadas de la respuesta tras cambiar la dirección son las anteriores hasta recargar; el límite de 1 petición/s de Nominatim es por proceso; los diálogos no encierran el foco; cambiar de proveedor de teselas exige recompilar y tocar nginx.
  - Migraciones aplicadas en `domora_demo_inst` (incluidas las 5 de juntas de la PR 37 que estaban pendientes).
  - Risk: item 1 (4 migraciones aditivas), item 2 (datos internos ocultos al rol C, CSP), item 3 (`PUT key-contacts`, `contractNumber`, campos nuevos en `GET /estates`), item 5 (dependencia `leaflet`, CSP de nginx).
