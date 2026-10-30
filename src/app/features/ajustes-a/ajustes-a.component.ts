import { Component, inject } from '@angular/core';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-ajustes-a',
  standalone: true,
  imports: [TopbarComponent, IconComponent, AvatarComponent],
  templateUrl: './ajustes-a.component.html',
  styleUrl: './ajustes-a.component.scss',
})
export class AjustesAComponent {
  auth = inject(AuthService);
}
