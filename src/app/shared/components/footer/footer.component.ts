import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Enlaces legales permanentes — LSSI art. 10 exige que el Aviso Legal (y,
 * en la práctica, el resto de páginas legales) sea accesible "de forma
 * permanente, fácil, directa y gratuita" desde cualquier punto del sitio.
 */
@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
})
export class FooterComponent {
  readonly year = new Date().getFullYear();
}
