const state = {
  lis: [],
  cs: [],
  fx: null,
  lisStamp: null,
  csStamp: null
};

const $ = id => document.getElementById(id);

const fmt = n =>
  Number(n).toLocaleString('ru-RU', {
    maximumFractionDigits: 2
  }) + ' ₽';

function setStatus(s) {
  $('status').textContent = s;
}

function cleanName(s) {
  return String(s || '').trim();
}

function normalizeLis(data) {
  if (!Array.isArray(data)) {
    throw new Error('Неожиданный формат ответа API. Ожидался массив предложений.');
  }

  const out = [];

  for (const item of data) {
    const name = cleanName(item.market_hash_name);
    const offer = (item.offers || []).find(
      x => x.provider === 'lis_skins'
    );

    if (name && offer && Number.isFinite(Number(offer.price))) {
      out.push({
        name,
        price: Number(offer.price) * state.fx,
        raw: Number(offer.price),
        checked: offer.checked_at || '',
        url: ''
      });
    }
  }

  return out;
}

async function getFx() {
  $('fxInfo').textContent = 'Получаю курс…';

  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');

    if (!r.ok) throw new Error('Курс недоступен');

    const j = await r.json();

    if (!j.rates || !j.rates.RUB) {
      throw new Error('В ответе нет RUB');
    }

    state.fx = Number(j.rates.RUB);
    $('fx').value = state.fx.toFixed(2);
    $('mFx').textContent = state.fx.toFixed(2);

    $('fxInfo').textContent =
      'Курс API · ' +
      new Date(j.time_last_update_utc).toLocaleString('ru-RU');

    render();
    return true;

  } catch (e) {
    $('fxInfo').textContent =
      'Не удалось получить курс. Введите его вручную.';
    return false;
  }
}

async function loadLis() {
  const key = $('apiKey').value.trim();

  if (!key) {
    alert('Сначала вставьте API-ключ API Skins.');
    return;
  }

  if (!state.fx) {
    const manual = Number($('fx').value);

    if (manual > 0) {
      state.fx = manual;
    } else if (!(await getFx())) {
      alert('Укажите курс USD → RUB вручную.');
      return;
    }
  }

  const b = $('loadLis');
  b.disabled = true;
  b.textContent = 'Загрузка…';
  setStatus('Запрос LIS-SKINS…');

  try {
    const url = 'https://api.apiskins.com/v1/offers?providers=lis_skins';

    const r = await fetch(url, {
      headers: {
        'X-API-KEY': key
      }
    });

    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try {
        msg += (await r.json()).error || '';
      } catch {}
      throw new Error(msg);
    }

    const data = await r.json();

    state.lis = normalizeLis(data);
    state.lisStamp = new Date();

    setStatus('LIS-SKINS подключён');

    $('updated').textContent =
      'LIS-SKINS: ' + state.lisStamp.toLocaleString('ru-RU');

    render();

  } catch (e) {
    setStatus('Ошибка подключения');

    alert(
      'Не удалось загрузить LIS-SKINS: ' +
      e.message +
      '. Проверьте ключ, доступ API и CORS.'
    );

  } finally {
    b.disabled = false;
    b.textContent = 'Загрузить LIS-SKINS';
  }
}

function parseCsv(text) {
  const first =
    text.split(/\r?\n/).find(x => x.trim()) || '';

  const delim =
    (first.match(/;/g) || []).length >
    (first.match(/,/g) || []).length
      ? ';'
      : ',';

  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(x => x.trim());

  const split = line => {
    let a = [], v = '', q = false;

    for (let i = 0; i < line.length; i++) {
      let c = line[i];

      if (c === '"' && line[i + 1] === '"' && q) {
        v += '"';
        i++;
      } else if (c === '"') {
        q = !q;
      } else if (c === delim && !q) {
        a.push(v.trim());
        v = '';
      } else {
        v += c;
      }
    }

    a.push(v.trim());
    return a;
  };

  const heads = split(lines.shift()).map(x => x.toLowerCase());

  const ni = heads.indexOf('market_hash_name');
  const pi = heads.indexOf('price');
  const ui = heads.indexOf('url');
  const ti = heads.indexOf('checked_at');

  if (ni < 0 || pi < 0) {
    throw new Error('Нужны столбцы market_hash_name и price');
  }

  return lines.map(line => {
    const a = split(line);

    const price = Number(
      (a[pi] || '').replace(/\s/g, '').replace(',', '.')
    );

    return {
      name: cleanName(a[ni]),
      price,
      url: ui >= 0 ? a[ui] : '',
      checked: ti >= 0 ? a[ti] : ''
    };
  }).filter(x =>
    x.name &&
    Number.isFinite(x.price) &&
    x.price >= 0
  );
}

