export interface BranchScale { age: number; width: number }

/** CSS-pixel bar for the current tree camera, independent of portrait radii. */
export function branchScale(k: number, maxDistance: number, viewportWidth: number): BranchScale {
  const pixelsPerMa = k / maxDistance;
  const maxAge = Math.min(120, viewportWidth * .25) / pixelsPerMa;
  const power = 10 ** Math.floor(Math.log10(maxAge));
  const age = [1, 2, 4, 5, 10].map(step => step * power).filter(value => value <= maxAge).at(-1) || power;
  return { age: Number(age.toPrecision(8)), width: age * pixelsPerMa };
}
