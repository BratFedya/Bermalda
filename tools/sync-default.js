/* Обновляет автономную копию после редактирования content.json. */
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

try {
  const content = JSON.parse(fs.readFileSync(path.join(root, 'content.json'), 'utf8'));
  const serialized = JSON.stringify(content)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  fs.writeFileSync(path.join(root, 'default-content.js'),
    '/* Запасной контент для автономного запуска */\nwindow.__DEFAULT_CONTENT = ' + serialized + ';\n');
  console.log('default-content.js обновлён из content.json');
} catch (error) {
  console.error('Не удалось обновить контент: ' + error.message);
  process.exitCode = 1;
}
