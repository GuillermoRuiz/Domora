/**
 * Cartera ampliada del demo: 7 fincas más (con las 3 de F1 son 10) con perfiles
 * de facturación, cobro e incidencias distintos, para que la «Vista general»
 * del gestor tenga datos con sentido. Datos FICTICIOS; las fechas son offsets
 * en días respecto al ancla del seed (negativo = pasado).
 */
export interface PortfolioAsset {
  name: string;
  category: string;
  location: string;
  operationalStatus: 'operativa' | 'en_mantenimiento' | 'fuera_de_servicio';
  /** Código del catálogo global de tipos de inspección. */
  typeCode: string;
  lastDoneDaysAgo: number | null;
  /** Días hasta la próxima revisión (negativo = vencida). */
  dueInDays: number | null;
}

export interface PortfolioIssue {
  title: string;
  type: 'Averia' | 'Fuga' | 'Seguridad' | 'Ruido' | 'Limpieza' | 'DanoEstructural' | 'Otro';
  priority: 'Normal' | 'Urgente';
  status: 'Abierta' | 'EnReparacion' | 'PendienteProveedor' | 'Resuelta' | 'Cerrada';
  createdAgoDays: number;
  /** Solo si ya está cerrada o resuelta: cuántos días hace que se resolvió. */
  resolvedAgoDays?: number;
  /** Texto del aviso; si falta, se usa «<título>. Registrada por la administración.». */
  description?: string;
  /** Quién la abre: el propietario (la primera entrada del historial es suya) o la comunidad. Por defecto, la comunidad. */
  source?: 'Propietario' | 'Comunidad';
  /** Categoría de uno de los `contracts` de la finca: su proveedor queda asignado a la incidencia. */
  supplierCategory?: string;
  /** Días hasta la resolución estimada del proveedor (solo con `supplierCategory`). */
  etaInDays?: number;
  budget?: { amount: number; description: string; approved: boolean };
  /** Comentario intermedio de la administración en el historial. */
  note?: string;
  /** Hace cuántos días se notificó la incidencia a los propietarios (un envío por valor). */
  notifiedAgoDays?: number[];
}

export interface PortfolioEstate {
  key: string;
  name: string;
  viaType: 'Calle' | 'Avenida' | 'Paseo';
  viaName: string;
  streetNumber: string;
  postalCode: string;
  municipality: string;
  province: string;
  color: string;
  floors: number;
  doors: number;
  /** Presupuesto ordinario MENSUAL (céntimos). */
  monthlyBudgetCents: number;
  bankCode: string;
  /** Meses desde el alta en Domora; el historial de recibos nunca es mayor. */
  ageMonths: number;
  /** Periodos de recibos antes del mes en curso. */
  historyMonths: number;
  /** Propiedades con un recibo devuelto (el del mes anterior). */
  returnedUnits: number;
  /** Propiedades con recibos sin pagar y ya vencidos (varios meses). */
  overdueUnits: number;
  /** Derrama puntual: importe por propiedad (céntimos), hace cuántos meses y cuántas propiedades no la han pagado. */
  derrama?: { amountCents: number; monthsAgo: number; unpaidUnits: number };
  /** Aportación al fondo de reserva por propiedad (céntimos), emitida y cobrada hace 3 meses. */
  reserveUnitCents?: number;
  assets: PortfolioAsset[];
  /** Contratos de proveedor de la finca: categoría y días hasta su vencimiento. */
  contracts: { category: string; endInDays: number }[];
  issues: PortfolioIssue[];
  /** Solicitudes de adhesión pendientes: hace cuántos días se enviaron. */
  adhesionAgoDays: number[];
  meetings: {
    /** Días hasta cada junta convocada. */
    upcoming: number[];
    /** Hace cuántos días se celebró cada junta pasada. */
    past: number[];
  };
}

