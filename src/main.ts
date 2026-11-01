
import { cart, type CartItem } from './cart';
import { pipelines } from './pipelines';
import { english } from './translations/en';
import './style.css';

const tableBody = document.querySelector<HTMLTableSectionElement>(
  '#cart tbody'
);

if (!tableBody) {
  throw new Error(english.missingShoppingCartTableBody);
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

const pipelineButtons = document.querySelector<HTMLDivElement>(
  '#pipelines'
);

if (!pipelineButtons) {
  throw new Error(english.missingPipelineButtonsContainer);
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

renderCart(cart);
