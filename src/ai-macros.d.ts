declare module '*.css';

interface Array<T> {
  sortAi(instruction: string): T[];
  filterAi(instruction: string): T[];
}
