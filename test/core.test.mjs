// Тесты расчётов. Блок CORE вырезается прямо из index.html и исполняется в отдельном
// контексте — так одностраничность приложения не мешает проверять логику.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\* ===== CORE:START =====[\s\S]*?\/\* ===== CORE:END ===== \*\//);
assert.ok(block, 'блок CORE не найден в index.html');

const ctx = vm.createContext({ console });
vm.runInContext(block[0] + '\nthis.__CORE = CORE;', ctx);
const C = ctx.__CORE;

const TODAY = '2026-10-03'; // суббота

function mk(over = {}) {
  const s = C.defaults(TODAY);
  Object.assign(s.settings, over.settings || {});
  if (over.start) Object.assign(s.settings.start, over.start);
  s.ops = over.ops || [];
  s.debts = over.debts || [];
  return s;
}
let n = 0;
const op = (o) => Object.assign({ id: 'op' + (++n), note: '' }, o);

/* ——— балансы ——— */

test('балансы складываются из стартовых и операций', () => {
  const s = mk({
    start: { cash: 10000, bank: 5000, card: 3000 },
    ops: [
      op({ type: 'income', date: '2026-10-01', amount: 2000, to: 'cash', source: 'Смена' }),
      op({ type: 'expense', date: '2026-10-02', amount: 500, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: '2026-10-02', amount: 1000, from: 'card', cat: 'Еда' }),
      op({ type: 'transfer', date: '2026-10-02', amount: 3000, from: 'cash', to: 'bank' }),
      op({ type: 'transfer', date: '2026-10-03', amount: 2000, from: 'bank', to: 'card' }),
    ],
  });
  const b = C.balances(s);
  assert.equal(b.cash, 8500);
  assert.equal(b.bank, 6000);
  assert.equal(b.card, -2000);
  assert.equal(C.cardDebt(s, b), 2000);
});

test('трата с кредитки растит долг, перевод на неё — гасит', () => {
  const base = mk({ start: { card: 1000 } });
  assert.equal(C.cardDebt(base), 1000);

  const spent = mk({
    start: { card: 1000 },
    ops: [op({ type: 'expense', date: TODAY, amount: 400, from: 'card', cat: 'Еда' })],
  });
  assert.equal(C.cardDebt(spent), 1400);

  const paid = mk({
    start: { bank: 5000, card: 1000 },
    ops: [op({ type: 'transfer', date: TODAY, amount: 1000, from: 'bank', to: 'card' })],
  });
  assert.equal(C.cardDebt(paid), 0);
  assert.equal(C.balances(paid).bank, 4000);
});

test('переплата по кредитке уходит в плюс и попадает в капитал', () => {
  const s = mk({
    start: { bank: 5000, card: 1000 },
    ops: [op({ type: 'transfer', date: TODAY, amount: 1500, from: 'bank', to: 'card' })],
  });
  assert.equal(C.balances(s).card, 500);
  assert.equal(C.cardDebt(s), 0);
  assert.equal(C.net(s), 3500 + 500);
});

test('чистый капитал = счета минус долг плюс «мне должны»', () => {
  const s = mk({
    start: { cash: 10000, bank: 20000, card: 5000 },
    debts: [
      { id: 'd1', who: 'Петя', amount: 1500, due: '2026-10-10', created: '2026-10-01', returned: false, returnedAt: null, opId: null },
      { id: 'd2', who: 'Вася', amount: 700, due: '2026-10-10', created: '2026-10-01', returned: true, returnedAt: '2026-10-02', opId: null },
    ],
  });
  assert.equal(C.owedAt(s, null), 1500);
  assert.equal(C.net(s), 10000 + 20000 - 5000 + 1500);
});

test('возвращённый долг считается непогашенным до даты возврата', () => {
  const s = mk({
    debts: [{ id: 'd1', who: 'Петя', amount: 1000, due: '2026-10-10', created: '2026-09-01', returned: true, returnedAt: '2026-09-20', opId: null }],
  });
  assert.equal(C.owedAt(s, '2026-09-10'), 1000);
  assert.equal(C.owedAt(s, '2026-09-20'), 0);
  assert.equal(C.owedAt(s, null), 0);
});

