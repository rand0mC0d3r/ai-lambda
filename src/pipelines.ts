import { cart, type CartItem } from './cart';

export interface Pipeline {
  label: string;
  run: () => CartItem | CartItem[] | undefined;
}

const tenPercentOff = (item: CartItem): CartItem => ({
  ...item,
  unitPrice: Math.round(item.unitPrice * 90) / 100
});

// Instruction strings must be string literals: the compiler reads them at build time.
export const pipelines: Pipeline[] = [
  {
    label: 'Native filter, AI reduce, native map, AI sort',
    run: () =>
      cart
        .filter((item) => item.category === 'Peripherals')
        .reduceAi<CartItem[]>(
          'Return a new array containing only items that are in stock and have a unitPrice above 50 dollars. Append each matching item to acc; otherwise return acc unchanged.',
          []
        )
        .map(tenPercentOff)
        .filter((item) => item.quantity * item.unitPrice >= 50)
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'AI filter, native map, AI reduce, native filter',
    run: () =>
      cart
        .filterAi('Keep only items that are in stock.')
        .map(tenPercentOff)
        .reduceAi<CartItem[]>(
          'Return a new array containing items whose quantity multiplied by unitPrice is at least 100 dollars. Append each matching item to acc; otherwise return acc unchanged.',
          []
        )
        .filter((item) => item.category !== 'Accessories')
        .toReversed()
  },
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
        .map(tenPercentOff)
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
  },
  {
    label: 'Regular map, AI filter, native sort',
    run: () =>
      cart
        .map(tenPercentOff)
        .filterAi(
          'Keep only items that are in stock and have a unit price above 5 dollars.'
        )
        .toSorted((a, b) => b.quantity * b.unitPrice - a.quantity * a.unitPrice)
  },
  {
    label: 'Sort, regular filter, then sort back',
    run: () =>
      cart
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .filter((item) => item.quantity > 1)
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), lowest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Sort by id, then native reverse',
    run: () => cart.sortAi('Sort by id, lowest first.').toReversed()
  },
  {
    label: 'AI find after native filter',
    run: () =>
      cart
        .filter((item) => item.category === 'Peripherals')
        .findAi(
          'Find the first item whose product name includes "Mouse".'
        )
  },
  {
    label: 'AI filter, then AI find',
    run: () =>
      cart
        .filterAi('Keep only items that are in stock.')
        .findAi('Find the first item with a unit price above 100 dollars.')
  },
  {
    label: 'Discount, then AI find',
    run: () =>
      cart
        .map(tenPercentOff)
        .findAi(
          'Find the first item whose quantity multiplied by unit price is at least 100 dollars.'
        )
  },
  {
    label: 'Sort by id, then AI find',
    run: () =>
      cart
        .sortAi('Sort by id, lowest first.')
        .findAi('Find the first item with a quantity greater than 1.')
  },
  {
    label: 'AI map, AI filter, then AI find',
    run: () =>
      cart
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
        .filterAi('Keep only items that are in stock.')
        .findAi('Find the first item whose category is Accessories.')
  },
  {
    label: 'AI some gate, then AI filter',
    run: () =>
      cart.someAi('Match any item with a unit price above 100 dollars.')
        ? cart.filterAi('Keep only items that are in stock.')
        : []
  },
  {
    label: 'Unsorted',
    run: () => cart
  },
  {
    label: 'Inject with AI',
    run: () =>
      cart.reduceAi<CartItem[]>(
        'Append the current item to acc. Then append a new object with id set to the current item id plus 100, product set to "Injected item", category set to "Accessories", quantity set to 1, unitPrice set to 9.99, addedAt set to the current item addedAt, and inStock set to true. Return acc.',
        []
      )
  }
];
