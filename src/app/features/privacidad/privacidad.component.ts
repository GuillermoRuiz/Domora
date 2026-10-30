import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LegalLayoutComponent } from '../../shared/components/legal-layout/legal-layout.component';

@Component({
  selector: 'app-privacidad',
  standalone: true,
  imports: [LegalLayoutComponent, RouterLink],
  templateUrl: './privacidad.component.html',
  styleUrl: './privacidad.component.scss',
})
export class PrivacidadComponent {}
