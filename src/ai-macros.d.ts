declare module '*.css';

declare function sortAi<T>(
  items: readonly T[],
  instruction: string
): T[];
