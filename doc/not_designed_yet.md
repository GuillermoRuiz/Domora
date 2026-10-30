# Inventario de funcionalidad sin cablear

> Reauditado el 2026-08-13 contra el código real (el inventario original era
> del commit inicial del repositorio y quedó desactualizado tras varios
> commits de "wire dead buttons" y trabajo posterior de contabilidad,
> adjuntos, alertas y proveedores/personal). La mayoría de los ~30 puntos
> originales ya están resueltos. Esto es solo lo que sigue sin funcionalidad
> real hoy.

## Roto

1. ~~**Alertas del propietario (rol C) — 6 CTAs sin ningún handler.**~~
   Resuelto (revisado el 2026-10-30): todos los CTAs de
   `src/app/features/alertas-c/alertas-c.component.html` llaman a
   `goToSource()` y navegan a su módulo (Recibos y pagos, Juntas/sala de
   espera, Documentación, Incidencias o la pestaña Comunicados).
2. **"Editar" en el menú contextual de un recibo.**
   `src/app/features/accounting/recibos-tab/recibos-tab.component.ts:224`.
   Solo `showToast`, sin formulario de edición.
3. **"Descargar" en un recibo pagado (detalle de propiedad).**
   `src/app/features/property-detail/property-detail.component.html:222`.
   Botón sin `(click)` en absoluto.
4. **"Adjuntar documento" en el modal "Nuevo apunte".**
   `src/app/features/accounting/movimientos-tab/movimientos-tab.component.html:301-304`.
   Marcado honestamente "(próximamente)", sin lógica de subida.

## Parcial

5. **CTAs de alertas del administrador (rol B) para los tipos `junta`,
   `documento` y `comunidad`.**
   `src/app/features/alertas-b/alertas-b.component.ts:101-103`
   (`hasSourceLink`). Solo `pago` e `incidencia` navegan de verdad; las otras
   tres categorías no muestran ningún CTA (ni roto: directamente no aparece).

## Sin construir (no es un botón roto — la funcionalidad no existe)

6. "Exportar libro" y "Nuevo apunte" en la cabecera de Contabilidad,
   "Exportar Excel" en la pestaña Resumen. Estos elementos no existen en el
   HTML actual, tampoco existían en el commit inicial. El documento original
   parece no corresponder a la UI real de estos puntos. Si se quieren, hay
   que construirlos desde cero — no es un "cableado".
