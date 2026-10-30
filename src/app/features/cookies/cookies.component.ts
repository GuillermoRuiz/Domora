import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { LegalLayoutComponent } from '../../shared/components/legal-layout/legal-layout.component';

@Component({
  selector: 'app-cookies',
  standalone: true,
  imports: [LegalLayoutComponent, RouterLink],
  templateUrl: './cookies.component.html',
  styleUrl: './cookies.component.scss',
})
export class CookiesComponent {}
