// Narrow MetaApi REST adapter for the designated existing demo account only.
// No account creation/deployment, no unrelated-account listing, no subscriptions.
export class MetaApiAdapter {
  constructor({ accountId, token, provisioningHost, tradeHost, fetchImpl = fetch, now = () => Date.now() }) {
    for (const host of [provisioningHost, tradeHost]) {
      const u = new URL(host);
      if (u.protocol !== 'https:' || !/^(?:[a-z0-9-]+\.)*agiliumtrade(?:\.agiliumtrade)?\.ai$/.test(u.hostname)
        || u.pathname !== '/' || u.search || u.hash) throw new Error('unapproved MetaApi host');
    }
    if (!accountId || !token) throw new Error('exact account id and token required');
    this.id = encodeURIComponent(accountId);
    this.token = token;
    this.prov = provisioningHost.replace(/\/$/, '');
    this.tradeHost = tradeHost.replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.startedAt = new Date(now() - 60_000).toISOString();
  }
  async request(host, path, method = 'GET', body) {
    const r = await this.fetchImpl(`${host}/users/current/accounts/${this.id}${path}`, {
      method, headers: { 'auth-token': this.token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = { parseError: true }; }
    return { httpOk: r.ok, status: r.status, json };
  }
  async read(path, host = this.tradeHost) {
    const r = await this.request(host, path);
    if (!r.httpOk || r.json?.parseError) throw new Error(`read-only provider request failed HTTP ${r.status}`);
    return r.json;
  }
  async accounts() { return [await this.read('', this.prov)]; } // exact ID; never list unrelated accounts
  async accountInfo() { return this.read('/account-information'); }
  async spec(symbol) {
    this.currentSpec = await this.read(`/symbols/${encodeURIComponent(symbol)}/specification`);
    return this.currentSpec;
  }
  async quote(symbol) { return this.read(`/symbols/${encodeURIComponent(symbol)}/current-price`); }
  async marginOk(request, info) {
    // Conservative provisional margin check. Reject cross-currency / unknown rules;
    // this is NOT a guarantee the broker will accept the order or that risk is bounded.
    const s = this.currentSpec;
    return s?.marginCurrency === info.currency && Number.isFinite(s.initialMargin) && s.initialMargin > 0
      && Number.isFinite(info.freeMargin) && info.freeMargin > s.initialMargin * request.volume;
  }
  async historyDeals() {
    const start = encodeURIComponent(this.startedAt);
    const end = encodeURIComponent(new Date(this.now() + 60000).toISOString());
    const all = [];
    for (let page = 0; page < 5; page++) {
      const rows = await this.read(`/history-deals/time/${start}/${end}?offset=${page * 1000}&limit=1000`);
      if (!Array.isArray(rows)) throw new Error('history-deals response not an array');
      all.push(...rows);
      if (rows.length < 1000) return all;
    }
    throw new Error('history pagination limit reached; completeness unknown');
  }
  async snapshot(ticket) {
    const [orders, positions, deals, historyOrders] = await Promise.all([
      this.read('/orders?refreshTerminalState=true'),
      this.read('/positions?refreshTerminalState=true'),
      this.historyDeals(),
      ticket ? this.read(`/history-orders/ticket/${encodeURIComponent(ticket)}`) : Promise.resolve([]),
    ]);
    if (![orders, positions, deals, historyOrders].every(Array.isArray)) throw new Error('snapshot incomplete');
    return { orders, positions, deals, historyOrders, historyComplete: false }; // REST alone never proves broker negative finality
  }
  async trade(body) {
    try {
      return await this.request(this.tradeHost, '/trade', 'POST', body);
    } catch {
      // Network exception/timeout AFTER POST could mean broker accepted it.
      return { httpOk: false, transportError: true, json: null };
    }
  }
}