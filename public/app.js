
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

function normalizeName(value) {
  return cleanName(value)
    .toLowerCase()
    .replace(/[™®]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ');
}

async function getFx() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error('Не удалось получить курс USD/RUB');

    const data = await response.json();
    state.fx = Number(data.rates.RUB);

    if (!Number.isFinite(state.fx) || state.fx <= 0) {
      throw new Error('Некорректный курс валюты');
    }

    log('Курс USD/RUB обновлён: ' + state.fx);
    return state.fx;
  } catch (error) {
    log('Ошибка курса валюты: ' + error.message);
    return null;
  }
}

function normalizeLis(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.offers)
        ? payload.offers
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
      price: rawPrice * state.fx
    });
  }

  return result;
}

function normalizeMarket(payload) {
  const root = payload?.data ?? payload;
  let items = [];

  if (Array.isArray(root)) {
    items = root;
  } else if (Array.isArray(root?.items)) {
    items = root.items;
  } else if (root?.items && typeof root.items === 'object') {
    items = Object.values(root.items);
  } else if (Array.isArray(root?.data)) {
    items = root.data;
  }

  return items.map(item => ({
    name: cleanName(item.market_hash_name || item.marketHashName || item.name),
    price: Number(String(item.price ?? item.sell_price ?? '').replace(',', '.'))
  })).filter(item =>
    item.name &&
    Number.isFinite(item.price) &&
    item.price > 0
  );
}

function mergeItems() {
  const map = new Map();

  for (const item of state.lis) {
    const key = normalizeName(item.name);
    if (!map.has(key)) map.set(key, { name: item.name, lis: null, cs: null });
    const row = map.get(key);
    row.lis = row.lis === null ? item.price : Math.min(row.lis, item.price);
  }

  for (const item of state.cs) {
    const key = normalizeName(item.name);
    if (!map.has(key)) map.set(key, { name: item.name, lis: null, cs: null });
    const row = map.get(key);
    row.cs = row.cs === null ? item.price : Math.min(row.cs, item.price);
  }

  render([...map.values()]);
}

async function loadLis() {
  const button = $('loadLis');
  button.disabled = true;
  button.textContent = 'Загрузка…';
  $('lisMessage').textContent = 'Получаю данные LIS-SKINS…';
  status('Загрузка LIS-SKINS…');

  try {
    if (!state.fx) {
      const fx = await getFx();
      if (!fx) throw new Error('Не удалось получить курс доллара. Попробуй ещё раз.');
    }

    const response = await fetch('/api/lis-skins');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Ошибка LIS API: HTTP ' + response.status);
    }

    state.lis = normalizeLis(data.data);

    if (!state.lis.length) {
      throw new Error('Предложения LIS не распознаны. Проверь формат ответа API.');
    }

    $('lisTag').textContent = 'LIS: подключён';
    $('lisDot').classList.remove('muted');
    $('lisMessage').textContent = 'Загружено предложений: ' + state.lis.length;

    log('LIS-SKINS: загружено ' + state.lis.length + ' предложений');
    status('LIS-SKINS загружен');
    mergeItems();

  } catch (error) {
    $('lisMessage').textContent = error.message;
    $('lisTag').textContent = 'LIS: ошибка';
    log('Ошибка LIS-SKINS: ' + error.message);
    status('Ошибка LIS-SKINS');
  } finally {
    button.disabled = false;
    button.textContent = 'Загрузить LIS-SKINS';
  }
}

async function loadCs() {
  const button = $('loadCs');
  button.disabled = true;
  button.textContent = 'Загрузка…';
  $('csMessage').textContent = 'Получаю цены Market.CSGO…';
  status('Загрузка Market.CSGO…');

  try {
    const response = await fetch('/api/csmarket-prices');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Ошибка Market.CSGO: HTTP ' + response.status);
    }

    state.cs = normalizeMarket(data);

    if (!state.cs.length) {
      throw new Error('Цены получены, но формат ответа не распознан.');
    }

    $('csDot').classList.remove('muted');
    $('csMessage').textContent = 'Загружено предложений: ' + state.cs.length;

    log('Market.CSGO: загружено ' + state.cs.length + ' предложений');
    status('Market.CSGO загружен');
    mergeItems();

  } catch (error) {
    $('csMessage').textContent = error.message;
    log('Ошибка Market.CSGO: ' + error.message);
    status('Ошибка Market.CSGO');
  } finally {
    button.disabled = false;
    button.textContent = 'Загрузить Market.CSGO';
  }
}

