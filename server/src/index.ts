
async function getTonUsdPrice(): Promise<number> {
  const providers = [
    {
      name: "CoinPaprika",
      url: "https://api.coinpaprika.com/v1/tickers/ton-toncoin",
      extract: (data: any): number | undefined =>
        data?.quotes?.USD?.price
    },
    {
      name: "CoinGecko",
      url: "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      extract: (data: any): number | undefined =>
        data?.["the-open-network"]?.usd
    }
  ];

  const errors: string[] = [];

  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(provider.url, {
        signal: controller.signal,
        headers: { Accept: "application/json" }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: unknown = await response.json();
      const price = provider.extract(data);

      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw new Error("Price missing or invalid");
      }

      console.log(`[MAGROXIN] TON/USD quote source: ${provider.name}`);
      return price;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";

      errors.push(`${provider.name}: ${message}`);
      console.warn(`[MAGROXIN] ${provider.name} price request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`All TON price providers failed. ${errors.join("; ")}`);
}
