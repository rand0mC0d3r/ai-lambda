
import './style.css';

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
  'Sort by total line price (quantity multiplied by unit price), highest first. When prices are equal, sort product names in natural alphabetical order.'
);

console.table(sortedCart);

const tableBody = document.querySelector<HTMLTableSectionElement>(
  '#cart tbody'
);

if (!tableBody) {
  throw new Error('Missing shopping cart table body');
}

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD'
});
const date = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium'
});

for (const item of sortedCart) {
  const row = document.createElement('tr');
  const values = [
    { value: item.product, className: 'product' },
    { value: item.category },
    { value: String(item.quantity) },
    { value: currency.format(item.unitPrice) },
    {
      value: currency.format(item.quantity * item.unitPrice),
      className: 'line-total'
    },
    { value: date.format(item.addedAt) },
    {
      value: item.inStock ? 'In stock' : 'Out of stock',
      className: item.inStock
        ? 'availability'
        : 'availability out-of-stock'
    }
  ];

  for (const { value, className } of values) {
    const cell = document.createElement('td');
    cell.textContent = value;

    if (className) {
      cell.className = className;
    }

    row.append(cell);
  }

  tableBody.append(row);
}
