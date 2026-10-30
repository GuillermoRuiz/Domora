import type { VoteQuestion } from '../core/models';

/** Paleta que ofrece el asistente de juntas para colorear las respuestas de una votación. */
export const VOTE_OPTION_PALETTE: readonly { name: string; value: string }[] = [
  { name: 'Verde', value: '#3FA372' },
  { name: 'Rojo', value: '#E0594A' },
  { name: 'Azul', value: '#6CA0F0' },
  { name: 'Amarillo', value: '#D9A62E' },
  { name: 'Naranja', value: '#E8A57D' },
  { name: 'Morado', value: '#B79AE0' },
  { name: 'Rosa', value: '#E58FB5' },
  { name: 'Turquesa', value: '#4FBFB3' },
  { name: 'Gris', value: '#9A9A9E' },
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Color elegido para la respuesta `index`, o `null` si no se eligió ninguno (se usa el de por defecto). */
export function customOptionColor(question: Pick<VoteQuestion, 'optionColors'>, index: number): string | null {
  const color = question.optionColors?.[index];
  return color && HEX.test(color) ? color : null;
}

/** Color con el que se muestra una respuesta si nadie lo ha cambiado: a favor verde, en contra rojo, el resto azul. */
export function defaultOptionColor(index: number, type: VoteQuestion['type']): string {
  if (type === 'single_choice' && index === 0) return 'var(--meeting-green, #3FA372)';
  if (type === 'single_choice' && index === 1) return 'var(--color-error)';
  return 'var(--color-blue)';
}

/** Color efectivo de una respuesta: el elegido o, si no, el de por defecto. */
export function optionColor(question: Pick<VoteQuestion, 'optionColors' | 'type'>, index: number): string {
  return customOptionColor(question, index) ?? defaultOptionColor(index, question.type);
}