test('правка операции пересчитывает баланс без расхождений', () => {
  const s = mk({
    start: { cash: 10000 },
    ops: [op({ type: 'expense', date: TODAY, amount: 500, from: 'cash', cat: 'Еда' })],
  });
  assert.equal(C.balances(s).cash, 9500);
  s.ops = s.ops.map((o) => Object.assign({}, o, { amount: 900 }));
  assert.equal(C.balances(s).cash, 9100);
});

test('удаление операции возвращает долг в список ждущих', () => {
  const s = mk({
    ops: [op({ id: 'ret1', type: 'income', date: TODAY, amount: 1000, to: 'cash', source: 'Возврат долга' })],
    debts: [{ id: 'd1', who: 'Петя', amount: 1000, due: '2026-10-10', created: '2026-09-01', returned: true, returnedAt: TODAY, opId: 'ret1' }],
  });
  assert.equal(C.owedAt(s, null), 0);
  const after = C.removeOp(s, 'ret1');
  assert.equal(after.ops.length, 0);
  assert.equal(after.debts[0].returned, false);
  assert.equal(after.debts[0].opId, null);
  assert.equal(C.owedAt(after, null), 1000);
});

/* ——— даты ——— */

test('неделя начинается в понедельник', () => {
  assert.equal(C.mondayOf('2026-10-03'), '2026-09-28'); // суббота → предыдущий понедельник
  assert.equal(C.mondayOf('2026-09-28'), '2026-09-28'); // сам понедельник
  assert.equal(C.mondayOf('2026-10-04'), '2026-09-28'); // воскресенье — ещё та же неделя
  for (let i = 0; i < 40; i++) {
    const d = C.addDays('2026-01-01', i);
    const m = C.mondayOf(d);
    assert.equal(C.parseDate(m).getDay(), 1, d);
    const diff = C.daysBetween(m, d);
    assert.ok(diff >= 0 && diff <= 6, `${d} → ${m}`);
  }
});

test('дата погашения ежемесячная и схлопывается в коротком месяце', () => {
  assert.equal(C.nextDue('2026-10-03', 29), '2026-10-29');
  assert.equal(C.nextDue('2026-10-29', 29), '2026-10-29'); // в сам день ещё не поздно
  assert.equal(C.nextDue('2026-10-30', 29), '2026-11-29'); // прошло — следующий месяц
  assert.equal(C.nextDue('2026-12-30', 29), '2027-01-29'); // смена года
  assert.equal(C.nextDue('2027-02-01', 29), '2027-02-28'); // февраль короче
  assert.equal(C.nextDue('2027-01-31', 31), '2027-01-31');
});

/* ——— недельный бюджет ——— */

test('в недельный лимит попадают только траты нужной категории с понедельника', () => {
  const s = mk({
    ops: [
      op({ type: 'expense', date: '2026-09-27', amount: 1000, from: 'cash', cat: 'На себя' }), // прошлая неделя
      op({ type: 'expense', date: '2026-09-28', amount: 400, from: 'cash', cat: 'На себя' }),
      op({ type: 'expense', date: '2026-10-03', amount: 300, from: 'cash', cat: 'На себя' }),
      op({ type: 'expense', date: '2026-10-03', amount: 900, from: 'cash', cat: 'Еда' }),      // другая категория
      op({ type: 'expense', date: '2026-10-05', amount: 500, from: 'cash', cat: 'На себя' }),  // будущее
    ],
  });
  assert.equal(C.weekSpend(s, TODAY), 700);
});

/* ——— темп и прогноз ——— */

test('темп считается по окну 28 дней', () => {
  const s = mk({
    settings: { startDate: '2026-08-01' },
    ops: [
      op({ type: 'income', date: '2026-08-10', amount: 5000, to: 'bank', source: 'Смена' }), // вне окна
      op({ type: 'income', date: '2026-09-20', amount: 7000, to: 'bank', source: 'Смена' }), // в окне
    ],
  });
  const p = C.pace(s, TODAY);
  assert.equal(p.ok, true);
  assert.equal(p.windowDays, 28);
  assert.equal(p.delta, 7000);
  assert.equal(p.perWeek, 1750);
});

