// The K columns of a write I, each amount column in A as a decimal string
// (null kept where the column is nullable), optionality kept.
export type DecimalWrite<I, K extends keyof I, A extends keyof I> = {
  [P in K]: P extends A ? (null extends I[P] ? string | null : string) : I[P];
};

// An insert with every column required.
export type DecimalInsert<I, A extends keyof I> = Required<
  DecimalWrite<I, keyof I, A>
>;
