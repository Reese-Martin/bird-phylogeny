/** A Steller's jay perched at a leaf of the little brand phylogeny. */
export function BirdMark({ className = '', tree = false }: { className?: string; tree?: boolean }) {
  const bird = <>
    <path d="m21 28-17 14 4 1 19-11Z" fill="#255f9c"/>
    <path d="M16 29c2-7 7-12 13-11 7 1 10 10 5 15-5 6-14 4-18-4Z" fill="#2f79bd"/>
    <path d="M26 23c-5 0-9 5-10 9 6 2 13 1 17-5" fill="#1d5b99"/>
    <path d="m15 34-7 6m11-9-7 6" stroke="#5799cb" strokeWidth="1.1" strokeLinecap="round"/>
    <path d="M26 23c-4-3-3-8-1-11V2l7 9c6-1 9 4 7 9l-5 8Z" fill="#202b33" stroke="#64859c" strokeWidth=".6" strokeLinejoin="round"/>
    <path d="m38 16 9 3-9 2Z" fill="#202b33" stroke="#64859c" strokeWidth=".5" strokeLinejoin="round"/>
    <path d="m31 12 3 1" stroke="#65a3cf" strokeWidth="1.2" strokeLinecap="round"/>
    <circle cx="35.3" cy="16" r="1.1" fill="#e8edf0"/>
    <path d="m24 35-.5 7m6-7-1 7m-8 0h6m0 0h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
  </>;
  return <svg viewBox={tree ? '0 0 64 64' : '0 0 48 48'} fill="none" aria-hidden="true" className={className}>{tree ? <>
    <path d="M8 57V42H25M25 42V24H44M25 42H41M41 42V33H55M41 42V53H55" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="55" cy="33" r="2.6" fill="var(--accent)"/>
    <circle cx="55" cy="53" r="2.6" fill="currentColor"/>
    <path d="M44 22v2" stroke="currentColor" strokeWidth="1.5"/>
    <g transform="translate(31 0) scale(.55)">{bird}</g>
  </> : bird}</svg>;
}
