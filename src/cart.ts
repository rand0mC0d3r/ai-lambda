export type CartCategory = 'Accessories' | 'Displays' | 'Peripherals';

export interface CartItem {
  id: number;
  product: string;
  category: CartCategory;
  quantity: number;
  unitPrice: number;
  addedAt: Date;
  inStock: boolean;
}

export const cart: CartItem[] = [
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
    id: 5,
    product: 'USB Cable 10 (new)',
    category: 'Accessories',
    quantity: 2,
    unitPrice: 5.99,
    addedAt: new Date('2026-10-28'),
    inStock: true
  },
  {
    id: 4,
    product: 'Keyboard',
    category: 'Peripherals',
    quantity: 1,
    unitPrice: 89.99,
    addedAt: new Date('2026-10-29'),
    inStock: true
  },
  {
    id: 6,
    product: 'Wireless Mouse',
    category: 'Peripherals',
    quantity: 2,
    unitPrice: 24.99,
    addedAt: new Date('2026-10-30'),
    inStock: true
  },
  {
    id: 7,
    product: 'Webcam HD',
    category: 'Peripherals',
    quantity: 1,
    unitPrice: 59.99,
    addedAt: new Date('2026-10-30'),
    inStock: true
  },
  {
    id: 8,
    product: 'Monitor Stand',
    category: 'Displays',
    quantity: 1,
    unitPrice: 79.99,
    addedAt: new Date('2026-10-31'),
    inStock: true
  },
  {
    id: 9,
    product: 'HDMI Cable 2m',
    category: 'Accessories',
    quantity: 4,
    unitPrice: 7.49,
    addedAt: new Date('2026-10-31'),
    inStock: true
  },
  {
    id: 10,
    product: 'USB-C Dock',
    category: 'Peripherals',
    quantity: 1,
    unitPrice: 119.99,
    addedAt: new Date('2026-11-01'),
    inStock: true
  },
  {
    id: 11,
    product: 'Monitor 24',
    category: 'Displays',
    quantity: 2,
    unitPrice: 149.99,
    addedAt: new Date('2026-11-01'),
    inStock: true
  }
];
