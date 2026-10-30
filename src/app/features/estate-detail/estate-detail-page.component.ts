import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { EstateDetailComponent } from './estate-detail.component';

/** A new finca gets a fresh detail, including its forms and self-loading tabs. */
@Component({
  selector: 'app-estate-detail-page',
  standalone: true,
  imports: [EstateDetailComponent],
  template: '@for (id of estateIds(); track id) { <app-estate-detail></app-estate-detail> }',
  styles: ':host { display: block; }',
})
export class EstateDetailPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly estateId = toSignal(this.route.paramMap.pipe(map(params => params.get('id'))), { requireSync: true });
  readonly estateIds = computed(() => {
    const id = this.estateId();
    return id ? [id] : [];
  });
}
