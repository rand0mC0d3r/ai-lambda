declare global {
  interface Array<T> {
    /**
     * Returns a new array sorted according to a natural-language instruction.
     * The instruction must be a string literal so the Vite `aiCompiler` plugin
     * can generate and validate a comparator during the build.
     *
     * @param instruction Describes the desired ordering of the array elements.
     * @returns A new array sorted by the generated comparator.
     *
     * @example Simple: sort products by price
     * ```ts
     * const cheapestFirst = products.sortAi('Sort by price, lowest first.');
     * ```
     *
     * @example Complex: filter first, then sort matching products
     * ```ts
     * const featured = products
     *   .filterAi('Keep in-stock products rated at least 4 stars.')
     *   .sortAi('Sort by rating from highest to lowest, then by price lowest first.');
     * ```
     */
    sortAi(instruction: string): T[];

    /**
     * Returns only the elements that satisfy a natural-language instruction.
     * The instruction must be a string literal so the Vite `aiCompiler` plugin
     * can generate and validate a predicate during the build.
     *
     * @param instruction Describes which elements to keep.
     * @returns A new array containing the elements that match the instruction.
     *
     * @example Simple: keep available products
     * ```ts
     * const available = products.filterAi('Keep products that are in stock.');
     * ```
     *
     * @example Complex: combine multiple conditions
     * ```ts
     * const eligible = products.filterAi(
     *   'Keep in-stock products priced under 100 with a name containing "pro", ignoring case.'
     * );
     * ```
     */
    filterAi(instruction: string): T[];

    /**
     * Transforms each element according to a natural-language instruction.
     * Specify `U` when the mapped elements have a different TypeScript type;
     * this type argument describes the result to TypeScript but does not
     * validate its runtime shape.
     *
     * @typeParam U The type of each mapped element; defaults to the input type.
     * @param instruction Describes the value to produce for each element.
     * @returns A new array containing the mapped elements.
     *
     * @example Simple: apply a discount and keep the other fields
     * ```ts
     * const discounted = products.mapAi(
     *   'Reduce price by 10%, rounded to two decimals, and keep every other field.'
     * );
     * ```
     *
     * @example Complex: map filtered orders into a different result type
     * ```ts
     * type OrderSummary = { id: string; label: string; amount: number };
     *
     * const summaries = orders
     *   .filterAi('Keep completed orders only.')
     *   .mapAi<OrderSummary>(
     *     'Return each order as { id, label: customer, amount: total }; do not include other fields.'
     *   );
     * ```
     */
    mapAi<U = T>(instruction: string): U[];

    /**
     * Combines the array elements into one value according to a natural-language
     * instruction.
     *
     * @typeParam U The accumulator and final result type.
     * @param instruction Describes how to update the accumulator for each element.
     * @param initialValue The starting accumulator value; also used to infer `U`.
     * @returns The final accumulator value.
     *
     * @example Simple: sum product prices
     * ```ts
     * const total = products.reduceAi(
     *   'Add each product price to the running total.',
     *   0
     * );
     * ```
     *
     * @example Complex: accumulate a typed report from selected orders
     * ```ts
     * type Report = { count: number; revenue: number };
     *
     * const report = orders
     *   .filterAi('Keep completed orders only.')
     *   .reduceAi<Report>(
     *     'Return a new report with count increased by one and revenue increased by the order total.',
     *     { count: 0, revenue: 0 }
     *   );
     * ```
     */
    reduceAi<U>(instruction: string, initialValue: U): U;
  }
}

export {};