$('csCsv').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;

  try {
    state.cs = parseCsv(await f.text());
    state.csStamp = new Date();

    $('updated').textContent =
      'CS.Market CSV: ' + state.csStamp.toLocaleString('ru-RU');

    setStatus('CSV CS.Market загружен');
    render();

  } catch (err) {
    alert('Ошибка CSV: ' + err.message);
  }
});

function render() {
  const min = Number($('min').value) || 0;

  const max =
    $('max').value === ''
      ? Infinity
      : Number($('max').value);

  const q = $('search').value.trim().toLowerCase();
  const which = $('which').value;

  const lis = new Map(state.lis.map(x => [x.name, x]));
  const cs = new Map(state.cs.map(x => [x.name, x]));

  const names = [...new Set([...lis.keys(), ...cs.keys()])];

  let rows = names
    .map(name => ({
      name,
      l: lis.get(name),
      c: cs.get(name)
    }))
    .filter(x => {
      if (q && !x.name.toLowerCase().includes(q)) return false;
      if (which === 'both' && !(x.l && x.c)) return false;
      if (which === 'lis' && !x.l) return false;
      if (which === 'cs' && !x.c) return false;

      const vals = [x.l?.price, x.c?.price]
        .filter(v => v !== undefined);

      return vals.some(v => v >= min && v <= max);
    });

  rows.sort((a, b) => {
    if ($('sort').value === 'name') {
      return a.name.localeCompare(b.name);
    }

    if ($('sort').value === 'high') {
      return Math.max(b.l?.price || 0, b.c?.price || 0) -
             Math.max(a.l?.price || 0, a.c?.price || 0);
    }

    if ($('sort').value === 'diff') {
      return Math.abs((b.l?.price || 0) - (b.c?.price || 0)) -
             Math.abs((a.l?.price || 0) - (a.c?.price || 0));
    }

    return Math.min(a.l?.price ?? Infinity, a.c?.price ?? Infinity) -
           Math.min(b.l?.price ?? Infinity, b.c?.price ?? Infinity);
  });

  $('mCount').textContent = rows.length;
  $('mBoth').textContent = rows.filter(x => x.l && x.c).length;

  const prices = rows
    .flatMap(x => [x.l?.price, x.c?.price])
    .filter(x => x !== undefined);

  $('mMin').textContent =
    prices.length ? fmt(Math.min(...prices)) : '—';

  $('mFx').textContent =
    state.fx ? state.fx.toFixed(2) : '—';

  const body = $('results');
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="5" class="empty">По заданным условиям ничего не найдено.</td></tr>';
    return;
  }

  for (const x of rows.slice(0, 1000)) {
    const lp = x.l?.price;
    const cp = x.c?.price;

    const d =
      lp !== undefined && cp !== undefined
        ? Math.abs(lp - cp)
        : null;

    let cheaper =
      lp === undefined ? '—' :
      cp === undefined ? '—' :
      lp < cp ? 'LIS-SKINS' :
      cp < lp ? 'CS.Market' :
      'Одинаково';

    const tr = document.createElement('tr');

    const td = html => {
      const e = document.createElement('td');
      e.innerHTML = html;
      tr.appendChild(e);
    };

    td('<div class="skin"></div><div class="wear">CS2 · market hash name</div>');

    tr.children[0].querySelector('.skin').textContent = x.name;

    td(lp === undefined
      ? '<span class="missing">Нет данных</span>'
      : '<span class="price">' + fmt(lp) + '</span><div class="wear">API · USD → RUB</div>'
    );

    td(cp === undefined
      ? '<span class="missing">Нет данных</span>'
      : '<span class="price">' + fmt(cp) + '</span><div class="wear">Импорт CSV · RUB</div>'
    );

    td(d === null
      ? '—'
      : '<span class="delta">' + fmt(d) + '</span>'
    );

    td(
      cheaper === 'LIS-SKINS'
        ? '<span class="best">LIS-SKINS</span>'
        : cheaper === 'CS.Market'
          ? '<span class="best">CS.Market</span>'
          : cheaper
    );

    body.appendChild(tr);
  }

  if (rows.length > 1000) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td colspan="5" class="empty">Показаны первые 1000 результатов. Уточните фильтр.</td>';
    body.appendChild(tr);
  }
}

$('apply').onclick = render;
$('sort').onchange = render;
$('which').onchange = render;

$('search').oninput = () => {
  clearTimeout(window._st);
  window._st = setTimeout(render, 180);
};

$('refresh').onclick = () => {
  if ($('apiKey').value.trim()) {
    loadLis();
  } else {
    alert('Введите API-ключ LIS-SKINS. CSV CS.Market можно загрузить повторно через поле импорта.');
  }
};

$('loadLis').onclick = loadLis;
$('getFx').onclick = getFx;

$('fx').addEventListener('change', () => {
  const v = Number($('fx').value);

  if (v > 0) {
    state.fx = v;
    state.lis = [];
    render();

    $('fxInfo').textContent =
      'Курс задан вручную. Перезагрузите LIS-SKINS для пересчёта.';
  }
});

getFx();
