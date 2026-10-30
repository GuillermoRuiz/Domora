import { ConfigService } from '@nestjs/config';
import { AiConfigService } from './ai-config.service';

const cfg = (env: Record<string, string>) =>
  new AiConfigService(new ConfigService({ NODE_ENV: 'test', ...env }));

const live = {
  AI_ENABLED: 'true',
  OPENAI_API_KEY: 'sk-test',
  OPENAI_MODEL: 'modelo-x',
};

describe('AiConfigService', () => {
  it('distingue IA desactivada, sin configurar y disponible', () => {
    expect(cfg({}).availability).toEqual({ available: false, reason: 'AI_DISABLED' });
    expect(cfg({ AI_ENABLED: 'true' }).availability).toEqual({
      available: false,
      reason: 'AI_NOT_CONFIGURED',
    });
    expect(cfg(live).availability).toEqual({ available: true });
  });

  it('falla cerrado cuando se exige región europea sin endpoint ni proyecto europeos', () => {
    expect(cfg({ ...live, AI_REQUIRE_REGION: 'eu' }).availability).toEqual({
      available: false,
      reason: 'AI_REGION_UNAVAILABLE',
    });
  });

  it('acepta el endpoint europeo con proyecto configurado', () => {
    const config = cfg({
      ...live,
      AI_REQUIRE_REGION: 'eu',
      OPENAI_BASE_URL: 'https://eu.api.openai.com/v1',
      OPENAI_PROJECT_ID: 'proj_test',
    });
    expect(config.region).toBe('eu');
    expect(config.availability).toEqual({ available: true });
  });
});
