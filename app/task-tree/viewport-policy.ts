export function shouldFitRoot(
  previousRootId: string | null,
  nextRootId: string,
): boolean {
  return previousRootId !== nextRootId;
}
