import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateInspectionDto } from '../inspections/dto/update-inspection.dto';
import { UpdateCorrectiveActionDto } from '../inspections/dto/update-corrective-action.dto';
import { UpdateStaffMemberDto } from '../staff/dto/update-staff-member.dto';
import { UpdateAmenityDto } from '../amenities/dto/update-amenity.dto';
import { UpdateCostCentreDto } from '../cost-centres/dto/update-cost-centre.dto';
import { UpdateAgendaTaskDto } from '../agenda-tasks/dto/update-agenda-task.dto';
import { dateOrNull } from './date-or-null';

const errorsFor = async <T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) => (await validate(plainToInstance(cls, body))).map((e) => e.property).sort();

describe('PATCH: un null en una columna obligatoria es un 400; en una opcional, vaciarla', () => {
  it('inspecciones: status y reminderDaysBefore no admiten null; las fechas sí (borrarlas)', async () => {
    expect(
      await errorsFor(UpdateInspectionDto, {
        status: null,
        reminderDaysBefore: null,
      }),
    ).toEqual(['reminderDaysBefore', 'status']);
    expect(
      await errorsFor(UpdateInspectionDto, {
        nextDueDate: null,
        appointmentDate: null,
        lastDoneDate: null,
        notes: null,
      }),
    ).toEqual([]);
  });

  it('acciones correctivas: title, priority y status no admiten null; dueDate, responsable y proveedor sí', async () => {
    expect(
      await errorsFor(UpdateCorrectiveActionDto, {
        title: null,
        priority: null,
        status: null,
      }),
    ).toEqual(['priority', 'status', 'title']);
    expect(
      await errorsFor(UpdateCorrectiveActionDto, {
        dueDate: null,
        description: null,
        assigneeUserId: null,
        supplierId: null,
      }),
    ).toEqual([]);
  });

  it('personal: nombre, puesto, contrato, inicio y estado no admiten null; fin, teléfono, email y coste sí', async () => {
    expect(
      await errorsFor(UpdateStaffMemberDto, {
        fullName: null,
        position: null,
        contractType: null,
        startDate: null,
        status: null,
      }),
    ).toEqual(['contractType', 'fullName', 'position', 'startDate', 'status']);
    expect(
      await errorsFor(UpdateStaffMemberDto, {
        endDate: null,
        phone: null,
        email: null,
        nationalId: null,
        schedule: null,
        monthlyCost: null,
      }),
    ).toEqual([]);
  });

  it('zonas comunes y centros de coste: sus columnas obligatorias no admiten null', async () => {
    expect(
      await errorsFor(UpdateAmenityDto, {
        name: null,
        maxHours: null,
        slots: null,
        capacity: null,
        seasonal: null,
        active: null,
      }),
    ).toEqual(['active', 'capacity', 'maxHours', 'name', 'seasonal', 'slots']);
    expect(
      await errorsFor(UpdateAmenityDto, {
        icon: null,
        color: null,
        bg: null,
        rules: null,
        seasonLabel: null,
      }),
    ).toEqual([]);
    expect(
      await errorsFor(UpdateCostCentreDto, { name: null, status: null }),
    ).toEqual(['name', 'status']);
    expect(await errorsFor(UpdateCostCentreDto, { description: null })).toEqual(
      [],
    );
  });

  it('agenda de tareas: título, tipo, prioridad, fechas, todo el día y zona horaria no admiten null; los opcionales sí', async () => {
    expect(
      await errorsFor(UpdateAgendaTaskDto, {
        title: null,
        type: null,
        priority: null,
        startAt: null,
        endAt: null,
        allDay: null,
        timezone: null,
      }),
    ).toEqual([
      'allDay',
      'endAt',
      'priority',
      'startAt',
      'timezone',
      'title',
      'type',
    ]);
    expect(
      await errorsFor(UpdateAgendaTaskDto, {
        description: null,
        estateId: null,
        assignedToUserId: null,
        reminderMinutesBefore: null,
      }),
    ).toEqual([]);
  });

  it('dateOrNull: null borra el valor y no se convierte en 1970-01-01', () => {
    expect(dateOrNull(null)).toBeNull();
    expect(dateOrNull('2026-11-01')?.toISOString().slice(0, 10)).toBe(
      '2026-11-01',
    );
  });
});
