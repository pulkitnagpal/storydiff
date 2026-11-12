// A small GitHub REST client on fetch. Uses GITHUB_API_URL so it works on GitHub Enterprise and in tests.

export function client({ token, api = process.env.GITHUB_API_URL || 'https://api.github.com' }) {
  async function call(method, path, body) {
    const url = /^https?:/.test(path) ? path : api.replace(/\/$/, '') + path;
    const res = await fetch(url, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'storydiff-action',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const e = new Error(`${method} ${path}: ${res.status} ${data && data.message ? data.message : ''}`.trim());
      e.status = res.status;
      throw e;
    }
    return { data, link: res.headers.get('link') };
  }

  async function all(path) {
    const out = [];
    let next = path + (path.includes('?') ? '&' : '?') + 'per_page=100';
    for (let page = 0; next && page < 50; page++) {
      const { data, link } = await call('GET', next);
      out.push(...(Array.isArray(data) ? data : []));
      const m = link && link.match(/<([^>]+)>;\s*rel="next"/);
      next = m ? m[1] : null;
    }
    return out;
  }

  return {
    get: (p) => call('GET', p).then(r => r.data),
    post: (p, b) => call('POST', p, b).then(r => r.data),
    patch: (p, b) => call('PATCH', p, b).then(r => r.data),
    all,
  };
}
