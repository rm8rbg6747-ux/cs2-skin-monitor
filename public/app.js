const state = {
  lis: [],
  cs: [],
  fx: null,
  filtered: []
};

const $ = id => document.getElementById(id);

function log(message) {
  const el = $('log');
  if (el) {
    el.textContent += '\n' + new Date().toLocaleTimeString('ru-RU') + ' — ' + message;
    el.scrollTop = el.scrollHeight;
  }
}

function status(message) {
  $('apiStatus').textContent = message;
}

function money(value) {
  return Number(value).toLocaleString('ru-RU', {
    maximumFractionDigits: 2
  }) + ' ₽';
}

function cleanName(value) {
  return String(value || '').trim();
}

async function getFx() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error('Не удалось получить курс');

    const data = await response.json();
    state.fx = Number(data.rates.RUB);

    log('Курс USD/RUB обновлён: ' + state.fx);
    return state.fx;
  } catch (error) {
    log('Ошибка получения курса: ' + error.message);
    return null;
  }
}

function normalizeLis(data) {
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data.data)
      ? data.data
      : Array.isArray(data.offers)
        ? data.offers
        : [];

  const result = [];

  for (const item of items) {
    const name = cleanName(item.market_hash_name || item.name);

    const offer = Array.isArray(item.offers)
      ? item.offers.find(x => x.provider === 'lis_skins') || item.offers[0]
      : item;

    if (!name || !offer) continue;

    const rawPrice = Number(offer.price);

    if (!Number.isFinite(rawPrice) || rawPrice <= 0) continue;

    result.push({
      name,
      price: state.fx ? rawPrice * state.fx : rawPrice,
      raw: rawPrice
    });
  }

  return result;
}

async function loadLis() {
  const button = $('loadLis');

  button.disabled = true;
  button.textContent = 'Загрузка…';
  status('Загрузка LIS-SKINS…');
  $('lisMessage').textContent = 'Получаю данные с сервера…';

  try {
    if (!state.fx) await getFx();

    const response = await fetch('/api/lis-skins');

    if (!response.ok) {
      throw new Error('Ошибка сервера: HTTP ' + response.status);
    }

    const data = await response.json();
    state.lis = normalizeLis(data.data);

    if (!state.lis.length) {
      throw new Error('Сервер ответил, но предложения не найдены. Проверь формат ответа API.');
    }

    $('lisTag').textContent = 'LIS: подключён';
    $('lisDot').classList.remove('muted');
    $('lisMessage').textContent = 'Загружено предложений: ' + state.lis.length;

    status('LIS-SKINS подключён');
    log('Загружено предложений LIS-SKINS: ' + state.lis.length);

    render();

  } catch (error) {
    $('lisTag').textContent = 'LIS: ошибка';
    $('lisMessage').textContent = error.message;
    status('Ошибка LIS-SKINS');
    log('Ошибка LIS-SKINS: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Загрузить LIS-SKINS';
  }
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');

  const lines = text.split(/\r?\n/).filter(x => x.trim());

  if (lines.length < 2) {
    throw new Error('CSV-файл пустой или содержит только заголовки.');
  }

  const firstLine = lines[0];
  const delimiter =
    (firstLine.match(/;/g) || []).length >
    (firstLine.match(/,/g) || []).length ? ';' : ',';

  function splitLine(line) {
    const result = [];
    let value = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"' && line[i + 1] === '"' && quoted) {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        result.push(value.trim());
        value = '';
      } else {
        value += char;
      }
    }

    result.push(value.trim());
    return result;
  }

  const headers = splitLine(lines.shift()).map(x => x.toLowerCase());

  const nameIndex = headers.findIndex(x =>
    ['market_hash_name', 'name', 'название', 'skin'].includes(x)
  );

  const priceIndex = headers.findIndex(x =>
    ['price', 'цена', 'price_rub'].includes(x)
  );

  if (nameIndex === -1 || priceIndex === -1) {
    throw new Error('В CSV должны быть столбцы с названием скина и ценой.');
  }

  return lines.map(line => {
    const columns = splitLine(line);

    const price = Number(
      String(columns[priceIndex] || '')
        .replace(/\s/g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, '')
    );

    return {
      name: cleanName(columns[nameIndex]),
      price
    };
  }).filter(x =>
    x.name && Number.isFinite(x.price) && x.price > 0
  );
}

$('csvFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    state.cs = parseCsv(await file.text());

    $('csvInfo').textContent =
      'Загружено предложений: ' + state.cs.length;

    log('CSV CS.Market загружен: ' + state.cs.length + ' предложений');

    status('CSV загружен');
    render();

  } catch (error) {
    $('csvInfo').textContent = 'Ошибка загрузки CSV';
    log('Ошибка CSV: ' + error.message);
    alert(error.message);
  }
});

