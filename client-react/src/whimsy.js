import { prefs } from './session';

export function isWhimsyEnabled() {
  return prefs.get('sw-whimsy') === 'on';
}

export function persistWhimsyEnabled(on) {
  prefs.set('sw-whimsy', on ? 'on' : 'off');
}