test('на коротком отрезке истории темп не считается', () => {
  const s = mk({ settings: { startDate: C.addDays(TODAY, -3) } });
  const p = C.pace(s, TODAY);
  assert.equal(p.ok, false);
  assert.equal(p.needDays, 4);
  assert.equal(p.perWeek, 0);
});

test('прогноз даёт дату только при положительном темпе', () => {
  const grow = mk({
    settings: { startDate: '2026-08-01', goals: [10000, 100000] },
    ops: [op({ type: 'income', date: '2026-09-20', amount: 14000, to: 'bank', source: 'Смена' })],
  });
  const f = C.forecast(grow, TODAY);
  assert.equal(f[0].status, 'done');            // 14 000 ≥ 10 000
  assert.equal(f[1].status, 'eta');
  assert.ok(f[1].date > TODAY);
  // не хватает 86 000 при 3 500 ₽/нед → около 24.6 недель
  assert.equal(f[1].date, C.addDays(TODAY, Math.ceil((86000 / 3500) * 7)));

  const flat = mk({ settings: { startDate: '2026-08-01', goals: [100000] } });
  assert.equal(C.forecast(flat, TODAY)[0].status, 'flat');

  const falling = mk({
    settings: { startDate: '2026-08-01', goals: [100000] },
    start: { bank: 50000 },
    ops: [op({ type: 'expense', date: '2026-09-20', amount: 9000, from: 'bank', cat: 'Еда' })],
  });
  assert.equal(C.forecast(falling, TODAY)[0].status, 'flat');

  const fresh = mk({ settings: { startDate: C.addDays(TODAY, -2), goals: [100000] } });
  const ff = C.forecast(fresh, TODAY)[0];
  assert.equal(ff.status, 'need-data');
  assert.equal(ff.needDays, 5);
});

test('проценты по целям не уезжают ниже нуля при отрицательном капитале', () => {
  const s = mk({ start: { card: 5000 }, settings: { goals: [100000] } });
  const f = C.forecast(s, TODAY)[0];
  assert.equal(f.pct, 0);
});

/* ——— лестница ——— */

test('заполнение лестницы растёт монотонно и попадает в точки целей', () => {
  const g = [100000, 150000, 500000, 1000000, 2500000];
  assert.equal(C.ladderFill(0, g), 0);
  assert.equal(C.ladderFill(-5000, g), 0);
  assert.ok(Math.abs(C.ladderFill(50000, g) - 0.05) < 1e-9);   // половина пути к первой
  assert.ok(Math.abs(C.ladderFill(100000, g) - 0.1) < 1e-9);   // точка первой цели = (0+0.5)/5
  assert.ok(Math.abs(C.ladderFill(125000, g) - 0.2) < 1e-9);   // ровно между первой и второй
  assert.ok(Math.abs(C.ladderFill(150000, g) - 0.3) < 1e-9);   // точка второй цели = (1+0.5)/5
  assert.equal(C.ladderFill(2500000, g), 1);
  assert.equal(C.ladderFill(9999999, g), 1);
  assert.equal(C.ladderFill(50000, []), 0);

  let prev = -1;
  for (let v = 0; v <= 2600000; v += 25000) {
    const f = C.ladderFill(v, g);
    assert.ok(f >= prev, `упало на ${v}`);
    prev = f;
  }
});

/* ——— чипы-комбо ——— */

test('в комбо попадают только повторяющиеся сочетания', () => {
  const s = mk({
    ops: [
      op({ type: 'expense', date: TODAY, amount: 300, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: TODAY, amount: 300, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: TODAY, amount: 55, from: 'cash', cat: 'Проезд' }),
      op({ type: 'income', date: TODAY, amount: 2000, to: 'cash', source: 'Смена' }),
      op({ type: 'income', date: TODAY, amount: 2000, to: 'cash', source: 'Смена' }),
    ],
  });
  const ce = C.combos(s, 'expense');
  assert.equal(ce.length, 1);
  assert.equal(ce[0].cat, 'Еда');
  assert.equal(ce[0].amount, 300);
  assert.equal(ce[0].count, 2);

  const ci = C.combos(s, 'income');
  assert.equal(ci.length, 1);
  assert.equal(ci[0].source, 'Смена');

  assert.deepEqual([...C.combos(mk(), 'expense')], []);
});

