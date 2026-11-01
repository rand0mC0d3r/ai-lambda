import { cart, type CartItem } from './cart';

export interface Pipeline {
  label: string;
  run: () => CartItem[];
}

// Instruction strings must be string literals: the compiler reads them at build time.
export const pipelines: Pipeline[] = [
  {
    label: 'Accessories, then sort',
    run: () =>
      cart
        .filter((item) => item.category === 'Accessories')
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Sort, then 10% off',
    run: () =>
      cart
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
  },
  {
    label: 'In stock, sort, then 10% off',
    run: () =>
      cart
        .filter((item) => item.inStock)
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
  },
  {
    label: 'Filter with AI, then sort',
    run: () =>
      cart
        .filterAi(
          'Keep only items that are in stock and have a unit price above 5 dollars.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Map with AI, then sort',
    run: () =>
      cart
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Sort desc, then back asc',
    run: () =>
      cart
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), lowest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Sort desc, asc, then by id',
    run: () =>
      cart
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), lowest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .sortAi('Sort by id, lowest first.')
  },
  {
    label: 'Filter, sort desc, then back asc',
    run: () =>
      cart
        .filterAi(
          'Keep only items that are in stock and have a unit price above 5 dollars.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), lowest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Map, filter, then sort',
    run: () =>
      cart
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
        .filterAi(
          'Keep only items that are in stock and have a unit price above 5 dollars.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  }
];