export const PORTFOLIO: readonly PortfolioEstate[] = [
  {
    key: 'p1', name: 'Residencial Los Olivos', viaType: 'Calle', viaName: 'del Olivo', streetNumber: '12', postalCode: '28013',
    municipality: 'Madrid', province: 'Madrid', color: '#3F7D5C', floors: 3, doors: 3, monthlyBudgetCents: 540_000,
    bankCode: '0049', ageMonths: 14, historyMonths: 9, returnedUnits: 0, overdueUnits: 0,
    reserveUnitCents: 25_000,
    assets: [{ name: 'Ascensor', category: 'Ascensor', location: 'Portal', operationalStatus: 'operativa', typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 150, dueInDays: 215 }],
    contracts: [{ category: 'Ascensores', endInDays: 120 }, { category: 'Seguridad', endInDays: 24 }],
    issues: [
      {
        title: 'Luz del portal fundida', type: 'Averia', priority: 'Normal', status: 'Resuelta', createdAgoDays: 210, resolvedAgoDays: 200,
        description: 'La luminaria del portal lleva varios días fundida y la entrada queda a oscuras por la noche.',
        source: 'Propietario', note: 'Se ha sustituido la luminaria por una LED de bajo consumo.', notifiedAgoDays: [208],
      },
      {
        title: 'Humedad en el garaje', type: 'Fuga', priority: 'Normal', status: 'Abierta', createdAgoDays: 20,
        description: 'Aparecen manchas de humedad en el techo de las plazas 3 y 4 del garaje tras las últimas lluvias.',
        source: 'Propietario', notifiedAgoDays: [18],
      },
      {
        title: 'Ascensor con ruido al frenar', type: 'Averia', priority: 'Normal', status: 'EnReparacion', createdAgoDays: 12,
        description: 'El ascensor emite un chirrido metálico al frenar en cada parada, sobre todo en la planta 3.',
        source: 'Propietario', supplierCategory: 'Ascensores', etaInDays: 6,
        budget: { amount: 380, description: 'Sustitución de zapatas de freno y engrase de guías', approved: true },
        note: 'El técnico ha confirmado el desgaste de las zapatas; se repone la pieza esta semana.', notifiedAgoDays: [10],
      },
      {
        title: 'Cerradura del cuarto de basuras rota', type: 'Seguridad', priority: 'Normal', status: 'Cerrada', createdAgoDays: 95, resolvedAgoDays: 80,
        description: 'La cerradura del cuarto de basuras no cierra y cualquiera puede acceder.',
        supplierCategory: 'Seguridad', budget: { amount: 85, description: 'Cambio de bombín y llaves', approved: true }, notifiedAgoDays: [93],
      },
      {
        title: 'Limpieza de la escalera tras obras', type: 'Limpieza', priority: 'Normal', status: 'Resuelta', createdAgoDays: 40, resolvedAgoDays: 35,
        description: 'Quedan restos de escombro y polvo en la escalera tras la reforma de un piso.',
        source: 'Propietario',
      },
    ],
    adhesionAgoDays: [3, 200],
    meetings: { upcoming: [38, 150], past: [75, 190] },
  },
  {
    key: 'p2', name: 'Edificio Mediterráneo', viaType: 'Avenida', viaName: 'del Mar', streetNumber: '45', postalCode: '46023',
    municipality: 'Valencia', province: 'Valencia', color: '#2F6F8F', floors: 3, doors: 3, monthlyBudgetCents: 680_000,
    bankCode: '2100', ageMonths: 18, historyMonths: 9, returnedUnits: 2, overdueUnits: 3,
    derrama: { amountCents: 95_000, monthsAgo: 4, unpaidUnits: 4 },
    assets: [
      { name: 'Ascensor', category: 'Ascensor', location: 'Portal', operationalStatus: 'fuera_de_servicio', typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 330, dueInDays: -12 },
      { name: 'Caldera de calefacción', category: 'Calefacción', location: 'Sala de calderas', operationalStatus: 'operativa', typeCode: 'RITE_SALA_CALDERAS', lastDoneDaysAgo: 300, dueInDays: 18 },
    ],
    contracts: [{ category: 'Ascensores', endInDays: 9 }, { category: 'Calefacción', endInDays: 60 }],
    issues: [
      {
        title: 'Ascensor fuera de servicio', type: 'Averia', priority: 'Urgente', status: 'PendienteProveedor', createdAgoDays: 6,
        description: 'El ascensor se ha quedado parado en la planta 2 y no responde a la botonera. Hay vecinos con movilidad reducida.',
        source: 'Propietario', supplierCategory: 'Ascensores', etaInDays: 4,
        budget: { amount: 2850, description: 'Sustitución del cuadro de maniobra', approved: false },
        note: 'Pendiente de que el proveedor confirme la fecha de entrega del cuadro de maniobra.', notifiedAgoDays: [6, 2],
      },
      {
        title: 'Goteras en la cubierta', type: 'Fuga', priority: 'Urgente', status: 'EnReparacion', createdAgoDays: 150,
        description: 'Entra agua en el último piso cuando llueve; hay humedad en el falso techo del rellano.',
        etaInDays: 15, budget: { amount: 4200, description: 'Impermeabilización parcial de la cubierta', approved: true },
        note: 'Obras de impermeabilización iniciadas; la finalización depende del tiempo.', notifiedAgoDays: [148, 90, 30],
      },
      {
        title: 'Ruido de la maquinaria', type: 'Ruido', priority: 'Normal', status: 'Abierta', createdAgoDays: 14,
        description: 'La maquinaria del ascensor hace un zumbido constante que se oye en los pisos superiores.',
        source: 'Propietario', notifiedAgoDays: [13],
      },
      {
        title: 'Puerta del portal averiada', type: 'Seguridad', priority: 'Normal', status: 'Resuelta', createdAgoDays: 230, resolvedAgoDays: 215,
        description: 'La puerta del portal no cierra bien y queda abierta, lo que compromete la seguridad del edificio.',
        budget: { amount: 160, description: 'Ajuste del cierrapuertas y sustitución de la cerradura', approved: true }, notifiedAgoDays: [228],
      },
      {
        title: 'Grieta en el muro del patio', type: 'DanoEstructural', priority: 'Normal', status: 'Abierta', createdAgoDays: 33,
        description: 'Ha aparecido una grieta vertical de unos 2 m en el muro del patio interior que parece crecer.',
        source: 'Propietario', note: 'Se solicitará informe a un arquitecto técnico.',
      },
      {
        title: 'Radiadores fríos en la planta 2', type: 'Averia', priority: 'Normal', status: 'PendienteProveedor', createdAgoDays: 25,
        description: 'Los radiadores de la planta 2 no calientan; el resto del edificio funciona con normalidad.',
        source: 'Propietario', supplierCategory: 'Calefacción', etaInDays: 9,
        budget: { amount: 1200, description: 'Purgado del circuito y sustitución de una válvula de zona', approved: false }, notifiedAgoDays: [24],
      },
      {
        title: 'Pintadas en la fachada', type: 'Limpieza', priority: 'Normal', status: 'Resuelta', createdAgoDays: 80, resolvedAgoDays: 70,
        description: 'Han aparecido pintadas en la fachada de la calle lateral.', notifiedAgoDays: [78],
      },
    ],
    adhesionAgoDays: [10, 4],
    meetings: { upcoming: [12, 95], past: [60, 150] },
  },
  {
    key: 'p3', name: 'Residencial Parque Norte', viaType: 'Calle', viaName: 'Estación', streetNumber: '4', postalCode: '28029',
    municipality: 'Madrid', province: 'Madrid', color: '#7A4B8C', floors: 4, doors: 2, monthlyBudgetCents: 890_000,
    bankCode: '0182', ageMonths: 20, historyMonths: 9, returnedUnits: 1, overdueUnits: 0,
    derrama: { amountCents: 140_000, monthsAgo: 3, unpaidUnits: 0 },
    reserveUnitCents: 40_000,
    assets: [
      { name: 'Ascensor A', category: 'Ascensor', location: 'Portal 1', operationalStatus: 'operativa', typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 100, dueInDays: 265 },
      { name: 'Sistema contra incendios', category: 'PCI', location: 'Zonas comunes', operationalStatus: 'en_mantenimiento', typeCode: 'PCI_EXTINTORES', lastDoneDaysAgo: 175, dueInDays: 5 },
    ],
    contracts: [{ category: 'Protección contra incendios', endInDays: 30 }],
    issues: [
      {
        title: 'Revisión de extintores pendiente', type: 'Seguridad', priority: 'Normal', status: 'EnReparacion', createdAgoDays: 9,
        description: 'Varios extintores de las zonas comunes tienen la revisión anual caducada.',
        supplierCategory: 'Protección contra incendios', etaInDays: 5,
        budget: { amount: 310, description: 'Revisión y recarga de 14 extintores', approved: true }, notifiedAgoDays: [8],
      },
      {
        title: 'Puerta cortafuegos descolgada', type: 'Seguridad', priority: 'Urgente', status: 'Abierta', createdAgoDays: 4,
        description: 'La puerta cortafuegos de la escalera 1 está descolgada y no cierra por sí sola.',
        source: 'Propietario', notifiedAgoDays: [3],
      },
      {
        title: 'Fuga en la bajante del portal 1', type: 'Fuga', priority: 'Normal', status: 'Resuelta', createdAgoDays: 70, resolvedAgoDays: 60,
        description: 'Gotea agua desde la bajante en el techo del portal 1.', source: 'Propietario',
        note: 'Reparada la junta de la bajante.', notifiedAgoDays: [68],
      },
      {
        title: 'Ruido nocturno en la zona común', type: 'Ruido', priority: 'Normal', status: 'Cerrada', createdAgoDays: 120, resolvedAgoDays: 100,
        description: 'Se reciben quejas por ruido nocturno en la zona común del jardín.', source: 'Propietario',
        note: 'Se ha recordado a los vecinos el horario de uso de las zonas comunes.',
      },
    ],
    adhesionAgoDays: [],
    meetings: { upcoming: [45], past: [30, 110, 165] },
  },
  {
    key: 'p4', name: 'Comunidad Sol y Mar', viaType: 'Paseo', viaName: 'Marítimo', streetNumber: '58', postalCode: '29016',
    municipality: 'Málaga', province: 'Málaga', color: '#B0472B', floors: 3, doors: 3, monthlyBudgetCents: 420_000,
    bankCode: '0081', ageMonths: 11, historyMonths: 9, returnedUnits: 0, overdueUnits: 1,
    reserveUnitCents: 20_000,
    assets: [{ name: 'Piscina', category: 'Piscina', location: 'Azotea', operationalStatus: 'operativa', typeCode: 'LEGIONELLA_ACS', lastDoneDaysAgo: 40, dueInDays: 21 }],
    contracts: [{ category: 'Piscinas', endInDays: 200 }, { category: 'Limpieza', endInDays: 14 }],
    issues: [
      {
        title: 'Limpieza de la piscina', type: 'Limpieza', priority: 'Normal', status: 'Abierta', createdAgoDays: 3,
        description: 'El agua de la piscina está verdosa y hay hojas en el fondo.', source: 'Propietario', notifiedAgoDays: [2],
      },
      {
        title: 'Ducha de la piscina sin agua', type: 'Averia', priority: 'Normal', status: 'PendienteProveedor', createdAgoDays: 10,
        description: 'La ducha exterior de la piscina no tiene presión de agua.',
        supplierCategory: 'Piscinas', etaInDays: 7, budget: { amount: 240, description: 'Sustitución de la válvula y el flexo', approved: false },
        notifiedAgoDays: [9],
      },
      {
        title: 'Ruido de fiestas en la azotea', type: 'Ruido', priority: 'Normal', status: 'Resuelta', createdAgoDays: 45, resolvedAgoDays: 40,
        description: 'Varios vecinos se quejan de música alta en la azotea pasada la medianoche.', source: 'Propietario',
        note: 'Se ha enviado un comunicado recordando las normas de la azotea.', notifiedAgoDays: [42],
      },
      {
        title: 'Azulejos desprendidos en la entrada', type: 'DanoEstructural', priority: 'Normal', status: 'Abierta', createdAgoDays: 7,
        description: 'Se han desprendido varios azulejos del zócalo de la entrada y hay riesgo de corte.', source: 'Propietario',
      },
      {
        title: 'Limpieza de cristales de zonas comunes', type: 'Limpieza', priority: 'Normal', status: 'Cerrada', createdAgoDays: 60, resolvedAgoDays: 55,
        description: 'Los ventanales de la escalera llevan meses sin limpiarse.', supplierCategory: 'Limpieza',
        budget: { amount: 180, description: 'Limpieza especial de cristales', approved: true },
      },
    ],
    adhesionAgoDays: [8],
    meetings: { upcoming: [70], past: [100] },
  },
  {
    key: 'p5', name: 'Edificio Vallehermoso', viaType: 'Calle', viaName: 'Vallehermoso', streetNumber: '90', postalCode: '28003',
    municipality: 'Madrid', province: 'Madrid', color: '#4B6584', floors: 2, doors: 4, monthlyBudgetCents: 1_250_000,
    bankCode: '0128', ageMonths: 22, historyMonths: 9, returnedUnits: 1, overdueUnits: 2,
    derrama: { amountCents: 210_000, monthsAgo: 5, unpaidUnits: 2 },
    reserveUnitCents: 50_000,
    assets: [
      { name: 'Ascensor', category: 'Ascensor', location: 'Portal', operationalStatus: 'operativa', typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 250, dueInDays: 115 },
      { name: 'Grupo electrógeno', category: 'Electricidad', location: 'Sótano', operationalStatus: 'operativa', typeCode: 'GRUPO_ELECTROGENO', lastDoneDaysAgo: 280, dueInDays: 85 },
    ],
    contracts: [{ category: 'Ascensores', endInDays: 90 }, { category: 'Electricidad', endInDays: 27 }],
    issues: [
      {
        title: 'Cuadro eléctrico con chispazos', type: 'Seguridad', priority: 'Urgente', status: 'Abierta', createdAgoDays: 2,
        description: 'El cuadro eléctrico del sótano hace chispazos al conectar la luz de la escalera. Riesgo de incendio.',
        source: 'Propietario', notifiedAgoDays: [2],
      },
      {
        title: 'Fachada con desprendimientos', type: 'DanoEstructural', priority: 'Urgente', status: 'PendienteProveedor', createdAgoDays: 200,
        description: 'Se han caído trozos de revestimiento de la fachada a la acera. Se ha vallado la zona.',
        etaInDays: 40, budget: { amount: 18500, description: 'Reparación del revestimiento y andamio', approved: false },
        note: 'Pendiente de la aprobación del presupuesto en la próxima junta.', notifiedAgoDays: [198, 120, 45],
      },
      {
        title: 'Interfono averiado', type: 'Averia', priority: 'Normal', status: 'Cerrada', createdAgoDays: 190, resolvedAgoDays: 170,
        description: 'El interfono de varias viviendas no suena ni abre la puerta.', source: 'Propietario',
        budget: { amount: 220, description: 'Sustitución de la placa de calle', approved: true }, notifiedAgoDays: [188],
      },
      {
        title: 'Ascensor se detiene entre plantas', type: 'Averia', priority: 'Urgente', status: 'EnReparacion', createdAgoDays: 8,
        description: 'El ascensor se detiene unos segundos entre plantas con frecuencia y luego sigue.',
        source: 'Propietario', supplierCategory: 'Ascensores', etaInDays: 3,
        budget: { amount: 950, description: 'Cambio del variador de frecuencia', approved: true }, notifiedAgoDays: [7],
      },
      {
        title: 'Luz de emergencia sin batería', type: 'Seguridad', priority: 'Normal', status: 'Abierta', createdAgoDays: 11,
        description: 'Las luces de emergencia de la escalera no se encienden al cortar la corriente.',
      },
      {
        title: 'Fuga en el cuarto de contadores', type: 'Fuga', priority: 'Normal', status: 'Resuelta', createdAgoDays: 100, resolvedAgoDays: 92,
        description: 'Gotea agua de una llave de paso del cuarto de contadores.', note: 'Cambiada la llave de paso.', notifiedAgoDays: [99],
      },
    ],
    adhesionAgoDays: [1, 6, 12],
    meetings: { upcoming: [20, 130], past: [50, 170] },
  },
  {
    key: 'p6', name: 'Comunidad Castellana 14', viaType: 'Calle', viaName: 'Castellana', streetNumber: '14', postalCode: '28046',
    municipality: 'Madrid', province: 'Madrid', color: '#8C6A2F', floors: 4, doors: 2, monthlyBudgetCents: 980_000,
    bankCode: '2085', ageMonths: 4, historyMonths: 3, returnedUnits: 0, overdueUnits: 0,
    reserveUnitCents: 30_000,
    assets: [{ name: 'Ascensor', category: 'Ascensor', location: 'Portal', operationalStatus: 'operativa', typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 60, dueInDays: 305 }],
    contracts: [{ category: 'Ascensores', endInDays: 300 }],
    issues: [
      {
        title: 'Puerta del garaje atascada', type: 'Averia', priority: 'Normal', status: 'Abierta', createdAgoDays: 5,
        description: 'La puerta del garaje se queda atascada a mitad de recorrido al abrirla con el mando.',
        source: 'Propietario', notifiedAgoDays: [4],
      },
      {
        title: 'Mando del garaje sin funcionar', type: 'Averia', priority: 'Normal', status: 'Resuelta', createdAgoDays: 40, resolvedAgoDays: 33,
        description: 'Los mandos de dos plazas han dejado de abrir la puerta del garaje.', source: 'Propietario',
        note: 'Reprogramados los mandos y sustituida la pila del receptor.',
      },
      {
        title: 'Ruido en el patio interior', type: 'Ruido', priority: 'Normal', status: 'Abierta', createdAgoDays: 12,
        description: 'Se oye un golpeteo metálico constante en el patio interior cuando hay viento.', source: 'Propietario',
      },
      {
        title: 'Botonera del ascensor dañada', type: 'Averia', priority: 'Normal', status: 'EnReparacion', createdAgoDays: 18,
        description: 'Varios botones de la botonera del ascensor no responden.',
        supplierCategory: 'Ascensores', etaInDays: 8, budget: { amount: 150, description: 'Sustitución de la botonera de cabina', approved: true },
        notifiedAgoDays: [16],
      },
      {
        title: 'Falta de limpieza en el portal', type: 'Limpieza', priority: 'Normal', status: 'Cerrada', createdAgoDays: 60, resolvedAgoDays: 50,
        description: 'El portal lleva dos semanas sin limpiarse con el cuidado habitual.',
      },
    ],
    adhesionAgoDays: [2],
    meetings: { upcoming: [28], past: [] },
  },
  {
    key: 'p7', name: 'Urbanización Las Palmeras', viaType: 'Calle', viaName: 'de las Palmeras', streetNumber: '7', postalCode: '03001',
    municipality: 'Alicante', province: 'Alicante', color: '#2F6F6B', floors: 3, doors: 2, monthlyBudgetCents: 310_000,
    bankCode: '3058', ageMonths: 13, historyMonths: 9, returnedUnits: 0, overdueUnits: 2,
    assets: [{ name: 'Puerta de garaje', category: 'Accesos', location: 'Garaje', operationalStatus: 'operativa', typeCode: 'PUERTAS_GARAJE', lastDoneDaysAgo: 340, dueInDays: 26 }],
    contracts: [{ category: 'Jardinería', endInDays: 150 }],
    issues: [
      {
        title: 'Riego averiado', type: 'Averia', priority: 'Normal', status: 'Abierta', createdAgoDays: 220,
        description: 'El riego automático de la zona verde no se activa desde hace meses y el césped se está secando.',
        notifiedAgoDays: [218],
      },
      {
        title: 'Poda de palmeras pendiente', type: 'Otro', priority: 'Normal', status: 'EnReparacion', createdAgoDays: 30,
        description: 'Las palmeras del acceso tienen ramas secas que podrían caer sobre los coches.',
        source: 'Propietario', supplierCategory: 'Jardinería', etaInDays: 10,
        budget: { amount: 620, description: 'Poda y retirada de residuos de 9 palmeras', approved: true }, notifiedAgoDays: [28],
      },
      {
        title: 'Pérdida de agua en la fuente', type: 'Fuga', priority: 'Normal', status: 'Abierta', createdAgoDays: 16,
        description: 'La fuente del jardín pierde agua y deja el suelo encharcado.', source: 'Propietario',
      },
      {
        title: 'Puerta del garaje con ruido', type: 'Ruido', priority: 'Normal', status: 'Resuelta', createdAgoDays: 150, resolvedAgoDays: 140,
        description: 'La puerta del garaje chirría al abrir y cerrar.', note: 'Engrasados los herrajes y las guías.',
      },
      {
        title: 'Grieta en el muro perimetral', type: 'DanoEstructural', priority: 'Urgente', status: 'PendienteProveedor', createdAgoDays: 60,
        description: 'Se ha abierto una grieta en el muro perimetral junto a la calle, con riesgo de caída parcial.',
        source: 'Propietario', etaInDays: 25, budget: { amount: 3400, description: 'Refuerzo y recrecido del muro', approved: false },
        note: 'Pendiente de aprobación del presupuesto por la comunidad.', notifiedAgoDays: [58, 20],
      },
    ],
    adhesionAgoDays: [],
    meetings: { upcoming: [], past: [140] },
  },
];