/* ——— импорт ——— */

test('валидация пропускает корректный бэкап и ловит битый', () => {
  const good = mk({ ops: [op({ type: 'expense', date: TODAY, amount: 100, from: 'cash', cat: 'Еда' })] });
  assert.equal(C.validate(good), null);

  assert.ok(C.validate(null));
  assert.ok(C.validate([1, 2, 3]));
  assert.ok(C.validate({ ops: [], debts: [] }));
  assert.ok(C.validate({ settings: {}, debts: [] }));
  assert.ok(C.validate({ settings: {}, ops: [{ type: 'нечто', date: TODAY, amount: 1 }], debts: [] }));
  assert.ok(C.validate({ settings: {}, ops: [{ type: 'expense', date: '03.10.2026', amount: 1, from: 'cash' }], debts: [] }));
  assert.ok(C.validate({ settings: {}, ops: [{ type: 'expense', date: TODAY, amount: 0, from: 'cash' }], debts: [] }));
  assert.ok(C.validate({ settings: {}, ops: [{ type: 'expense', date: TODAY, amount: 10, from: 'кошелёк' }], debts: [] }));
  assert.ok(C.validate({ settings: {}, ops: [], debts: [{ who: 'Петя', amount: 10 }] }));
});

test('migrate достраивает недостающее и выкидывает мусорные операции', () => {
  const s = C.migrate({
    settings: { start: { cash: 100 } },
    ops: [
      { id: 'a', type: 'expense', date: TODAY, amount: 50, from: 'cash', cat: 'Еда' },
      { id: 'b', type: 'expense', date: 'вчера', amount: 50, from: 'cash', cat: 'Еда' },
      { type: 'expense', date: TODAY, amount: 50, from: 'cash', cat: 'Еда' },
      { id: 'd', type: 'expense', date: TODAY, amount: -5, from: 'cash', cat: 'Еда' },
    ],
    debts: [{ id: 'x', who: '', amount: 10, due: TODAY, created: TODAY }],
  }, TODAY);

  assert.equal(s.ops.length, 1);
  assert.equal(s.ops[0].id, 'a');
  assert.equal(s.debts[0].who, 'Без имени');
  assert.equal(s.settings.minCash, 20000);
  assert.equal(s.settings.weekLimit, 3200);
  assert.equal(s.settings.cardDueDay, 29);
  assert.deepEqual([...s.settings.goals], [100000, 150000, 500000, 1000000, 2500000]);
  assert.equal(s.settings.start.cash, 100);
  assert.equal(C.balances(s).cash, 50);
});

test('migrate из пустоты даёт рабочее состояние', () => {
  const s = C.migrate(null, TODAY);
  assert.equal(s.ops.length, 0);
  assert.equal(C.net(s), 0);
  assert.equal(s.settings.startDate, TODAY);
  assert.ok(s.settings.categories.includes(s.settings.budgetCategory));
});

test('категория недельного лимита всегда есть в списке категорий', () => {
  const s = C.migrate({
    settings: { budgetCategory: 'Хобби', categories: ['Еда'] },
    ops: [], debts: [],
  }, TODAY);
  assert.ok(s.settings.categories.includes('Хобби'));
});

/* ——— разбор трат за месяц ——— */

test('разбор месяца считает доли и сортирует категории по убыванию', () => {
  const s = mk({
    ops: [
      op({ type: 'income', date: '2026-10-01', amount: 10000, to: 'cash', source: 'Смена' }),
      op({ type: 'expense', date: '2026-10-02', amount: 2000, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: '2026-10-03', amount: 2000, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: '2026-10-03', amount: 1000, from: 'cash', cat: 'Проезд' }),
      op({ type: 'transfer', date: '2026-10-03', amount: 5000, from: 'cash', to: 'bank' }), // не трата
      op({ type: 'expense', date: '2026-09-30', amount: 9999, from: 'cash', cat: 'Еда' }),  // другой месяц
    ],
  });
  const m = C.monthStats(s, '2026-10');
  assert.equal(m.income, 10000);
  assert.equal(m.expense, 5000);
  assert.equal(m.saved, 5000);
  assert.equal(m.byCat.length, 2);
  assert.equal(m.byCat[0].cat, 'Еда');
  assert.equal(m.byCat[0].sum, 4000);
  assert.equal(m.byCat[0].share, 0.8);
  assert.equal(m.byCat[1].cat, 'Проезд');
});

