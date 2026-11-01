import { cart, type CartItem } from './cart';

export interface Pipeline {
  label: string;
  run: () => CartItem | CartItem[] | undefined;
}

// Instruction strings must be string literals: the compiler reads them at build time.
export const pipelines: Pipeline[] = [
  {
    label: 'AI filter, AI reduce, AI map, AI filter, AI sort',
    run: () =>
      cart
        .filterAi('Keep only items in the Peripherals category.')
        .reduceAi<CartItem[]>(
          'Return a new array containing only items that are not in stock and have a unitPrice above 20 dollars. Append each matching item to acc; otherwise return acc unchanged.',
          []
        )
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
        .filterAi(
          'Keep only items whose quantity multiplied by unit price is at least 50 dollars.'
        )
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'AI filter, AI map, AI reduce, AI filter, AI reverse',
    run: () =>
      cart
        .filterAi('Keep only items that are in stock.')
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
        .reduceAi<CartItem[]>(
          'Return a new array containing items whose quantity multiplied by unitPrice is at least 100 dollars. Append each matching item to acc; otherwise return acc unchanged.',
          []
        )
        .filterAi('Keep only items whose category is not Accessories.')
        .reduceAi<CartItem[]>(
          'Prepend the current item to acc so that the final array is in reverse order. Return acc.',
          []
        )
  },
  {
    label: 'Accessories, then sort',
    run: () =>
      cart
        .filterAi('Keep only items in the Accessories category.')
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
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
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
    label: 'AI map, AI filter, then AI sort',
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
    label: 'Sort, AI filter, then sort back',
    run: () =>
      cart
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
        )
        .filterAi('Keep only items whose quantity is greater than 1.')
        .sortAi(
          'Sort by total line price (quantity multiplied by unit price), lowest first. When prices are equal, sort product names in natural alphabetical order.'
        )
  },
  {
    label: 'Sort by id, then sort by id descending',
    run: () =>
      cart
        .sortAi('Sort by id, lowest first.')
        .sortAi('Sort by id, highest first.')
  },
  {
    label: 'AI find after AI filter',
    run: () =>
      cart
        .filterAi('Keep only items in the Peripherals category.')
        .findAi('Find the first item whose product name includes "Mouse".')
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
        .mapAi(
          'Apply a 10% discount to the unit price, rounded to two decimals, and keep all other fields.'
        )
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
    label: 'Inject with AI',
    run: () =>
      cart.reduceAi<CartItem[]>(
        'Append the current item to acc. Then append a new object with id set to the current item id plus 100, product set to "Injected item", category set to "Accessories", quantity set to 1, unitPrice set to 9.99, addedAt set to the current item addedAt, and inStock set to true. Return acc.',
        []
      )
  }
];
