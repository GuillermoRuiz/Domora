import { Component, computed, input, output } from '@angular/core';
import type { Document as AppDocument } from '../../../core/models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { activityDayLabel } from '../community-activity/community-activity.component';

/** Cuántos documentos enseña la tarjeta. */
const VISIBLE = 4;

interface Row {
  doc: AppDocument;
  detail: string;
}

/** «Documentos recientes»: los últimos documentos que la comunidad ha publicado para este propietario. */
@Component({
  selector: 'app-community-documents',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './community-documents.component.html',
  styleUrl: './community-documents.component.scss',
})
export class CommunityDocumentsComponent {
  /** Del más reciente al más antiguo; null mientras cargan. */
  readonly documents = input<AppDocument[] | null>(null);
  readonly failed = input(false);
  readonly viewAll = output<void>();
  readonly download = output<AppDocument>();
  /** A document was clicked: the parent opens it in the documents page. */
  readonly open = output<AppDocument>();

  readonly rows = computed<Row[]>(() =>
    (this.documents() ?? []).slice(0, VISIBLE).map(doc => ({
      doc,
      detail: [doc.folderName, doc.type, doc.size, activityDayLabel(doc.date)].filter(Boolean).join(' · '),
    })),
  );
}
