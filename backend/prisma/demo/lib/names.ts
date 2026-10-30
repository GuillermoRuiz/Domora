import {
  FIRST_NAMES_FEMALE,
  FIRST_NAMES_MALE,
  FOREIGN_FIRST_NAMES,
  FOREIGN_SURNAMES,
  SURNAMES,
} from '../data/names';
import { DEMO_EMAIL_DOMAIN } from '../guard';
import { makeDni, makeNie } from './nif';
import { type Rng, chance, pick, randDigits } from './rng';

export interface DemoPerson {
  firstName: string;
  lastName1: string;
  lastName2: string;
  fullName: string;
  email: string;
  phone: string;
  /** DNI o NIE válido (algoritmo oficial). */
  taxId: string;
}

/** Quita acentos y deja solo [a-z0-9] (para emails). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Móvil español plausible: 6xx o 7[1-4]x xx xx xx. */
export function makePhone(rng: Rng): string {
  const lead = pick(rng, ['6', '6', '6', '7'] as const);
  const second =
    lead === '7'
      ? pick(rng, ['1', '2', '3', '4'] as const)
      : String(Math.floor(rng() * 10));
  const rest = randDigits(rng, 7);
  const digits = `${lead}${second}${rest}`;
  return `${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7, 9)}`;
}

/**
 * Generador de personas ÚNICAS (nombre completo, email y NIF no se repiten en
 * toda la ejecución). Determinista: depende solo del RNG y del orden de las
 * llamadas.
 */
export class PersonFactory {
  private readonly names = new Set<string>();
  private readonly emails = new Set<string>();
  private readonly taxIds = new Set<string>();

  constructor(private readonly rng: Rng) {}

  /** Reserva un email fijo (p. ej. propietario@) para que no lo reutilice nadie. */
  reserveEmail(email: string): void {
    this.emails.add(email);
  }

  /**
   * `foreign` genera un titular extranjero con NIE; `surnameOf` fuerza el
   * primer apellido (matrimonio / familia).
   */
  next(opts: { foreign?: boolean; surnameOf?: DemoPerson } = {}): DemoPerson {
    const rng = this.rng;
    for (let attempt = 0; attempt < 200; attempt++) {
      let firstName: string;
      let lastName1: string;
      let lastName2: string;
      if (opts.foreign) {
        firstName = pick(rng, FOREIGN_FIRST_NAMES);
        lastName1 = pick(rng, FOREIGN_SURNAMES);
        lastName2 = pick(rng, SURNAMES);
      } else {
        const female = chance(rng, 0.5);
        firstName = pick(rng, female ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE);
        lastName1 = opts.surnameOf?.lastName1 ?? pick(rng, SURNAMES);
        lastName2 = pick(rng, SURNAMES);
      }
      const fullName = `${firstName} ${lastName1} ${lastName2}`;
      if (this.names.has(fullName)) continue;
      const base = `${slugify(firstName)}.${slugify(lastName1)}`;
      let email = `${base}${DEMO_EMAIL_DOMAIN}`;
      for (let n = 2; this.emails.has(email); n++) {
        email = `${base}${n}${DEMO_EMAIL_DOMAIN}`;
      }
      let taxId = opts.foreign ? makeNie(rng) : makeDni(rng);
      while (this.taxIds.has(taxId)) {
        taxId = opts.foreign ? makeNie(rng) : makeDni(rng);
      }
      this.names.add(fullName);
      this.emails.add(email);
      this.taxIds.add(taxId);
      return {
        firstName,
        lastName1,
        lastName2,
        fullName,
        email,
        phone: makePhone(rng),
        taxId,
      };
    }
    throw new Error('PersonFactory: no se pudo generar una persona única.');
  }

  /** Persona con datos fijos (cuentas nombradas); reserva su nombre/email/NIF. */
  fixed(fullName: string, email: string, taxId?: string): DemoPerson {
    const [firstName = fullName, lastName1 = '', ...rest] = fullName.split(' ');
    const lastName2 = rest.join(' ');
    this.names.add(fullName);
    this.emails.add(email);
    const nif = taxId ?? makeDni(this.rng);
    this.taxIds.add(nif);
    return {
      firstName,
      lastName1,
      lastName2,
      fullName,
      email,
      phone: makePhone(this.rng),
      taxId: nif,
    };
  }
}
