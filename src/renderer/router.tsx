import { useEffect, useSyncExternalStore } from 'react';
import { Widget } from './widget/Widget';
import { Dashboard } from './dashboard/Dashboard';
import { PromptWindow } from './prompt/PromptWindow';
import { Gadget } from './gadget/Gadget';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const getHash = () => window.location.hash.replace(/^#\/?/, '');

export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribe, getHash);
  return hash.split('/').filter(Boolean);
}

export function navigate(path: string): void {
  window.location.hash = `/${path.replace(/^\//, '')}`;
}

export function Router() {
  const [root, ...rest] = useRoute();
  useEffect(() => {
    document.body.className = root === 'dashboard' || root === 'prompt' || root === 'gadget' ? root : 'transparent';
  }, [root]);
  if (root === 'widget') return <Widget />;
  if (root === 'prompt') return <PromptWindow />;
  if (root === 'gadget') return <Gadget />;
  if (root === 'dashboard') return <Dashboard page={rest[0] ?? 'today'} date={rest[1]} />;
  return null;
}
