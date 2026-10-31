type Name = 'mail' | 'eye' | 'eye-off' | 'arrow' | 'music' | 'lock';
const paths: Record<Name, string> = {
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  'eye-off': 'M3 3l18 18 M10 5h2c6 0 10 7 10 7s-1 2-3 4 M6 6c-3 2-4 6-4 6s4 7 10 7c2 0 3 0 4-1',
  arrow: 'M4 12h16 M13 5l7 7-7 7',
  music: 'M9 18V5l12-3v13 M9 7l12-3 M9 18a3 3 0 1 1-3-3h3 M21 15a3 3 0 1 1-3-3h3',
  lock: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4',
};
export function Icon({ name }: { name: Name }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
