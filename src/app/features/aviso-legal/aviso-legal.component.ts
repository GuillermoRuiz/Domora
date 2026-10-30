import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LegalLayoutComponent } from '../../shared/components/legal-layout/legal-layout.component';

@Component({
  selector: 'app-aviso-legal',
  standalone: true,
  imports: [LegalLayoutComponent, RouterLink],
  templateUrl: './aviso-legal.component.html',
  styleUrl: './aviso-legal.component.scss',
})
export class AvisoLegalComponent {}
