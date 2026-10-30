import { Injectable, effect, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { NotificationsService } from './notifications.service';
import { StateService } from './state.service';

/** One session-wide loader, activated by App rather than individual navigation components. */
@Injectable({ providedIn: 'root' })
export class NavigationStatusService {
  private readonly auth = inject(AuthService);
  private readonly state = inject(StateService);
  private readonly notifications = inject(NotificationsService);

  constructor() {
    effect((onCleanup) => {
      const user = this.auth.currentUser();
      this.state.currentRole();
      this.state.notificationsVersion();
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });
      const current = () => !cancelled;

      if (!user) {
        this.state.unreadMessagesCount.set(0);
        this.state.notificationsCount.set(0);
        this.state.recentAlerts.set([]);
        this.state.recentAlertsLoaded.set(false);
        this.state.recentAlertsLoading.set(false);
        return;
      }

      this.state.recentAlerts.set([]);
      this.state.recentAlertsLoaded.set(false);
      this.state.recentAlertsLoading.set(false);

      // The existing summary already counts unread conversation messages server-side.
      void this.notifications
        .summary()
        .then((summary) => {
          if (!current()) return;
          this.state.unreadMessagesCount.set(summary.unreadMessages);
          this.state.notificationsCount.set(summary.unreadNotifications);
        })
        .catch((error) =>
          console.error('Error cargando contadores de navegación', error),
        );

    });
  }
}
