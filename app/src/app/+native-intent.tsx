import { systemPath } from '@/lib/links';

// Links into the app (transportsydney.app/trip, /stop, /plan) become the app's own routes.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return systemPath(path);
  } catch {
    return '/';
  }
}