test('пустой месяц не делит на ноль', () => {
  const m = C.monthStats(mk(), '2026-10');
  assert.equal(m.expense, 0);
  assert.equal(m.saved, 0);
  assert.deepEqual([...m.byCat], []);
});

test('обрезка по числу месяца даёт честное сравнение с неполным месяцем', () => {
  const s = mk({
    ops: [
      op({ type: 'expense', date: '2026-09-02', amount: 500, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: '2026-09-20', amount: 4000, from: 'cash', cat: 'Еда' }),
      op({ type: 'expense', date: '2026-10-02', amount: 600, from: 'cash', cat: 'Еда' }),
    ],
  });
  // весь сентябрь против первых трёх дней сентября
  assert.equal(C.monthStats(s, '2026-09').expense, 4500);
  assert.equal(C.monthStats(s, '2026-09', 3).expense, 500);
  // октябрь по 3-е число — рост на 100 ₽, а не мнимое падение на 3 900 ₽
  assert.equal(C.monthStats(s, '2026-10').expense - C.monthStats(s, '2026-09', 3).expense, 100);
});

test('перебор месяцев переходит через границу года', () => {
  assert.equal(C.prevMonth('2026-01'), '2025-12');
  assert.equal(C.nextMonth('2026-12'), '2027-01');
  assert.equal(C.prevMonth('2026-10'), '2026-09');
  assert.equal(C.nextMonth('2026-10'), '2026-11');
});

/* ——— живые деньги и прогноз к дате погашения ——— */

test('темп живых денег не замечает переводов между своими счетами', () => {
  const s = mk({
    settings: { startDate: '2026-08-01' },
    start: { cash: 10000 },
    ops: [op({ type: 'transfer', date: '2026-09-20', amount: 5000, from: 'cash', to: 'bank' })],
  });
  assert.equal(C.liquidPace(s, TODAY).delta, 0);
});

test('трата по кредитке не трогает живые деньги, но растит долг', () => {
  const s = mk({
    settings: { startDate: '2026-08-01' },
    start: { cash: 10000 },
    ops: [op({ type: 'expense', date: '2026-09-20', amount: 3000, from: 'card', cat: 'Еда' })],
  });
  assert.equal(C.liquidPace(s, TODAY).delta, 0);
  assert.equal(C.cardDebt(s), 3000);
  assert.equal(C.pace(s, TODAY).delta, -3000); // капитал при этом просел
});

test('прогноз к дате погашения отвечает, хватит ли денег', () => {
  // 28 дней истории, +7 000 ₽ живых денег → 250 ₽/день; до 29-го 26 дней
  const s = mk({
    settings: { startDate: '2026-08-01', cardDueDay: 29 },
    start: { bank: 3000, card: 5000 },
    ops: [op({ type: 'income', date: '2026-09-20', amount: 7000, to: 'bank', source: 'Смена' })],
  });
  const f = C.dueForecast(s, TODAY);
  assert.equal(f.ok, true);
  assert.equal(f.due, '2026-10-29');
  assert.equal(f.days, 26);
  assert.equal(f.debt, 5000);
  assert.equal(f.projected, 10000 + (7000 / 28) * 26);
  assert.equal(f.enough, true);
  assert.equal(f.gap, 0);
});

test('прогноз честно показывает нехватку', () => {
  const s = mk({
    settings: { startDate: '2026-08-01', cardDueDay: 29 },
    start: { bank: 1000, card: 20000 },
    ops: [op({ type: 'income', date: '2026-09-20', amount: 1400, to: 'bank', source: 'Смена' })],
  });
  const f = C.dueForecast(s, TODAY);
  assert.equal(f.enough, false);
  assert.ok(f.gap > 0);
  assert.equal(Math.round(f.gap), Math.round(20000 - (2400 + (1400 / 28) * 26)));
});

test('без истории прогноз к погашению не строится', () => {
  const s = mk({ settings: { startDate: C.addDays(TODAY, -2) }, start: { card: 5000 } });
  const f = C.dueForecast(s, TODAY);
  assert.equal(f.ok, false);
  assert.equal(f.needDays, 5);
  assert.equal(f.debt, 5000);
});

