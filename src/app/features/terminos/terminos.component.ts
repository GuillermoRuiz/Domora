import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LegalLayoutComponent } from '../../shared/components/legal-layout/legal-layout.component';

@Component({
  selector: 'app-terminos',
  standalone: true,
  imports: [LegalLayoutComponent, RouterLink],
  templateUrl: './terminos.component.html',
  styleUrl: './terminos.component.scss',
})
export class TerminosComponent {}
