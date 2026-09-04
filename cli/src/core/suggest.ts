const editDistance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(row[j - 1]! + 1, previous[j]! + 1, substitute));
    }
    previous = row;
  }
  return previous[b.length]!;
};

const MAX_DISTANCE = 2;

export const nearest = (input: string, candidates: string[]): string | undefined => {
  if (!input) return undefined;
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = editDistance(input, candidate);
    if (distance > MAX_DISTANCE || distance >= candidate.length || distance >= bestDistance) {
      continue;
    }
    best = candidate;
    bestDistance = distance;
  }
  return best;
};
