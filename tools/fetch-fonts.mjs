// Скачивает шрифты с Google Fonts в репозиторий и вписывает @font-face прямо в index.html.
// Так у приложения не остаётся ни одного внешнего запроса, а первая загрузка работает офлайн.
// Запуск: node tools/fetch-fonts.mjs
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// cyrillic — русский текст, latin — цифры и знак «−», latin-ext — знак рубля (U+20AD–20C0).
// У Unbounded подсет latin-ext весит 115 КБ ради одного ₽, поэтому его не берём:
// браузер по unicode-range сам возьмёт рубль из Golos Text, следующего в стеке.
const WANTED = {
  'Golos Text': new Set(['cyrillic', 'latin', 'latin-ext']),
  'Unbounded': new Set(['cyrillic', 'latin']),
};
const CSS_URL = 'https://fonts.googleapis.com/css2' +
  '?family=Golos+Text:wght@400..700&family=Unbounded:wght@400..700&display=swap';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const css = await fetch(CSS_URL, { headers: { 'user-agent': UA } }).then((r) => {
  if (!r.ok) throw new Error('Google Fonts ответил ' + r.status);
  return r.text();
});

const re = /\/\* ([^*]+) \*\/\s*@font-face \{(.*?)\}/gs;
const faces = [];
let m;
while ((m = re.exec(css))) {
  const subset = m[1].trim();
  const body = m[2];
  const family = /font-family: '([^']+)'/.exec(body)?.[1];
  const weight = /font-weight: ([^;]+);/.exec(body)?.[1].trim();
  const range = /unicode-range: ([^;]+);/.exec(body)?.[1].trim();
  const url = /src: url\(([^)]+)\)/.exec(body)?.[1];
  if (!family || !url || !WANTED[family] || !WANTED[family].has(subset)) continue;
  faces.push({ subset, family, weight, range, url });
}

if (!faces.length) throw new Error('не удалось разобрать CSS Google Fonts');

mkdirSync('fonts', { recursive: true });
let total = 0;
for (const f of faces) {
  const name = `${slug(f.family)}-${f.subset}.woff2`;
  const buf = Buffer.from(await fetch(f.url, { headers: { 'user-agent': UA } }).then((r) => {
    if (!r.ok) throw new Error(`${name}: ответ ${r.status}`);
    return r.arrayBuffer();
  }));
  writeFileSync(`fonts/${name}`, buf);
  f.file = name;
  total += buf.length;
  console.log(`fonts/${name} — ${(buf.length / 1024).toFixed(1)} КБ`);
}
console.log(`итого ${(total / 1024).toFixed(1)} КБ в ${faces.length} файлах`);

const block = faces.map((f) => [
  '@font-face{',
  `font-family:'${f.family}';`,
  'font-style:normal;',
  `font-weight:${f.weight};`,
  'font-display:swap;',
  `src:url(./fonts/${f.file}) format('woff2');`,
  `unicode-range:${f.range};`,
  '}',
].join('')).join('\n');

const START = '/* FONTS:START */';
const END = '/* FONTS:END */';
const html = readFileSync('index.html', 'utf8');
const a = html.indexOf(START);
const b = html.indexOf(END);
if (a < 0 || b < 0) throw new Error(`в index.html нет маркеров ${START} … ${END}`);
writeFileSync('index.html', html.slice(0, a + START.length) + '\n' + block + '\n' + html.slice(b), 'utf8');
console.log('@font-face вписаны в index.html');

// Список файлов для предкеша service worker — чтобы шрифты были доступны офлайн сразу.
console.log('\nдобавьте в SHELL в sw.js:');
console.log(faces.map((f) => `  './fonts/${f.file}',`).join('\n'));