/* ——— сколько можно потратить сегодня ——— */

test('дневной потолок делит остаток лимита на оставшиеся дни недели', () => {
  // TODAY — суббота: остаются суббота и воскресенье
  const s = mk({
    start: { cash: 50000 },
    ops: [op({ type: 'expense', date: '2026-09-28', amount: 1200, from: 'cash', cat: 'На себя' })],
  });
  const a = C.todayAllowance(s, TODAY);
  assert.equal(a.daysLeft, 2);
  assert.equal(a.weekLeft, 2000);
  assert.equal(a.amount, 1000);
  assert.equal(a.limiter, 'week');
});

test('в понедельник в запасе вся неделя', () => {
  const s = mk({ start: { cash: 50000 } });
  const a = C.todayAllowance(s, '2026-09-28'); // понедельник
  assert.equal(a.daysLeft, 7);
  assert.equal(a.amount, Math.floor(3200 / 7));
});

test('запас наличных перебивает недельный лимит, когда он ниже', () => {
  const s = mk({ start: { cash: 20300 } }); // сверх запаса всего 300 ₽
  const a = C.todayAllowance(s, TODAY);
  assert.equal(a.limiter, 'cash');
  assert.equal(a.amount, 300);
});

test('исчерпанный лимит и пробитый запас дают ноль с разными причинами', () => {
  const spent = mk({
    start: { cash: 50000 },
    ops: [op({ type: 'expense', date: '2026-09-29', amount: 3200, from: 'cash', cat: 'На себя' })],
  });
  const a1 = C.todayAllowance(spent, TODAY);
  assert.equal(a1.amount, 0);
  assert.equal(a1.limiter, 'week-spent');

  const broke = mk({ start: { cash: 15000 } });
  const a2 = C.todayAllowance(broke, TODAY);
  assert.equal(a2.amount, 0);
  assert.equal(a2.limiter, 'cash-floor');
  assert.equal(a2.cushion, -5000);
});

/* ——— поведение на телефоне ——— */

test('двойной тап по странице не приближает экран', () => {
  // Safari по умолчанию (touch-action: auto) считает два быстрых тапа по одному
  // месту жестом масштабирования. На цифровой клавиатуре это ломает ввод:
  // «00» превращается в приближение вместо двух нажатий.
  const body = /(?:^|\n)body\{([^}]*)\}/.exec(html);
  assert.ok(body, 'не найдено правило body в стилях');
  assert.match(
    body[1].replace(/\s/g, ''),
    /touch-action:manipulation/,
    'у body должен быть touch-action: manipulation — он гасит двойной тап, сохраняя прокрутку и щипок'
  );
});

test('масштабирование щипком остаётся доступным', () => {
  // Соблазнительный способ «починить» зум — запретить его в viewport.
  // Это убирает и щипок, то есть лишает возможности увеличить мелкий текст.
  const meta = /<meta name="viewport" content="([^"]+)">/.exec(html);
  assert.ok(meta, 'не найден viewport');
  assert.doesNotMatch(meta[1], /user-scalable\s*=\s*no/, 'нельзя запрещать масштабирование');
  assert.doesNotMatch(meta[1], /maximum-scale/, 'нельзя ограничивать максимальный масштаб');
});

/* ——— форматирование ——— */

test('числительные склоняются', () => {
  const f = ['день', 'дня', 'дней'];
  assert.equal(C.plural(1, f), 'день');
  assert.equal(C.plural(2, f), 'дня');
  assert.equal(C.plural(5, f), 'дней');
  assert.equal(C.plural(11, f), 'дней');
  assert.equal(C.plural(21, f), 'день');
  assert.equal(C.plural(22, f), 'дня');
  assert.equal(C.plural(25, f), 'дней');
  assert.equal(C.plural(0, f), 'дней');
});

test('суммы печатаются с минусом-знаком, а не дефисом', () => {
  assert.equal(C.moneyBare(-1500).charAt(0), '−');
  assert.ok(C.money(1500).endsWith('₽'));
  assert.equal(C.signed(1500).charAt(0), '+');
});
