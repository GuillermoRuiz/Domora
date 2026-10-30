import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { FooterComponent } from '../footer/footer.component';

@Component({
  selector: 'app-legal-layout',
  standalone: true,
  imports: [RouterLink, FooterComponent],
  templateUrl: './legal-layout.component.html',
  styleUrl: './legal-layout.component.scss',
})
export class LegalLayoutComponent {
  title = input.required<string>();
  updatedAt = input.required<string>();
}
