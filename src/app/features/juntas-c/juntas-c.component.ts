import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { OwnerScopeService, type ScopeProperty } from '../../core/owner-scope.service';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CommunityScopeSelectorComponent } from '../community-c/community-scope-selector/community-scope-selector.component';
import { JuntasSectionComponent } from './juntas-section/juntas-section.component';

/** Una propiedad con comunidad: sus juntas (el voto y la delegación son de la propiedad). */
interface JuntasBlock {
  property: ScopeProperty;
  estateId: string;
}

/**
 * «Juntas» del propietario (rol C): las juntas convocadas en las que puede votar o delegar y las actas que
 * esperan su firma, por cada propiedad del ámbito de la cabecera (en «Todas», una bloque por propiedad).
 * `?propertyId=` elige esa propiedad, `?estateId=` la primera de esa comunidad y `?meeting=<id>` resalta esa junta
 * (avisos y enlaces antiguos a la pestaña «Juntas» de la ficha).
 */
@Component({
  selector: 'app-juntas-c',
  standalone: true,
  imports: [TopbarComponent, CommunityScopeSelectorComponent, EmptyStateComponent, IconComponent, JuntasSectionComponent],
  templateUrl: './juntas-c.component.html',
  styleUrl: './juntas-c.component.scss',
})
export class JuntasCComponent {
  readonly scope = inject(OwnerScopeService);
  private state = inject(StateService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly highlightedMeetingId = signal<string | null>(null);
  /** Propiedad o comunidad pedida por la URL: se aplica en cuanto se conocen las propiedades. */
  private readonly requested = signal<{ propertyId?: string; estateId?: string } | null>(null);

  readonly blocks = computed<JuntasBlock[]>(() => {
    const properties = this.scope.isAll() ? this.scope.items() : [this.scope.selected()].filter((p): p is ScopeProperty => !!p);
    return properties.flatMap((property) => (property.estateId ? [{ property, estateId: property.estateId }] : []));
  });
  readonly scopeName = computed(() => (this.scope.isAll() ? 'Todas mis propiedades' : this.scope.selected()?.nickname ?? ''));

  constructor() {
    effect(() => {
      this.state.propertiesVersion();
      void this.scope.load();
    });
    effect(() => {
      const wanted = this.requested();
      if (!wanted || !this.scope.loaded()) return;
      const items = this.scope.items();
      const property = items.find((p) => p.id === wanted.propertyId) ?? items.find((p) => !!wanted.estateId && p.estateId === wanted.estateId);
      untracked(() => {
        this.requested.set(null);
        if (property && this.scope.selected()?.id !== property.id) this.scope.select(property.id);
      });
    });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.highlightedMeetingId.set(params.get('meeting'));
      const propertyId = params.get('propertyId');
      const estateId = params.get('estateId');
      if (propertyId || estateId) {
        this.requested.set({ propertyId: propertyId ?? undefined, estateId: estateId ?? undefined });
        void this.router.navigate([], { relativeTo: this.route, queryParams: { propertyId: null, estateId: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
    });
  }

  openAddProperty(): void {
    this.state.showAddPropertyModal.set(true);
  }
}
