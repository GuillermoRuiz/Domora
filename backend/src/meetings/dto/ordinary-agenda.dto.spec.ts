import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMeetingDto } from './create-meeting.dto';
import { UpdateMeetingDto } from './update-meeting.dto';

describe('ordinary agenda metadata through the API whitelist', () => {
  const agenda = [
    { id: 'a', title: 'Cuentas editadas', systemKey: 'annual_accounts_approval', systemGenerated: true, hasVote: false, description: 'Detalle' },
    { id: 'b', title: 'Presupuesto', systemKey: 'annual_budget_approval', systemGenerated: true, hasVote: false },
    { id: 'c', title: 'Cargos', systemKey: 'community_officers_appointment', systemGenerated: true, hasVote: false },
    { id: 'd', title: 'Manual', comments: 'Notas' },
  ];

  it('keeps metadata and user data on create, JSON storage and update', async () => {
    const create = plainToInstance(CreateMeetingDto, {
      title: 'Junta', type: 'ordinaria', scheduledAt1: '2027-01-01T18:00:00Z',
      scheduledAt2: '2027-01-01T18:30:00Z', agenda, convokedBy: 'presidente', signerRole: 'administrador',
      attendeeEmails: [], includeJitsi: false,
    });
    expect(await validate(create, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    const stored = JSON.parse(JSON.stringify(create.agenda));
    const update = plainToInstance(UpdateMeetingDto, { agenda: stored, type: 'extraordinaria' });
    expect(await validate(update, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(JSON.parse(JSON.stringify(update.agenda))).toEqual(agenda);
  });

  it('rejects unknown keys', async () => {
    const update = plainToInstance(UpdateMeetingDto, { agenda: [{ id: 'a', title: 'Punto', systemKey: 'unknown' }] });
    expect(await validate(update, { whitelist: true })).not.toEqual([]);
  });
});
