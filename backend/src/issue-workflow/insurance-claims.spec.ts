import {
  ACTIVE_CLAIM_STATUSES,
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  canChangeClaimStatus,
  claimStage,
  isInsuranceCategory,
  isTerminalClaimStatus,
  normalizeClaimText,
} from './insurance-claims';

describe('catálogo del siniestro de seguro', () => {
  it('solo withdrawn y closed son terminales: un rechazo se puede reconsiderar', () => {
    expect(CLAIM_STATUSES.filter(isTerminalClaimStatus)).toEqual([
      'withdrawn',
      'closed',
    ]);
    expect(ACTIVE_CLAIM_STATUSES).toEqual([
      'open',
      'under_assessment',
      'accepted',
      'rejected',
    ]);
    expect(canChangeClaimStatus('rejected', 'under_assessment')).toBe(true);
    expect(canChangeClaimStatus('rejected', 'accepted')).toBe(true);
    expect(canChangeClaimStatus('rejected', 'closed')).toBe(true);
    expect(canChangeClaimStatus('closed', 'open')).toBe(false);
    expect(canChangeClaimStatus('withdrawn', 'accepted')).toBe(false);
    // Repetir el mismo estado no es un cambio: es válido (no hace nada).
    expect(canChangeClaimStatus('closed', 'closed')).toBe(true);
  });

  it('todo estado tiene su etiqueta', () => {
    for (const s of CLAIM_STATUSES) expect(CLAIM_STATUS_LABELS[s]).toBeTruthy();
  });

  it('la etapa visible se deriva del estado y del profesional enviado, nunca se guarda', () => {
    const stage = (status: string, professionalAssigned: boolean) =>
      claimStage({ status, professionalAssigned });
    expect(stage('open', false)).toBe('awaiting_insurer');
    expect(stage('open', true)).toBe('professional_assigned');
    expect(stage('under_assessment', false)).toBe('assessment');
    expect(stage('accepted', false)).toBe('awaiting_professional');
    expect(stage('accepted', true)).toBe('professional_assigned');
    expect(stage('rejected', true)).toBe('rejected');
    expect(stage('withdrawn', false)).toBe('withdrawn');
    expect(stage('closed', true)).toBe('closed');
  });

  it('la referencia y el nombre se comparan sin espacios ni mayúsculas', () => {
    expect(normalizeClaimText('  SIN-2026   0457 ')).toBe('sin-2026 0457');
    expect(normalizeClaimText('ALLIANZ ')).toBe(normalizeClaimText('allianz'));
  });

  it('reconoce las categorías de aseguradora como el catálogo del frontend', () => {
    for (const c of [
      'Seguros',
      'seguros',
      'Seguro',
      'Aseguradora',
      'Correduría',
      ' correduria ',
    ])
      expect(isInsuranceCategory(c)).toBe(true);
    for (const c of ['Fontanería', 'Mantenimiento', 'Segurosa'])
      expect(isInsuranceCategory(c)).toBe(false);
  });
});