function render(sourceRows) {
  const rowsSource = sourceRows || getAllRows();

  const min = $('minPrice').value === '' ? 0 : Number($('minPrice').value);
  const max = $('maxPrice').value === '' ? Infinity : Number($('maxPrice').value);
  const query = $('search').value.trim().toLowerCase();
  const onlyBoth = $('onlyBoth').checked;

  let rows = rowsSource.filter(item => {
    if (query && !item.name.toLowerCase().includes(query)) return false;
    if (onlyBoth && (item.lis === null || item.cs === null)) return false;
    if (item.lis !== null && (item.lis < min || item.lis > max)) return false;
    return true;
  });

  const sort = $('sort').value;

  rows.sort((a, b) => {
    const aProfit = a.lis !== null && a.cs !== null ? a.cs - a.lis : -Infinity;
    const bProfit = b.lis !== null && b.cs !== null ? b.cs - b.lis : -Infinity;

    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'high') return (b.cs ?? -Infinity) - (a.cs ?? -Infinity);
    if (sort === 'low') return (a.lis ?? Infinity) - (b.lis ?? Infinity);
    return bProfit - aProfit;
  });

  state.filtered = rows;

  $('statTotal').textContent = rows.length;
  $('statBoth').textContent = rows.filter(x => x.lis !== null && x.cs !== null).length;

  const profits = rows
    .filter(x => x.lis !== null && x.cs !== null)
    .map(x => x.cs - x.lis);

  $('statLow').textContent = profits.length
    ? money(Math.max(...profits))
    : '—';

  $('tableCaption').textContent =
    'Показано ' + rows.length + ' из ' + rowsSource.length + ' скинов';

  const tbody = $('rows');
  tbody.innerHTML = '';

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">По заданным условиям ничего не найдено.</td></tr>';
    return;
  }

  rows.slice(0, 1000).forEach(item => {
    const tr = document.createElement('tr');
    const profit = item.lis !== null && item.cs !== null
      ? item.cs - item.lis
      : null;

    const values = [
      item.name,
      item.lis !== null ? money(item.lis) : 'Нет данных',
      item.cs !== null ? money(item.cs) : 'Нет данных',
      profit !== null ? (profit > 0 ? '+' : '') + money(profit) : '—'
    ];

    values.forEach((value, index) => {
      const td = document.createElement('td');
      td.textContent = value;

      if (index === 0) td.className = 'skin';
      if (index === 1 || index === 2) {
        td.className = value === 'Нет данных' ? 'missing' : 'price';
      }
      if (index === 3 && profit !== null) {
        td.className = profit > 0 ? 'saving' : 'missing';
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  if (rows.length > 1000) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = 'Показаны первые 1000 результатов. Уточни фильтр.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function getAllRows() {
  const map = new Map();

  for (const item of state.lis) {
    const key = normalizeName(item.name);
    if (!map.has(key)) map.set(key, { name: item.name, lis: null, cs: null });
    const row = map.get(key);
    row.lis = row.lis === null ? item.price : Math.min(row.lis, item.price);
  }

  for (const item of state.cs) {
    const key = normalizeName(item.name);
    if (!map.has(key)) map.set(key, { name: item.name, lis: null, cs: null });
    const row = map.get(key);
    row.cs = row.cs === null ? item.price : Math.min(row.cs, item.price);
  }

  return [...map.values()];
}

function applyFilters() {
  render();
  log('Фильтры применены');
}

async function checkStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    status(data.lisConfigured ? 'LIS API настроен' : 'Проверь настройки LIS API');
  } catch {
    status('Сервер недоступен');
  }
}

$('loadLis').addEventListener('click', loadLis);
$('loadCs').addEventListener('click', loadCs);

$('applyBtn').addEventListener('click', applyFilters);

$('resetBtn').addEventListener('click', () => {
  $('minPrice').value = '';
  $('maxPrice').value = '';
  $('search').value = '';
  $('sort').value = 'profit';
  $('onlyBoth').checked = false;
  render();
  log('Фильтры сброшены');
});

$('sort').addEventListener('change', render);
$('search').addEventListener('input', render);
$('onlyBoth').addEventListener('change', render);

$('exportBtn').addEventListener('click', () => {
  if (!state.filtered.length) {
    alert('Нет данных для экспорта.');
    return;
  }

  const rows = [
    ['Название', 'Покупка LIS-SKINS RUB', 'Продажа Market.CSGO RUB', 'Разница RUB'],
    ...state.filtered.map(item => [
      item.name,
      item.lis ?? '',
      item.cs ?? '',
      item.lis !== null && item.cs !== null ? item.cs - item.lis : ''
    ])
  ];

  const csv = '\uFEFF' + rows.map(row =>
    row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(';')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = 'cs2-resale-monitor.csv';
  link.click();

  URL.revokeObjectURL(url);
  log('Экспорт CSV выполнен');
});

$('clearLog').addEventListener('click', () => {
  $('log').textContent = 'Журнал очищен.';
});

render();
checkStatus();
log('Приложение запущено. Ожидаю данные.');