function render() {
  const min = $('minPrice').value === ''
    ? 0
    : Number($('minPrice').value);

  const max = $('maxPrice').value === ''
    ? Infinity
    : Number($('maxPrice').value);

  const query = $('search').value.trim().toLowerCase();
  const onlyBoth = $('onlyBoth').checked;

  const lisMap = new Map(state.lis.map(x => [x.name, x]));
  const csMap = new Map(state.cs.map(x => [x.name, x]));

  const names = [...new Set([
    ...lisMap.keys(),
    ...csMap.keys()
  ])];

  let rows = names.map(name => ({
    name,
    lis: lisMap.get(name),
    cs: csMap.get(name)
  }));

  rows = rows.filter(item => {
    if (query && !item.name.toLowerCase().includes(query)) return false;

    if (onlyBoth && !(item.lis && item.cs)) return false;

    const prices = [
      item.lis?.price,
      item.cs?.price
    ].filter(x => x !== undefined);

    return prices.some(price => price >= min && price <= max);
  });

  const sort = $('sort').value;

  rows.sort((a, b) => {
    const aPrices = [a.lis?.price, a.cs?.price].filter(x => x !== undefined);
    const bPrices = [b.lis?.price, b.cs?.price].filter(x => x !== undefined);

    const aMin = Math.min(...aPrices);
    const bMin = Math.min(...bPrices);

    const aMax = Math.max(...aPrices);
    const bMax = Math.max(...bPrices);

    if (sort === 'name') {
      return a.name.localeCompare(b.name);
    }

    if (sort === 'high') {
      return bMax - aMax;
    }

    if (sort === 'saving') {
      const aDiff = a.lis && a.cs ? Math.abs(a.lis.price - a.cs.price) : 0;
      const bDiff = b.lis && b.cs ? Math.abs(b.lis.price - b.cs.price) : 0;
      return bDiff - aDiff;
    }

    return aMin - bMin;
  });

  state.filtered = rows;

  $('statTotal').textContent = rows.length;
  $('statBoth').textContent = rows.filter(x => x.lis && x.cs).length;

  const allPrices = rows.flatMap(x => [
    x.lis?.price,
    x.cs?.price
  ]).filter(x => x !== undefined);

  $('statLow').textContent = allPrices.length
    ? money(Math.min(...allPrices))
    : '—';

  $('tableCaption').textContent =
    rows.length
      ? 'Найдено предложений: ' + rows.length
      : 'Загрузи данные хотя бы с одной площадки';

  const tbody = $('rows');
  tbody.innerHTML = '';

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="empty">По заданным условиям ничего не найдено.</td></tr>';
    return;
  }

  rows.slice(0, 1000).forEach(item => {
    const tr = document.createElement('tr');

    const values = [
      item.name,
      item.lis ? money(item.lis.price) : 'Нет данных',
      item.cs ? money(item.cs.price) : 'Нет данных',
      item.lis && item.cs
        ? money(Math.abs(item.lis.price - item.cs.price))
        : '—',
      !item.lis || !item.cs
        ? '—'
        : item.lis.price < item.cs.price
          ? 'LIS-SKINS'
          : item.cs.price < item.lis.price
            ? 'CS.Market'
            : 'Одинаково'
    ];

    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;

      if (index === 0) td.className = 'skin';
      if (index === 1 || index === 2) {
        td.className = value === 'Нет данных' ? 'missing' : 'price';
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  if (rows.length > 1000) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');

    td.colSpan = 5;
    td.className = 'empty';
    td.textContent = 'Показаны первые 1000 результатов. Уточни фильтр.';

    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

// Применить фильтры
$('applyBtn').addEventListener('click', () => {
  render();
  log('Фильтры применены');
});

// Сбросить фильтры
$('resetBtn').addEventListener('click', () => {
  $('minPrice').value = '';
  $('maxPrice').value = '';
  $('search').value = '';
  $('sort').value = 'low';
  $('onlyBoth').checked = false;

  render();
  log('Фильтры сброшены');
});

// Автоматическое обновление таблицы при изменении сортировки
$('sort').addEventListener('change', render);

// Поиск по названию
$('search').addEventListener('input', render);

// Загрузка LIS
$('loadLis').addEventListener('click', loadLis);

// Экспорт CSV
$('exportBtn').addEventListener('click', () => {
  if (!state.filtered.length) {
    alert('Нет данных для экспорта.');
    return;
  }

  const rows = [
    ['market_hash_name', 'lis_price_rub', 'cs_market_price_rub', 'difference_rub'],
    ...state.filtered.map(x => [
      x.name,
      x.lis?.price ?? '',
      x.cs?.price ?? '',
      x.lis && x.cs ? Math.abs(x.lis.price - x.cs.price) : ''
    ])
  ];

  const csv = '\uFEFF' + rows.map(row =>
    row.map(value =>
      '"' + String(value).replace(/"/g, '""') + '"'
    ).join(';')
  ).join('\n');

  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;'
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'cs2-skin-prices.csv';
  link.click();

  URL.revokeObjectURL(url);
  log('Экспорт CSV выполнен');
});

// Очистка диагностики
$('clearLog').addEventListener('click', () => {
  $('log').textContent = 'Журнал очищен.';
});

// Начальное состояние
render();
log('Приложение запущено. Ожидаю данные.');
status('Ожидание данных');
