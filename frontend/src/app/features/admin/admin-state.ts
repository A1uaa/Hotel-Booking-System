import { DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import { apiError } from '../../core/api';

export function resource<T>() {
  const destroy = inject(DestroyRef);
  const data = signal<T | null>(null);
  const loading = signal(false);
  const error = signal('');
  let subscription: Subscription | undefined;
  return {
    data, loading, error,
    load(request: Observable<T>) {
      subscription?.unsubscribe();
      loading.set(true);
      error.set('');
      subscription = request.pipe(takeUntilDestroyed(destroy)).subscribe({
        next: result => { data.set(result); loading.set(false); },
        error: failure => { error.set(apiError(failure)); loading.set(false); },
      });
    },
    clear() {
      subscription?.unsubscribe();
      data.set(null);
      loading.set(false);
      error.set('');
    },
  };
}

export function mutation() {
  const destroy = inject(DestroyRef);
  const saving = signal(false);
  const error = signal('');
  const feedback = signal('');
  return {
    saving, error, feedback,
    run<T>(request: Observable<T>, message: string, success: (result: T) => void) {
      if (saving()) return;
      saving.set(true);
      error.set('');
      feedback.set('');
      request.pipe(takeUntilDestroyed(destroy)).subscribe({
        next: result => { saving.set(false); feedback.set(message); success(result); },
        error: failure => { saving.set(false); error.set(apiError(failure)); },
      });
    },
  };
}
