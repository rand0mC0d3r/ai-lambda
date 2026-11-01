import { cart, type CartItem } from './cart';

export interface Pipeline {
  label: string;
  run: () => CartItem | CartItem[] | undefined;
}

export const pipelines: Pipeline[] = [
  {
    label: 'AI filter, AI reduce, AI map, AI filter, AI sort',
    run: () =>
      cart
        .filter((item) => item.category === 'Peripherals')
        .reduce<CartItem[]>(
          (acc, item) =>
            !item.inStock && item.unitPrice > 20 ? [...acc, item] : acc,
          []
        )
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .filter((item) => item.quantity * item.unitPrice >= 50)
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'AI filter, AI map, AI reduce, AI filter, AI reverse',
    run: () =>
      cart
        .filter((item) => item.inStock)
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .reduce<CartItem[]>(
          (acc, item) =>
            item.quantity * item.unitPrice >= 100 ? [...acc, item] : acc,
          []
        )
        .filter((item) => item.category !== 'Accessories')
        .reduce<CartItem[]>((acc, item) => [item, ...acc], [])
  },
  {
    label: 'Accessories, then sort',
    run: () =>
      cart
        .filter((item) => item.category === 'Accessories')
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Sort, then 10% off',
    run: () =>
      cart
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
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
        .filter((item) => item.inStock && item.unitPrice > 5)
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Map with AI, then sort',
    run: () =>
      cart
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Sort desc, then back asc',
    run: () =>
      cart
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
        .toSorted(
          (a, b) =>
            a.quantity * a.unitPrice - b.quantity * b.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Sort desc, asc, then by id',
    run: () =>
      cart
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
        .toSorted(
          (a, b) =>
            a.quantity * a.unitPrice - b.quantity * b.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
        .toSorted((a, b) => a.id - b.id)
  },
  {
    label: 'Filter, sort desc, then back asc',
    run: () =>
      cart
        .filter((item) => item.inStock && item.unitPrice > 5)
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
        .toSorted(
          (a, b) =>
            a.quantity * a.unitPrice - b.quantity * b.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Map, filter, then sort',
    run: () =>
      cart
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .filter((item) => item.inStock && item.unitPrice > 5)
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'AI map, AI filter, then AI sort',
    run: () =>
      cart
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .filter((item) => item.inStock && item.unitPrice > 5)
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Sort, AI filter, then sort back',
    run: () =>
      cart
        .toSorted(
          (a, b) =>
            b.quantity * b.unitPrice - a.quantity * a.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
        .filter((item) => item.quantity > 1)
        .toSorted(
          (a, b) =>
            a.quantity * a.unitPrice - b.quantity * b.unitPrice ||
            a.product.localeCompare(b.product, undefined, { numeric: true })
        )
  },
  {
    label: 'Sort by id, then sort by id descending',
    run: () =>
      cart.toSorted((a, b) => a.id - b.id).toSorted((a, b) => b.id - a.id)
  },
  {
    label: 'AI find after AI filter',
    run: () =>
      cart
        .filter((item) => item.category === 'Peripherals')
        .find((item) => item.product.includes('Mouse'))
  },
  {
    label: 'AI filter, then AI find',
    run: () =>
      cart
        .filter((item) => item.inStock)
        .find((item) => item.unitPrice > 100)
  },
  {
    label: 'Discount, then AI find',
    run: () =>
      cart
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .find((item) => item.quantity * item.unitPrice >= 100)
  },
  {
    label: 'Sort by id, then AI find',
    run: () =>
      cart
        .toSorted((a, b) => a.id - b.id)
        .find((item) => item.quantity > 1)
  },
  {
    label: 'AI map, AI filter, then AI find',
    run: () =>
      cart
        .map((item) => ({
          ...item,
          unitPrice: Math.round(item.unitPrice * 90) / 100
        }))
        .filter((item) => item.inStock)
        .find((item) => item.category === 'Accessories')
  },
  {
    label: 'AI some gate, then AI filter',
    run: () =>
      cart.some((item) => item.unitPrice > 100)
        ? cart.filter((item) => item.inStock)
        : []
  },
  {
    label: 'Inject with AI',
    run: () =>
      cart.reduce<CartItem[]>(
        (acc, item) => [
          ...acc,
          item,
          {
            id: item.id + 100,
            product: 'Injected item',
            category: 'Accessories',
            quantity: 1,
            unitPrice: 9.99,
            addedAt: item.addedAt,
            inStock: true
          }
        ],
        []
      )
  }
];
