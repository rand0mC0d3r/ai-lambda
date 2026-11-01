
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
const sortedCart = cart.sortAi(
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

const renderCart = (items: readonly CartItem[]) => {
  tableBody.replaceChildren();

  for (const item of items) {
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
};

const pipelines = [
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
  }
];

const pipelineButtons = document.querySelector<HTMLDivElement>(
  '#pipelines'
);

if (!pipelineButtons) {
  throw new Error('Missing pipeline buttons container');
}

for (const { label, run } of pipelines) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-pressed', 'false');

  button.addEventListener('click', () => {
    for (const other of pipelineButtons.querySelectorAll('button')) {
      other.setAttribute('aria-pressed', 'false');
    }

    button.setAttribute('aria-pressed', 'true');
    renderCart(run());
  });

  pipelineButtons.append(button);
}

renderCart(sortedCart);
