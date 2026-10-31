import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VoteQuestionDto } from './create-meeting.dto';

async function errorsFor(plain: Record<string, unknown>) {
  const dto = plainToInstance(VoteQuestionDto, {
    title: '¿Aprueba?',
    type: 'single_choice',
    options: ['Sí', 'No'],
    ...plain,
  });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('VoteQuestionDto optionColors', () => {
  it('accepts hex colors and empty strings (default color) in answer order', async () => {
    expect(await errorsFor({ optionColors: ['#3FA372', ''] })).toHaveLength(0);
  });

  it('is optional', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('rejects anything that is not a #RRGGBB color', async () => {
    expect(await errorsFor({ optionColors: ['red', ''] })).not.toHaveLength(0);
    expect(
      await errorsFor({ optionColors: ['url(javascript:alert(1))'] }),
    ).not.toHaveLength(0);
    expect(await errorsFor({ optionColors: ['#FFF'] })).not.toHaveLength(0);
  });
});
