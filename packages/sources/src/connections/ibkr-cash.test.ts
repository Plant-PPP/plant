import { cashOf } from "./ibkr";

const statement = (body: string, report: string) => `<FlexQueryResponse>
<FlexStatements count="1">
<FlexStatement accountId="U0000000" fromDate="20250102" toDate="20251231">
<CashReport>${report}</CashReport>
${body}
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const TRADES = `<Trades>
<Trade currency="USD" symbol="VOO" listingExchange="ARCA" assetCategory="STK" tradeDate="20250115" quantity="2" tradePrice="500" proceeds="-1000" ibCommission="-1" netCash="-1001" buySell="BUY" tradeID="201" levelOfDetail="EXECUTION" />
<Trade currency="USD" symbol="VOO" listingExchange="ARCA" assetCategory="STK" tradeDate="20250115" quantity="2" tradePrice="500" proceeds="-1000" ibCommission="-1" netCash="-1001" buySell="BUY" tradeID="201" levelOfDetail="ORDER" />
<Trade currency="USD" symbol="VOO" listingExchange="ARCA" assetCategory="STK" tradeDate="20250610" quantity="-1" tradePrice="550" proceeds="550" ibCommission="-1" buySell="SELL" tradeID="202" levelOfDetail="EXECUTION" />
<Trade currency="EUR" symbol="SAP" tradeDate="20250611" quantity="1" tradePrice="200" proceeds="-200" ibCommission="-1" buySell="BUY" tradeID="203" levelOfDetail="EXECUTION" />
</Trades>`;

const TRANSACTIONS = `<CashTransactions>
<CashTransaction currency="USD" type="Deposits/Withdrawals" amount="1000" dateTime="20250212" transactionID="301" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" type="Deposits/Withdrawals" amount="-2950" dateTime="20250602;104709" transactionID="302" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" symbol="VOO" listingExchange="ARCA" assetCategory="STK" type="Dividends" amount="3.5" dateTime="20250331" transactionID="303" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" symbol="VOO" listingExchange="ARCA" assetCategory="STK" type="Withholding Tax" amount="-1.05" dateTime="20250331" transactionID="304" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" type="Broker Interest Received" amount="0.8" dateTime="20250403" transactionID="305" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" type="Broker Interest Received" amount="0" dateTime="20250503" transactionID="306" levelOfDetail="DETAIL" />
<CashTransaction currency="USD" type="Deposits/Withdrawals" amount="1000" dateTime="20250212" transactionID="301" levelOfDetail="SUMMARY" />
</CashTransactions>`;

const row = (fields: Record<string, string | null>) => ({
  symbol: null,
  quantity: null,
  price: null,
  commission: "0",
  vat: "0",
  otherTaxes: "0",
  currency: "USD",
  ...fields,
});

describe("cashOf", () => {
  it("reads each trade's net cash and each cash transaction once", () => {
    const { rows } = cashOf([
      statement(
        TRADES + TRANSACTIONS,
        '<CashReportCurrency currency="BASE_SUMMARY" fromDate="20250102" startingCash="30117.62" />',
      ),
    ]);
    expect(rows).toEqual([
      row({
        number: "201",
        kind: "purchase",
        symbol: "VOO.US",
        date: "2025-01-15",
        quantity: "2",
        price: "500",
        commission: "1",
        amount: "-1001",
      }),
      row({
        number: "202",
        kind: "sale",
        symbol: "VOO.US",
        date: "2025-06-10",
        quantity: "1",
        price: "550",
        commission: "1",
        amount: "549",
      }),
      row({
        number: "301",
        kind: "deposit",
        date: "2025-02-12",
        amount: "1000",
      }),
      row({
        number: "302",
        kind: "withdrawal",
        date: "2025-06-02",
        amount: "-2950",
      }),
      row({
        number: "303",
        kind: "dividend",
        symbol: "VOO.US",
        date: "2025-03-31",
        amount: "3.5",
      }),
      row({
        number: "304",
        kind: "credit",
        symbol: "VOO.US",
        date: "2025-03-31",
        amount: "-1.05",
      }),
      row({ number: "305", kind: "credit", date: "2025-04-03", amount: "0.8" }),
    ]);
  });

  it("keeps a row two statements repeat once", () => {
    const one = statement(TRANSACTIONS, "");
    expect(cashOf([one, one]).rows).toHaveLength(5);
  });

  it("opens each currency at what the oldest statement started with", () => {
    const newer = statement(
      "",
      '<CashReportCurrency currency="USD" fromDate="20260102" startingCash="52.85" />',
    );
    const older = statement(
      "",
      '<CashReportCurrency currency="BASE_SUMMARY" fromDate="20250102" startingCash="30117.62" />' +
        '<CashReportCurrency currency="USD" fromDate="20250102" startingCash="30000" />' +
        '<CashReportCurrency currency="ARS" fromDate="20250102" startingCash="-5" />',
    );
    expect(cashOf([newer, older]).openings).toEqual([
      { currency: "USD", date: "2025-01-02", amount: "30000" },
    ]);
  });

  it("takes the base summary for the one currency every row is in", () => {
    const summary =
      '<CashReportCurrency currency="BASE_SUMMARY" fromDate="20250102" startingCash="30117.62" />';
    expect(cashOf([statement(TRANSACTIONS, summary)]).openings).toEqual([
      { currency: "USD", date: "2025-01-02", amount: "30117.62" },
    ]);
    expect(
      cashOf([
        statement(
          TRANSACTIONS.replace(
            'currency="USD" type="Broker Interest Received" amount="0.8"',
            'currency="ARS" type="Broker Interest Received" amount="0.8"',
          ),
          summary,
        ),
      ]).openings,
    ).toEqual([]);
  });
});
