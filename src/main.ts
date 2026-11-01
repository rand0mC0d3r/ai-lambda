
interface CartItem {
  id: number;
  product: string;
  category: string;
  quantity: number;
  unitPrice: number;
  addedAt: Date;
  inStock: boolean;
}

const cart: CartItem[] = [
  {
    id: 1,
    product: 'USB Cable 2',
    category: 'Accessories',
    quantity: 3,
    unitPrice: 8.99,
    addedAt: new Date('2026-10-25'),
    inStock: true
  },
  {
    id: 2,
    product: 'Monitor 27',
    category: 'Displays',
    quantity: 1,
    unitPrice: 249.99,
    addedAt: new Date('2026-10-20'),
    inStock: true
  },
  {
    id: 3,
    product: 'USB Cable 10',
    category: 'Accessories',
    quantity: 2,
    unitPrice: 5.99,
    addedAt: new Date('2026-10-28'),
    inStock: false
  },
  {
    id: 4,
    product: 'Keyboard',
    category: 'Peripherals',
    quantity: 1,
    unitPrice: 89.99,
    addedAt: new Date('2026-10-29'),
    inStock: true
  }
];

// Natural language becomes native JavaScript.
const sortedCart = sortAi(
  cart,
  'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.',
  {
    id: 'number',
    product: 'string',
    category: 'string',
    quantity: 'number',
    unitPrice: 'number',
    addedAt: 'date',
    inStock: 'boolean'
  }
);

console.table(sortedCart);
