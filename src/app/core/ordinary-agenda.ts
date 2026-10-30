import type { AgendaItem, VoteQuestion } from './models';

interface OrdinaryAgendaDefinition {
  key: 'annual_accounts_approval' | 'annual_budget_approval' | 'community_officers_appointment';
  title: string;
  description?: string;
  /** Pregunta de votación precargada; se aprueba por mayoría simple (art. 17.7 LPH). */
  question?: VoteQuestion;
}

export const ORDINARY_AGENDA: readonly OrdinaryAgendaDefinition[] = [
  {
    key: 'annual_accounts_approval',
    title: 'Aprobación de las cuentas del ejercicio anterior',
    description: 'Examen y, en su caso, aprobación de las cuentas y la liquidación del ejercicio anterior.',
    question: {
      title: '¿Aprueba las cuentas del ejercicio anterior?',
      type: 'single_choice',
      options: ['A favor', 'En contra'],
      majorityType: 'mayoriaSimple',
    },
  },
  {
    key: 'annual_budget_approval',
    title: 'Aprobación del presupuesto del ejercicio siguiente',
    description: 'Examen y, en su caso, aprobación del presupuesto de ingresos y gastos del ejercicio siguiente.',
    question: {
      title: '¿Aprueba el presupuesto del ejercicio siguiente?',
      type: 'single_choice',
      options: ['A favor', 'En contra'],
      majorityType: 'mayoriaSimple',
    },
  },
  { key: 'community_officers_appointment', title: 'Renovación o nombramiento de los cargos de la comunidad' },
];

export type OrdinaryAgendaKey = OrdinaryAgendaDefinition['key'];

/** Text matching is only a fallback for older/manual points without a stable key. */
export function ordinaryAgendaKey(item: AgendaItem): OrdinaryAgendaKey | undefined {
  return item.systemKey ?? ORDINARY_AGENDA.find(
    definition => definition.title.toLocaleLowerCase('es') === item.title.trim().toLocaleLowerCase('es'),
  )?.key;
}

/** Fresh copy of a definition as an agenda item, so each draft owns its description and vote template. */
export function ordinaryAgendaItem(definition: OrdinaryAgendaDefinition, base: AgendaItem): AgendaItem {
  return {
    ...base,
    title: definition.title,
    description: definition.description ?? '',
    hasVote: !!definition.question,
    ...(definition.question ? { voteTemplate: { questions: [structuredClone(definition.question)] } } : {}),
    systemKey: definition.key,
    systemGenerated: true,
  };
}
