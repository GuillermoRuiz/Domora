import { AiOutputService } from './ai-output.service';

const validator = new AiOutputService();

describe('AI output trust boundary', () => {
  it('rechaza respuestas incompletas y rechazos del modelo', () => {
    expect(() =>
      validator.parseResponse('invoice-extraction', { status: 'incomplete', output: [] }),
    ).toThrow();
    expect(() =>
      validator.parseResponse('invoice-extraction', {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal' }] }],
      }),
    ).toThrow();
  });

  it.each([
    'invoice-extraction',
    'reconciliation-review',
    'weekly-intelligence',
  ] as const)('carga las instrucciones activas para %s', (kind) => {
    expect(validator.prompt(kind)).toContain('Prompt version: 2');
  });
});
